'use client';

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type {
  BankAccount,
  CashbookEntry,
  PaymentMethod,
  Purchase,
  PurchaseVendorBill,
  RentalContract,
  RentalPayable,
  RentalPayoutWorkflow,
  User,
  Vendor,
  VendorBillSupportingDocumentLink,
} from '@/lib/types';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { writeAuditLog } from '@/lib/services/audit-service';
import { canExecuteBankCashbookPayments } from '@/lib/permissions';
import { isAccountingManager, isAccountingOfficer, isSystemAdmin } from '@/lib/permission-core';
import {
  buildWithholdingCertificateDraft,
  buildWhtElectronicDataFromDocument,
  stripUndefinedForFirestore,
  type CompanyProfileWhtInput,
} from '@/lib/wht/wht-certificate-build';
import { buildWhtAuditLogEntry } from '@/lib/wht/wht-certificate-audit';
import { validateWhtCertificateForOfficialIssue } from '@/lib/wht/wht-certificate-validation';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';

const TENANT_NAME_FALLBACK = 'บริษัท โอเปค เอ็นจิเนียริ่ง แอนด์ แมนเนจเม้นท์ จำกัด';

/** VAT มาตรฐานเมื่อผู้ให้เช่าเป็นนิติบุคคล (หรือไม่ระบุรูปนิติบุคคล) */
export const RENTAL_DEFAULT_VAT_RATE_JURISTIC = 7;

export function defaultVatRateForLessor(
  lessor: Pick<Vendor, 'vendorLegalForm'> | null | undefined,
): number {
  if (lessor?.vendorLegalForm === 'NATURAL') return 0;
  return RENTAL_DEFAULT_VAT_RATE_JURISTIC;
}

/** อ่าน VAT % จากสัญญา — ไม่ระบุ = 0 (สัญญาเก่า) */
export function resolveContractVatRatePercent(
  contract: Pick<RentalContract, 'vatRatePercent'>,
): number {
  const v = Number(contract.vatRatePercent);
  if (Number.isFinite(v) && v >= 0) return roundMoney2(v);
  return 0;
}

/** วิธีการทำจ่าย — สัญญาเก่าไม่มีฟิลด์ = AUTO_NOTIFY */
export function resolveRentalPayoutWorkflow(
  contract: Pick<RentalContract, 'payoutWorkflow'> | null | undefined,
): RentalPayoutWorkflow {
  return contract?.payoutWorkflow === 'BILL_FIRST' ? 'BILL_FIRST' : 'AUTO_NOTIFY';
}

export function rentalPayoutWorkflowLabel(workflow: RentalPayoutWorkflow): string {
  if (workflow === 'BILL_FIRST') return 'ทำใบวางบิลก่อนให้บัญชีทำจ่าย';
  return 'แจ้งบัญชีโอนอัตโนมัติทุกรอบการจ่าย';
}

export function rentalShadowPurchaseId(contractId: string): string {
  return `rental_${contractId}`;
}

export type RentalMonthAmountBreakdown = {
  baseRentAmount: number;
  vatRatePercent: number;
  vatAmount: number;
  grossAmount: number;
  withholdingTaxRatePercent: number;
  withholdingTaxAmount: number;
  netPayableAmount: number;
};

/** ฐานค่าเช่า + VAT − หัก ณ ที่จ่าย (บนฐานก่อน VAT) */
export function computeRentalMonthAmounts(input: {
  monthlyRentAmount: number;
  vatRatePercent?: number | null;
  withholdingTaxRatePercent: number;
}): RentalMonthAmountBreakdown {
  const baseRentAmount = roundMoney2(input.monthlyRentAmount);
  const vatRatePercent = roundMoney2(Math.max(0, Number(input.vatRatePercent) || 0));
  const withholdingTaxRatePercent = roundMoney2(
    Math.max(0, Number(input.withholdingTaxRatePercent) || 0),
  );
  const vatAmount = roundMoney2((baseRentAmount * vatRatePercent) / 100);
  const grossAmount = roundMoney2(baseRentAmount + vatAmount);
  const withholdingTaxAmount = roundMoney2((baseRentAmount * withholdingTaxRatePercent) / 100);
  const netPayableAmount = roundMoney2(grossAmount - withholdingTaxAmount);
  return {
    baseRentAmount,
    vatRatePercent,
    vatAmount,
    grossAmount,
    withholdingTaxRatePercent,
    withholdingTaxAmount,
    netPayableAmount,
  };
}

async function resolveTenantNameFromSystem(db: Firestore): Promise<string> {
  const snap = await getDoc(doc(db, 'system', 'company_profile'));
  const name = snap.exists()
    ? String((snap.data() as { companyNameTh?: string })?.companyNameTh || '').trim()
    : '';
  return name || TENANT_NAME_FALLBACK;
}

function actorName(user: User): string {
  return String(user.displayName || user.email || user.id).trim() || user.id;
}

function assertCanCreateRentalContract(user: User): void {
  if (!isSystemAdmin(user) && !isAccountingManager(user) && !isAccountingOfficer(user)) {
    throw new Error('เฉพาะเจ้าหน้าที่บัญชี ผู้จัดการบัญชี หรือ Admin เท่านั้น');
  }
}

function assertCanApproveRentalContract(user: User): void {
  if (!isSystemAdmin(user) && !isAccountingManager(user)) {
    throw new Error('อนุมัติหรือยกเลิกสัญญาได้เฉพาะผู้จัดการบัญชีหรือ Admin');
  }
}

export function assertCanEditRentalContract(user: User, contract: Pick<RentalContract, 'status'>): void {
  if (isSystemAdmin(user) || isAccountingManager(user)) return;
  if (
    isAccountingOfficer(user) &&
    contract.status !== 'CANCELLED' &&
    contract.status !== 'EXPIRED' &&
    contract.status !== 'PENDING_APPROVAL'
  ) {
    return;
  }
  throw new Error(
    'แก้ไขสัญญาได้เฉพาะแผนกบัญชีหรือ Admin — สถานะรออนุมัติ/ยกเลิก/สิ้นสุดแก้ไม่ได้',
  );
}

export function rentalPayableId(contractId: string, periodMonth: string): string {
  return `${contractId}_${periodMonth}`;
}

function ymd(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** วันครบกำหนดของเดือน — cap วัน 29/30/31 ตามวันสุดท้าย และไม่ให้อยู่นอกช่วงสัญญา */
export function rentalDueDateForMonth(contract: RentalContract, periodMonth: string): string {
  const [year, month] = periodMonth.split('-').map(Number);
  const monthIndex = month - 1;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  let due = ymd(year, monthIndex, Math.min(lastDay, Math.max(1, contract.paymentDayOfMonth)));
  if (periodMonth === contract.startDate.slice(0, 7) && due < contract.startDate) due = contract.startDate;
  if (periodMonth === contract.endDate.slice(0, 7) && due > contract.endDate) due = contract.endDate;
  return due;
}

/** รายการเดือน YYYY-MM ในช่วงสัญญา */
export function listRentalContractMonths(startYmd: string, endYmd: string): string[] {
  return monthsBetween(startYmd, endYmd);
}

function monthsBetween(startYmd: string, endYmd: string): string[] {
  const [sy, sm] = startYmd.slice(0, 7).split('-').map(Number);
  const [ey, em] = endYmd.slice(0, 7).split('-').map(Number);
  const rows: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    rows.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      y += 1;
      m = 1;
    }
  }
  return rows;
}

export async function createRentalContract(
  db: Firestore,
  user: User,
  input: {
    leaseKind: 'PROPERTY' | 'VEHICLE';
    lessor: Vendor;
    rentedItemDescription: string;
    monthlyRentAmount: number;
    startDate: string;
    endDate: string;
    paymentDayOfMonth: number;
    withholdingTaxRatePercent: number;
    /** ไม่ระบุ = เดาจากประเภทผู้ให้เช่า (นิติบุคคล 7% · บุคคล 0%) */
    vatRatePercent?: number;
    vatSource?: 'AUTO_BY_LESSOR' | 'MANUAL';
    notes?: string;
    madeAtLocation?: string;
    contractDate?: string;
    propertyAddress?: string;
    propertyCategory?: 'HOUSE' | 'BUILDING' | 'FACTORY' | 'OTHER';
    vehicleBrand?: string;
    vehiclePlateNo?: string;
    leaseDurationMonths?: number;
    advanceRentMonths?: number;
    securityDepositAmount?: number;
    payoutWorkflow?: RentalPayoutWorkflow;
  },
): Promise<string> {
  assertCanCreateRentalContract(user);
  if (!input.lessor?.id) throw new Error('กรุณาเลือกผู้ให้เช่า');
  const leaseKind = input.leaseKind === 'VEHICLE' ? 'VEHICLE' : 'PROPERTY';
  if (leaseKind === 'VEHICLE') {
    if (!input.vehicleBrand?.trim()) throw new Error('กรุณาระบุยี่ห้อรถยนต์');
    if (!input.vehiclePlateNo?.trim()) throw new Error('กรุณาระบุเลขทะเบียน');
  } else if (!input.rentedItemDescription.trim() && !input.propertyAddress?.trim()) {
    throw new Error('กรุณาระบุสิ่งที่เช่าหรือที่ตั้งทรัพย์สิน');
  }
  const monthlyRentAmount = roundMoney2(input.monthlyRentAmount);
  if (monthlyRentAmount <= 0) throw new Error('ค่าเช่าต่อเดือนต้องมากกว่า 0');
  if (!input.startDate || !input.endDate || input.endDate < input.startDate) {
    throw new Error('ช่วงวันที่สัญญาไม่ถูกต้อง');
  }
  const paymentDayOfMonth = Math.trunc(input.paymentDayOfMonth);
  if (paymentDayOfMonth < 1 || paymentDayOfMonth > 31) throw new Error('วันที่จ่ายต้องอยู่ระหว่าง 1–31');
  const rate = roundMoney2(input.withholdingTaxRatePercent);
  if (rate < 0 || rate > 100) throw new Error('อัตราหัก ณ ที่จ่ายไม่ถูกต้อง');

  const vatSource = input.vatSource === 'MANUAL' ? 'MANUAL' : 'AUTO_BY_LESSOR';
  const vatRatePercent =
    input.vatRatePercent != null && Number.isFinite(Number(input.vatRatePercent))
      ? roundMoney2(Math.max(0, Number(input.vatRatePercent)))
      : defaultVatRateForLessor(input.lessor);
  if (vatRatePercent < 0 || vatRatePercent > 100) throw new Error('อัตรา VAT ไม่ถูกต้อง');

  const rentedItemDescription =
    leaseKind === 'VEHICLE'
      ? `รถยนต์ ${input.vehicleBrand!.trim()} ทะเบียน ${input.vehiclePlateNo!.trim()}`
      : input.rentedItemDescription.trim() || input.propertyAddress!.trim();

  const tenantName = await resolveTenantNameFromSystem(db);

  const { code: contractNo } = await generateNextDocumentCode(db, 'rental_contract', {
    actor: actorName(user),
    userId: user.id,
  });
  const ref = doc(collection(db, 'rental_contracts'));
  const now = Date.now();
  const row: RentalContract = {
    id: ref.id,
    contractNo,
    leaseKind,
    lessorVendorId: input.lessor.id,
    lessorVendorName: input.lessor.vendorName,
    tenantName,
    rentedItemDescription,
    monthlyRentAmount,
    startDate: input.startDate,
    endDate: input.endDate,
    paymentDayOfMonth,
    withholdingTaxRatePercent: rate,
    vatRatePercent,
    vatSource,
    payoutWorkflow: input.payoutWorkflow === 'BILL_FIRST' ? 'BILL_FIRST' : 'AUTO_NOTIFY',
    status: 'DRAFT',
    revision: 0,
    ...(input.madeAtLocation?.trim() ? { madeAtLocation: input.madeAtLocation.trim() } : {}),
    ...(input.contractDate?.trim() ? { contractDate: input.contractDate.trim() } : {}),
    ...(input.propertyAddress?.trim() ? { propertyAddress: input.propertyAddress.trim() } : {}),
    ...(input.propertyCategory ? { propertyCategory: input.propertyCategory } : {}),
    ...(leaseKind === 'VEHICLE' && input.vehicleBrand?.trim()
      ? { vehicleBrand: input.vehicleBrand.trim() }
      : {}),
    ...(leaseKind === 'VEHICLE' && input.vehiclePlateNo?.trim()
      ? { vehiclePlateNo: input.vehiclePlateNo.trim() }
      : {}),
    ...(typeof input.leaseDurationMonths === 'number' && Number.isFinite(input.leaseDurationMonths)
      ? { leaseDurationMonths: Math.max(0, Math.trunc(input.leaseDurationMonths)) }
      : {}),
    ...(typeof input.advanceRentMonths === 'number' && Number.isFinite(input.advanceRentMonths)
      ? { advanceRentMonths: Math.max(0, Math.trunc(input.advanceRentMonths)) }
      : {}),
    ...(typeof input.securityDepositAmount === 'number' && Number.isFinite(input.securityDepositAmount)
      ? { securityDepositAmount: roundMoney2(input.securityDepositAmount) }
      : {}),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    createdAt: now,
    createdByUid: user.id,
    createdByName: actorName(user),
    updatedAt: now,
  };
  const batch = writeBatch(db);
  batch.set(ref, row);
  await batch.commit();
  await writeAuditLog(db, user, {
    actionType: 'CREATE',
    entityType: 'RentalContract',
    entityId: ref.id,
    entityLabel: contractNo,
    sourceModule: 'accounting',
    sourcePath: `/accounting/rental-contracts/${ref.id}`,
    afterSummary: `สร้างสัญญาเช่า ${contractNo} · ${input.lessor.vendorName} · ${monthlyRentAmount.toFixed(2)} บาท/เดือน · VAT ${vatRatePercent}%`,
    changedFields: ['status'],
    linkedIds: [ref.id, input.lessor.id],
  });
  return ref.id;
}

export async function submitRentalContractForApproval(db: Firestore, user: User, contract: RentalContract): Promise<void> {
  assertCanCreateRentalContract(user);
  if (contract.status !== 'DRAFT' && contract.status !== 'REJECTED') {
    throw new Error('ส่งอนุมัติได้เฉพาะสัญญาร่างหรือรายการที่ถูกส่งกลับ');
  }
  const now = Date.now();
  await updateDoc(doc(db, 'rental_contracts', contract.id), {
    status: 'PENDING_APPROVAL',
    submittedAt: now,
    submittedByUid: user.id,
    submittedByName: actorName(user),
    updatedAt: now,
  });
  await writeAuditLog(db, user, {
    actionType: 'SUBMIT',
    entityType: 'RentalContract',
    entityId: contract.id,
    entityLabel: contract.contractNo,
    sourceModule: 'accounting',
    sourcePath: `/accounting/rental-contracts/${contract.id}`,
    beforeSummary: contract.status,
    afterSummary: 'PENDING_APPROVAL',
    changedFields: ['status', 'submittedAt'],
    linkedIds: [contract.id],
  });
}

export async function approveRentalContract(db: Firestore, user: User, contract: RentalContract): Promise<number> {
  assertCanApproveRentalContract(user);
  if (contract.status !== 'PENDING_APPROVAL') throw new Error('สัญญานี้ไม่ได้อยู่ระหว่างรออนุมัติ');
  const now = Date.now();
  const approved: RentalContract = {
    ...contract,
    status: 'ACTIVE',
    approvedAt: now,
    approvedByUid: user.id,
    approvedByName: actorName(user),
    updatedAt: now,
  };
  await updateDoc(doc(db, 'rental_contracts', contract.id), {
    status: 'ACTIVE',
    approvedAt: now,
    approvedByUid: user.id,
    approvedByName: actorName(user),
    updatedAt: now,
  });
  const created = await generateDueRentalPayables(db, approved);
  await writeAuditLog(db, user, {
    actionType: 'APPROVE',
    entityType: 'RentalContract',
    entityId: contract.id,
    entityLabel: contract.contractNo,
    sourceModule: 'accounting',
    sourcePath: `/accounting/rental-contracts/${contract.id}`,
    beforeSummary: 'PENDING_APPROVAL',
    afterSummary: `ACTIVE · สร้างรายการถึงกำหนด ${created} รายการ`,
    changedFields: ['status', 'approvedAt'],
    linkedIds: [contract.id],
  });
  return created;
}

export async function rejectRentalContract(
  db: Firestore,
  user: User,
  contract: RentalContract,
  reason: string,
): Promise<void> {
  assertCanApproveRentalContract(user);
  if (contract.status !== 'PENDING_APPROVAL') throw new Error('สัญญานี้ไม่ได้อยู่ระหว่างรออนุมัติ');
  if (!reason.trim()) throw new Error('กรุณาระบุเหตุผล');
  const now = Date.now();
  await updateDoc(doc(db, 'rental_contracts', contract.id), {
    status: 'REJECTED',
    rejectionReason: reason.trim(),
    rejectedAt: now,
    rejectedByUid: user.id,
    rejectedByName: actorName(user),
    updatedAt: now,
  });
}

export async function cancelRentalContract(
  db: Firestore,
  user: User,
  contract: RentalContract,
  reason: string,
): Promise<void> {
  assertCanApproveRentalContract(user);
  if (contract.status === 'CANCELLED') throw new Error('สัญญานี้ถูกยกเลิกแล้ว');
  if (!reason.trim()) throw new Error('กรุณาระบุเหตุผลยกเลิก');
  const now = Date.now();
  const payablesSnap = await import('firebase/firestore').then(({ getDocs, query, where }) =>
    getDocs(query(collection(db, 'rental_payables'), where('contractId', '==', contract.id))),
  );
  const batch = writeBatch(db);
  batch.update(doc(db, 'rental_contracts', contract.id), {
    status: 'CANCELLED',
    cancellationReason: reason.trim(),
    cancelledAt: now,
    cancelledByUid: user.id,
    cancelledByName: actorName(user),
    updatedAt: now,
  });
  for (const row of payablesSnap.docs) {
    if (row.data().status !== 'PENDING') continue;
    batch.update(row.ref, { status: 'VOID', voidedAt: now, voidReason: reason.trim(), updatedAt: now });
    batch.set(
      doc(db, 'accounts_payable', row.id),
      { status: 'PAID', outstandingAmount: 0, updatedAt: now },
      { merge: true },
    );
  }
  await batch.commit();
  await writeAuditLog(db, user, {
    actionType: 'CANCEL',
    entityType: 'RentalContract',
    entityId: contract.id,
    entityLabel: contract.contractNo,
    sourceModule: 'accounting',
    sourcePath: `/accounting/rental-contracts/${contract.id}`,
    beforeSummary: contract.status,
    afterSummary: `CANCELLED · ${reason.trim()}`,
    changedFields: ['status', 'cancelledAt'],
    linkedIds: [contract.id],
  });
}

/** สร้างเฉพาะรอบที่ครบกำหนดแล้ว; id deterministic ป้องกันรายการซ้ำ */
export async function generateDueRentalPayables(
  db: Firestore,
  contract: RentalContract,
  todayYmd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
): Promise<number> {
  if (contract.status !== 'ACTIVE') return 0;
  /** โหมดใบวางบิลก่อน — ไม่สร้างคิวโอนอัตโนมัติ */
  if (resolveRentalPayoutWorkflow(contract) === 'BILL_FIRST') return 0;
  const horizon = todayYmd < contract.endDate ? todayYmd : contract.endDate;
  if (horizon < contract.startDate) return 0;
  let created = 0;
  for (const month of monthsBetween(contract.startDate, horizon)) {
    const dueDate = rentalDueDateForMonth(contract, month);
    if (dueDate > todayYmd || dueDate < contract.startDate || dueDate > contract.endDate) continue;
    const id = rentalPayableId(contract.id, month);
    const payableRef = doc(db, 'rental_payables', id);
    const apRef = doc(db, 'accounts_payable', id);
    const amounts = computeRentalMonthAmounts({
      monthlyRentAmount: contract.monthlyRentAmount,
      vatRatePercent: resolveContractVatRatePercent(contract),
      withholdingTaxRatePercent: contract.withholdingTaxRatePercent,
    });
    const wasCreated = await runTransaction(db, async (tx) => {
      const existing = await tx.get(payableRef);
      if (existing.exists()) return false;
      const now = Date.now();
      const payable: RentalPayable = {
        id,
        contractId: contract.id,
        contractNo: contract.contractNo,
        vendorId: contract.lessorVendorId,
        vendorName: contract.lessorVendorName,
        periodMonth: month,
        dueDate,
        description: `ค่าเช่า ${contract.rentedItemDescription} ประจำเดือน ${month}`,
        baseRentAmount: amounts.baseRentAmount,
        vatRatePercent: amounts.vatRatePercent,
        vatAmount: amounts.vatAmount,
        grossAmount: amounts.grossAmount,
        withholdingTaxRatePercent: amounts.withholdingTaxRatePercent,
        withholdingTaxAmount: amounts.withholdingTaxAmount,
        netPayableAmount: amounts.netPayableAmount,
        status: 'PENDING',
        apEntryId: id,
        createdAt: now,
        updatedAt: now,
      };
      tx.set(payableRef, payable);
      tx.set(apRef, {
        id,
        vendorId: contract.lessorVendorId,
        documentNo: `${contract.contractNo}/${month}`,
        referenceId: id,
        billDate: dueDate,
        dueDate,
        debitAmount: amounts.grossAmount,
        creditAmount: 0,
        outstandingAmount: amounts.grossAmount,
        status: dueDate < todayYmd ? 'OVERDUE' : 'OPEN',
        origin: 'RENTAL_CONTRACT',
        rentalPayableId: id,
        rentalContractId: contract.id,
        createdAt: now,
        updatedAt: now,
      });
      return true;
    });
    if (wasCreated) created += 1;
  }
  return created;
}

export async function payRentalPayable(
  db: Firestore,
  user: User,
  params: {
    contract: RentalContract;
    payable: RentalPayable;
    vendor: Vendor;
    bankAccountId: string;
    paymentMethod: PaymentMethod;
    entryDate: string;
    /** หลักฐานโอนเงิน — บังคับเหมือนใบวางบิล */
    paymentProofUrl: string;
    paymentProofFileName: string;
    whtPaymentProofUrl?: string;
    whtPaymentProofFileName?: string;
    vendorPayeeBankAccountId?: string;
    vendorPayeeBankName?: string;
    vendorPayeeBankAccountName?: string;
    vendorPayeeBankAccountNumber?: string;
    supportingDeliveryNote?: VendorBillSupportingDocumentLink;
    supportingTaxInvoice?: VendorBillSupportingDocumentLink;
    supportingMoneyReceipt?: VendorBillSupportingDocumentLink;
  },
): Promise<{ cashbookEntryNo: string; whtCertificateId?: string }> {
  if (!canExecuteBankCashbookPayments(user)) {
    throw new Error('ทำจ่ายได้เฉพาะผู้จัดการบัญชีหรือ Admin');
  }
  const { contract, payable, vendor } = params;
  if (contract.status !== 'ACTIVE' && contract.status !== 'EXPIRED') throw new Error('สัญญาไม่อยู่ในสถานะทำจ่าย');
  if (payable.status !== 'PENDING' || payable.cashbookEntryId) throw new Error('รายการนี้ถูกจ่ายหรือยกเลิกแล้ว');
  if (!params.entryDate) throw new Error('กรุณาระบุวันที่ทำรายการ');
  if (!params.paymentProofUrl?.trim() || !params.paymentProofFileName?.trim()) {
    throw new Error('กรุณาแนบหลักฐานโอนเงิน');
  }
  const [bankSnap, companySnap] = await Promise.all([
    getDoc(doc(db, 'bank_accounts', params.bankAccountId)),
    getDoc(doc(db, 'system', 'company_profile')),
  ]);
  if (!bankSnap.exists()) throw new Error('ไม่พบบัญชีธนาคาร');
  const bank = { id: bankSnap.id, ...bankSnap.data() } as BankAccount;
  if (bank.status && bank.status !== 'ACTIVE') throw new Error('บัญชีธนาคารไม่ ACTIVE');

  const actor = actorName(user);
  const { code: entryNo } = await generateNextDocumentCode(db, 'cashbook_entry', {
    actor,
    userId: user.id,
  });
  const now = Date.now();
  const cashbookRef = doc(collection(db, 'cashbook_entries'));
  const payableRef = doc(db, 'rental_payables', payable.id);
  const apRef = doc(db, 'accounts_payable', payable.apEntryId || payable.id);
  const amountFromBank = roundMoney2(payable.netPayableAmount);
  const baseRent = roundMoney2(
    payable.baseRentAmount != null && payable.baseRentAmount > 0
      ? payable.baseRentAmount
      : payable.grossAmount - (Number(payable.vatAmount) || 0),
  );
  const vatAmount = roundMoney2(
    payable.vatAmount != null
      ? payable.vatAmount
      : Math.max(0, payable.grossAmount - baseRent),
  );
  const vatRate = resolveContractVatRatePercent({
    vatRatePercent: payable.vatRatePercent ?? contract.vatRatePercent,
  });
  const description = `จ่ายค่าเช่า ${payable.vendorName} · ${contract.rentedItemDescription} · ${payable.periodMonth}${
    vatAmount > 0.005 ? ` · VAT ${vatAmount.toFixed(2)}` : ''
  }${
    payable.withholdingTaxAmount > 0 ? ` · หัก ณ ที่จ่าย ${payable.withholdingTaxAmount.toFixed(2)} บาท` : ''
  }`;
  const cashbookShape: CashbookEntry = {
    id: cashbookRef.id,
    entryNo,
    bankAccountId: params.bankAccountId,
    entryDate: params.entryDate,
    direction: 'OUT',
    entryType: 'SUPPLIER_PAYMENT',
    referenceType: 'PAYMENT',
    referenceId: payable.id,
    amount: amountFromBank,
    grossPaymentAmount: payable.grossAmount,
    ...(payable.withholdingTaxAmount > 0
      ? { supplierWithholdingAmount: payable.withholdingTaxAmount }
      : {}),
    description,
    paymentMethod: params.paymentMethod,
    createdAt: now,
    updatedAt: now,
  };

  const payablePaidPatch: Record<string, unknown> = {
    status: 'PAID',
    paidAt: now,
    paidByUid: user.id,
    paidByName: actor,
    bankAccountId: params.bankAccountId,
    paymentMethod: params.paymentMethod,
    cashbookEntryId: cashbookRef.id,
    cashbookEntryNo: entryNo,
    paymentProofUrl: params.paymentProofUrl.trim(),
    paymentProofFileName: params.paymentProofFileName.trim(),
    updatedAt: now,
  };
  if (params.whtPaymentProofUrl?.trim()) {
    payablePaidPatch.whtPaymentProofUrl = params.whtPaymentProofUrl.trim();
    payablePaidPatch.whtPaymentProofFileName = (params.whtPaymentProofFileName || '').trim() || null;
  }
  if (params.vendorPayeeBankAccountId || params.vendorPayeeBankName || params.vendorPayeeBankAccountNumber) {
    payablePaidPatch.vendorPayeeBankAccountId = params.vendorPayeeBankAccountId || null;
    payablePaidPatch.vendorPayeeBankName = params.vendorPayeeBankName || null;
    payablePaidPatch.vendorPayeeBankAccountName = params.vendorPayeeBankAccountName || null;
    payablePaidPatch.vendorPayeeBankAccountNumber = params.vendorPayeeBankAccountNumber || null;
  }
  if (params.supportingDeliveryNote) {
    payablePaidPatch.supportingDeliveryNote = params.supportingDeliveryNote;
  }
  if (params.supportingTaxInvoice) {
    payablePaidPatch.supportingTaxInvoice = params.supportingTaxInvoice;
  }
  if (params.supportingMoneyReceipt) {
    payablePaidPatch.supportingMoneyReceipt = params.supportingMoneyReceipt;
  }

  const batch = writeBatch(db);
  batch.set(cashbookRef, {
    ...cashbookShape,
    createdByUid: user.id,
    createdByName: actor,
  });
  batch.update(doc(db, 'bank_accounts', params.bankAccountId), {
    currentBalance: increment(-amountFromBank),
    updatedAt: now,
  });
  batch.update(payableRef, payablePaidPatch as any);
  batch.set(
    apRef,
    {
      creditAmount: payable.grossAmount,
      outstandingAmount: 0,
      status: 'PAID',
      updatedAt: now,
    },
    { merge: true },
  );

  let whtCertificateId: string | undefined;
  if (payable.withholdingTaxAmount > 0.005) {
    const whtRef = doc(collection(db, 'withholding_at_source_items'));
    batch.set(whtRef, {
      id: whtRef.id,
      vendorId: vendor.id,
      vendorName: vendor.vendorName,
      purchaseId: contract.id,
      purchaseNo: contract.contractNo,
      vendorBillId: payable.id,
      receiptNo: `${contract.contractNo}/${payable.periodMonth}`,
      grossPaymentAmount: payable.grossAmount,
      baseBeforeVat: baseRent,
      whtAmount: payable.withholdingTaxAmount,
      ratePercent: payable.withholdingTaxRatePercent,
      status: 'OUTSTANDING',
      cashbookEntryId: cashbookRef.id,
      cashbookEntryNo: entryNo,
      entryDate: params.entryDate,
      sourceRentalContractId: contract.id,
      sourceRentalPayableId: payable.id,
      createdAt: now,
      updatedAt: now,
    });

    const syntheticBill = {
      id: payable.id,
      receiptNo: `${contract.contractNo}/${payable.periodMonth}`,
      purchaseId: contract.id,
      vendorId: vendor.id,
      billingReceivedDate: payable.dueDate,
      plannedPaymentDate: payable.dueDate,
      status: 'PAID',
      billAmount: payable.grossAmount,
      billVatTreatment: vatRate > 0 ? 'VAT_7' : 'NONE',
      supplierWithholdingEnabledBill: true,
      supplierWithholdingRatePercentBill: payable.withholdingTaxRatePercent,
      supplierWithholdingTaxBaseBill: baseRent,
      vendorBillWhtPresetCategory: 'RENT',
      notes: payable.description,
      createdAt: payable.createdAt,
      updatedAt: now,
    } as PurchaseVendorBill;
    const syntheticPurchase = {
      id: contract.id,
      purchaseNo: contract.contractNo,
      totalAmount: payable.grossAmount,
      amountBeforeTax: baseRent,
      taxAmount: vatAmount,
      purchaseLineMode: 'SERVICE',
      supplierWithholdingEnabled: true,
      supplierWithholdingRatePercent: payable.withholdingTaxRatePercent,
      notes: contract.rentedItemDescription,
    } as unknown as Purchase;
    const draft = buildWithholdingCertificateDraft({
      bill: syntheticBill,
      purchase: syntheticPurchase,
      vendor,
      company: (companySnap.exists() ? companySnap.data() : {}) as CompanyProfileWhtInput,
      milestone: undefined,
      cashbook: cashbookShape,
      bank,
      paymentDateYmd: params.entryDate,
      paymentIssueDateYmd: params.entryDate,
      paymentMethod: params.paymentMethod,
      sourceWithholdingAtSourceItemId: whtRef.id,
    });
    draft.createdByUid = user.id;
    draft.createdByName = actor;
    draft.sourceRentalContractId = contract.id;
    draft.sourceRentalPayableId = payable.id;
    draft.jobDescription = `ค่าเช่า · ${contract.rentedItemDescription} · ประจำเดือน ${payable.periodMonth}`;
    const errors = validateWhtCertificateForOfficialIssue(draft);
    if (errors.length) throw new Error(errors.join(' '));
    const { code: certificateNo } = await generateNextDocumentCode(db, 'wht_certificate_50', {
      actor,
      userId: user.id,
      date: new Date(`${params.entryDate}T12:00:00`),
    });
    const certRef = doc(collection(db, 'withholding_certificate_documents'));
    const issued = {
      id: certRef.id,
      ...draft,
      certificateNo,
      documentStatus: 'ISSUED' as const,
      paymentIssueDate: params.entryDate,
      issuedAt: now,
      issuedByUid: user.id,
      issuedByName: actor,
    };
    issued.whtElectronicData = stripUndefinedForFirestore({
      ...buildWhtElectronicDataFromDocument(issued),
      xmlExportStatus: 'NOT_EXPORTED',
    });
    batch.set(certRef, stripUndefinedForFirestore(issued));
    const certAuditRef = doc(collection(db, 'withholding_certificate_documents', certRef.id, 'audit_logs'));
    batch.set(
      certAuditRef,
      stripUndefinedForFirestore({
        id: certAuditRef.id,
        ...buildWhtAuditLogEntry({
          documentId: certRef.id,
          action: 'CREATE_WHT',
          actorId: user.id,
          actorName: actor,
          payloadSummary: {
            sourceRentalContractId: contract.id,
            sourceRentalPayableId: payable.id,
            autoIssued: true,
            certificateNo,
          },
        }),
      }),
    );
    batch.update(payableRef, { whtCertificateDocumentId: certRef.id });
    whtCertificateId = certRef.id;
  }

  await batch.commit();
  await writeAuditLog(db, user, {
    actionType: 'PAY',
    entityType: 'RentalPayable',
    entityId: payable.id,
    entityLabel: `${contract.contractNo}/${payable.periodMonth}`,
    sourceModule: 'accounting',
    sourcePath: `/accounting/rental-contracts/${contract.id}`,
    beforeSummary: 'PENDING',
    afterSummary: `PAID · ${entryNo} · สุทธิจ่าย ${amountFromBank.toFixed(2)} บาท`,
    changedFields: [
      'status',
      'cashbookEntryId',
      'paidAt',
      'paymentProofUrl',
      'whtCertificateDocumentId',
      'supportingMoneyReceipt',
    ],
    linkedIds: [contract.id, payable.id, cashbookRef.id, ...(whtCertificateId ? [whtCertificateId] : [])],
  });
  return { cashbookEntryNo: entryNo, whtCertificateId };
}

/** อัปเดตเอกสารประกอบของรอบค่าเช่า (ใบส่งของ / ใบกำกับ / ใบเสร็จ) — ใช้ได้หลังจ่ายแล้ว */
export async function updateRentalPayableSupportingDocuments(
  db: Firestore,
  user: User,
  payable: RentalPayable,
  docs: {
    supportingDeliveryNote?: VendorBillSupportingDocumentLink;
    supportingTaxInvoice?: VendorBillSupportingDocumentLink;
    supportingMoneyReceipt?: VendorBillSupportingDocumentLink;
  },
): Promise<void> {
  if (!isSystemAdmin(user) && !isAccountingManager(user) && !isAccountingOfficer(user)) {
    throw new Error('บันทึกเอกสารประกอบได้เฉพาะแผนกบัญชีหรือ Admin');
  }
  if (payable.status === 'VOID') throw new Error('รายการถูกยกเลิกแล้ว');
  const now = Date.now();
  await updateDoc(doc(db, 'rental_payables', payable.id), {
    ...(docs.supportingDeliveryNote !== undefined
      ? { supportingDeliveryNote: docs.supportingDeliveryNote }
      : {}),
    ...(docs.supportingTaxInvoice !== undefined
      ? { supportingTaxInvoice: docs.supportingTaxInvoice }
      : {}),
    ...(docs.supportingMoneyReceipt !== undefined
      ? { supportingMoneyReceipt: docs.supportingMoneyReceipt }
      : {}),
    updatedAt: now,
  });
  await writeAuditLog(db, user, {
    actionType: 'UPDATE',
    entityType: 'RentalPayable',
    entityId: payable.id,
    entityLabel: `${payable.contractNo}/${payable.periodMonth}`,
    sourceModule: 'accounting',
    sourcePath: `/accounting/rental-contracts/${payable.contractId}`,
    beforeSummary: JSON.stringify({
      supportingDeliveryNote: payable.supportingDeliveryNote ?? null,
      supportingTaxInvoice: payable.supportingTaxInvoice ?? null,
      supportingMoneyReceipt: payable.supportingMoneyReceipt ?? null,
    }),
    afterSummary: JSON.stringify(docs),
    changedFields: Object.keys(docs),
    linkedIds: [payable.contractId, payable.id],
  });
}

const RENTAL_EDITABLE_FIELDS = [
  'monthlyRentAmount',
  'vatRatePercent',
  'vatSource',
  'withholdingTaxRatePercent',
  'paymentDayOfMonth',
  'payoutWorkflow',
  'startDate',
  'endDate',
  'notes',
  'madeAtLocation',
  'contractDate',
  'propertyAddress',
  'propertyCategory',
  'vehicleBrand',
  'vehiclePlateNo',
  'leaseDurationMonths',
  'advanceRentMonths',
  'securityDepositAmount',
  'rentedItemDescription',
] as const;

export type RentalContractEditableField = (typeof RENTAL_EDITABLE_FIELDS)[number];

export type RentalContractEditPatch = Partial<
  Pick<RentalContract, RentalContractEditableField>
>;

function snapshotEditable(contract: RentalContract): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of RENTAL_EDITABLE_FIELDS) {
    out[key] = (contract as unknown as Record<string, unknown>)[key] ?? null;
  }
  return out;
}

/** อัปเดตรอบ PENDING ให้ตรงจำนวนเงินใหม่หลังแก้สัญญา */
export async function refreshPendingRentalPayablesAmounts(
  db: Firestore,
  contract: RentalContract,
): Promise<number> {
  const snap = await getDocs(
    query(
      collection(db, 'rental_payables'),
      where('contractId', '==', contract.id),
      where('status', '==', 'PENDING'),
    ),
  );
  if (snap.empty) return 0;
  const amounts = computeRentalMonthAmounts({
    monthlyRentAmount: contract.monthlyRentAmount,
    vatRatePercent: resolveContractVatRatePercent(contract),
    withholdingTaxRatePercent: contract.withholdingTaxRatePercent,
  });
  const batch = writeBatch(db);
  const now = Date.now();
  let n = 0;
  for (const d of snap.docs) {
    const payable = d.data() as RentalPayable;
    batch.update(d.ref, {
      baseRentAmount: amounts.baseRentAmount,
      vatRatePercent: amounts.vatRatePercent,
      vatAmount: amounts.vatAmount,
      grossAmount: amounts.grossAmount,
      withholdingTaxRatePercent: amounts.withholdingTaxRatePercent,
      withholdingTaxAmount: amounts.withholdingTaxAmount,
      netPayableAmount: amounts.netPayableAmount,
      dueDate: rentalDueDateForMonth(contract, payable.periodMonth),
      description: `ค่าเช่า ${contract.rentedItemDescription} ประจำเดือน ${payable.periodMonth}`,
      updatedAt: now,
    });
    const apId = payable.apEntryId || payable.id;
    batch.set(
      doc(db, 'accounts_payable', apId),
      {
        debitAmount: amounts.grossAmount,
        outstandingAmount: amounts.grossAmount,
        dueDate: rentalDueDateForMonth(contract, payable.periodMonth),
        updatedAt: now,
      },
      { merge: true },
    );
    n += 1;
  }
  await batch.commit();
  return n;
}

/**
 * แก้ไขหัวสัญญา + บันทึกประวัติ (change_logs + audit_logs)
 * ถ้าแก้จำนวนเงิน/VAT/หัก ณ ที่จ่าย จะอัปเดตรอบ PENDING ให้ตรง (ไม่แตะรอบที่จ่ายแล้ว)
 */
export async function updateRentalContract(
  db: Firestore,
  user: User,
  contract: RentalContract,
  patch: RentalContractEditPatch,
): Promise<{ changedFields: string[]; pendingPayablesUpdated: number }> {
  assertCanEditRentalContract(user, contract);
  if (
    contract.status === 'CANCELLED' ||
    contract.status === 'EXPIRED' ||
    contract.status === 'PENDING_APPROVAL'
  ) {
    throw new Error('ไม่สามารถแก้ไขสัญญาในสถานะนี้ได้ — รออนุมัติหรือสัญญาที่ปิดแล้วแก้ไม่ได้');
  }

  const before = snapshotEditable(contract);
  const next: RentalContract = { ...contract };

  if (patch.monthlyRentAmount != null) {
    const v = roundMoney2(patch.monthlyRentAmount);
    if (v <= 0) throw new Error('ค่าเช่าต่อเดือนต้องมากกว่า 0');
    next.monthlyRentAmount = v;
  }
  if (patch.withholdingTaxRatePercent != null) {
    const v = roundMoney2(patch.withholdingTaxRatePercent);
    if (v < 0 || v > 100) throw new Error('อัตราหัก ณ ที่จ่ายไม่ถูกต้อง');
    next.withholdingTaxRatePercent = v;
  }
  if (patch.vatRatePercent != null) {
    const v = roundMoney2(patch.vatRatePercent);
    if (v < 0 || v > 100) throw new Error('อัตรา VAT ไม่ถูกต้อง');
    next.vatRatePercent = v;
  }
  if (patch.vatSource === 'AUTO_BY_LESSOR' || patch.vatSource === 'MANUAL') {
    next.vatSource = patch.vatSource;
  }
  if (patch.paymentDayOfMonth != null) {
    const d = Math.trunc(patch.paymentDayOfMonth);
    if (d < 1 || d > 31) throw new Error('วันที่จ่ายต้องอยู่ระหว่าง 1–31');
    next.paymentDayOfMonth = d;
  }
  if (patch.payoutWorkflow === 'AUTO_NOTIFY' || patch.payoutWorkflow === 'BILL_FIRST') {
    next.payoutWorkflow = patch.payoutWorkflow;
  }
  if (patch.startDate != null) next.startDate = patch.startDate;
  if (patch.endDate != null) next.endDate = patch.endDate;
  if (next.endDate < next.startDate) throw new Error('ช่วงวันที่สัญญาไม่ถูกต้อง');

  const stringFields = [
    'notes',
    'madeAtLocation',
    'contractDate',
    'propertyAddress',
    'vehicleBrand',
    'vehiclePlateNo',
    'rentedItemDescription',
  ] as const;
  for (const key of stringFields) {
    if (patch[key] !== undefined) {
      const raw = String(patch[key] ?? '').trim();
      (next as unknown as Record<string, unknown>)[key] = raw || undefined;
    }
  }
  if (patch.propertyCategory !== undefined) next.propertyCategory = patch.propertyCategory;
  if (patch.leaseDurationMonths !== undefined) {
    next.leaseDurationMonths = Math.max(0, Math.trunc(Number(patch.leaseDurationMonths) || 0));
  }
  if (patch.advanceRentMonths !== undefined) {
    next.advanceRentMonths = Math.max(0, Math.trunc(Number(patch.advanceRentMonths) || 0));
  }
  if (patch.securityDepositAmount !== undefined) {
    next.securityDepositAmount = roundMoney2(Math.max(0, Number(patch.securityDepositAmount) || 0));
  }

  if (next.leaseKind === 'VEHICLE' || contract.leaseKind === 'VEHICLE') {
    const brand = (next.vehicleBrand || '').trim();
    const plate = (next.vehiclePlateNo || '').trim();
    if (brand && plate) {
      next.rentedItemDescription = `รถยนต์ ${brand} ทะเบียน ${plate}`;
    }
  }

  const after = snapshotEditable(next);
  const changedFields = RENTAL_EDITABLE_FIELDS.filter(
    (k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null),
  ) as string[];
  if (changedFields.length === 0) {
    throw new Error('ไม่มีการเปลี่ยนแปลงข้อมูล');
  }

  const moneyChanged = changedFields.some((f) =>
    ['monthlyRentAmount', 'vatRatePercent', 'withholdingTaxRatePercent'].includes(f),
  );

  const now = Date.now();
  const actor = actorName(user);
  const revision = Math.max(0, Number(contract.revision) || 0) + 1;

  const updatePayload: Record<string, unknown> = {
    updatedAt: now,
    revision,
    lastEditedAt: now,
    lastEditedByUid: user.id,
    lastEditedByName: actor,
  };
  for (const key of changedFields) {
    const val = after[key];
    updatePayload[key] = val === undefined ? null : val;
  }

  await updateDoc(doc(db, 'rental_contracts', contract.id), updatePayload as any);

  const beforeSubset: Record<string, unknown> = {};
  const afterSubset: Record<string, unknown> = {};
  for (const k of changedFields) {
    beforeSubset[k] = before[k];
    afterSubset[k] = after[k];
  }

  await addDoc(collection(db, 'rental_contracts', contract.id, 'change_logs'), {
    actionType: 'UPDATE_CONTRACT_HEADER',
    changedFields,
    beforeSummary: JSON.stringify(beforeSubset),
    afterSummary: JSON.stringify(afterSubset),
    actorUserId: user.id,
    actorName: actor,
    actorRoleKey: user.role || user.accessGroup || '',
    eventAt: now,
  });

  await writeAuditLog(db, user, {
    actionType: 'UPDATE',
    entityType: 'RentalContract',
    entityId: contract.id,
    entityLabel: contract.contractNo,
    sourceModule: 'accounting',
    sourcePath: `/accounting/rental-contracts/${contract.id}`,
    beforeSummary: JSON.stringify(beforeSubset),
    afterSummary: JSON.stringify(afterSubset),
    changedFields,
    linkedIds: [contract.id],
  });

  let pendingPayablesUpdated = 0;
  const shouldRefreshPending =
    moneyChanged || changedFields.includes('paymentDayOfMonth') || changedFields.includes('rentedItemDescription');
  if (shouldRefreshPending && resolveRentalPayoutWorkflow(next) === 'AUTO_NOTIFY') {
    pendingPayablesUpdated = await refreshPendingRentalPayablesAmounts(db, {
      ...next,
      revision,
      lastEditedAt: now,
      lastEditedByUid: user.id,
      lastEditedByName: actor,
      updatedAt: now,
    });
  }

  return { changedFields, pendingPayablesUpdated };
}

/**
 * สร้าง/อัปเดต PO เงาสำหรับสัญญาเช่า (โหมดใบวางบิลก่อน) — ไม่ต้องมี PR
 */
export async function ensureRentalShadowPurchase(
  db: Firestore,
  user: User,
  contract: RentalContract,
): Promise<string> {
  assertCanCreateRentalContract(user);
  const id = rentalShadowPurchaseId(contract.id);
  const ref = doc(db, 'purchases', id);
  const amounts = computeRentalMonthAmounts({
    monthlyRentAmount: contract.monthlyRentAmount,
    vatRatePercent: resolveContractVatRatePercent(contract),
    withholdingTaxRatePercent: contract.withholdingTaxRatePercent,
  });
  const now = Date.now();
  const payload: Purchase & { origin: 'RENTAL_CONTRACT'; rentalContractId: string } = {
    id,
    purchaseNo: contract.contractNo,
    vendorId: contract.lessorVendorId,
    purchaseDate: contract.startDate,
    purchaseType: 'CREDIT',
    totalAmount: amounts.grossAmount,
    amountBeforeTax: amounts.baseRentAmount,
    vatAmount: amounts.vatAmount,
    status: 'ISSUED',
    purchaseLineMode: 'SERVICE',
    vatTreatment: amounts.vatRatePercent > 0 ? 'EXCLUSIVE' : 'NONE',
    supplierWithholdingEnabled: amounts.withholdingTaxRatePercent > 0,
    supplierWithholdingRatePercent: amounts.withholdingTaxRatePercent,
    notes: `สัญญาเช่า ${contract.contractNo} · ${contract.rentedItemDescription}`,
    origin: 'RENTAL_CONTRACT',
    rentalContractId: contract.id,
    createdAt: now,
    updatedAt: now,
    createdByUid: user.id,
    createdByName: actorName(user),
    issuedAt: now,
    issuedByUid: user.id,
    issuedByName: actorName(user),
  };
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, stripUndefinedForFirestore(payload));
  } else {
    await updateDoc(ref, {
      totalAmount: amounts.grossAmount,
      amountBeforeTax: amounts.baseRentAmount,
      vatAmount: amounts.vatAmount,
      vatTreatment: amounts.vatRatePercent > 0 ? 'EXCLUSIVE' : 'NONE',
      supplierWithholdingEnabled: amounts.withholdingTaxRatePercent > 0,
      supplierWithholdingRatePercent: amounts.withholdingTaxRatePercent,
      notes: payload.notes,
      updatedAt: now,
    });
  }
  return id;
}

/**
 * สร้างใบวางบิลอ้างสัญญาเช่าโดยตรง (ไม่ผ่าน PR/PO จริง) — ใช้เมื่อ payoutWorkflow = BILL_FIRST
 */
export async function createRentalVendorBillForPeriod(
  db: Firestore,
  user: User,
  contract: RentalContract,
  periodMonth: string,
): Promise<{ billId: string; receiptNo: string }> {
  assertCanCreateRentalContract(user);
  if (contract.status !== 'ACTIVE' && contract.status !== 'EXPIRED') {
    throw new Error('สร้างใบวางบิลได้เมื่อสัญญาใช้งานหรือสิ้นสุดแล้วเท่านั้น');
  }
  if (!/^\d{4}-\d{2}$/.test(periodMonth)) throw new Error('รูปแบบเดือนไม่ถูกต้อง (YYYY-MM)');
  if (periodMonth < contract.startDate.slice(0, 7) || periodMonth > contract.endDate.slice(0, 7)) {
    throw new Error('เดือนที่เลือกอยู่นอกช่วงสัญญา');
  }

  const dup = await getDocs(
    query(collection(db, 'purchase_vendor_bills'), where('rentalContractId', '==', contract.id)),
  );
  const existingSamePeriod = dup.docs.find(
    (d) => String((d.data() as PurchaseVendorBill).rentalPeriodMonth || '') === periodMonth,
  );
  if (existingSamePeriod) {
    const no = (existingSamePeriod.data() as PurchaseVendorBill).receiptNo || existingSamePeriod.id;
    throw new Error(`มีใบวางบิลสำหรับเดือน ${periodMonth} อยู่แล้ว (${no})`);
  }

  const purchaseId = await ensureRentalShadowPurchase(db, user, contract);
  const amounts = computeRentalMonthAmounts({
    monthlyRentAmount: contract.monthlyRentAmount,
    vatRatePercent: resolveContractVatRatePercent(contract),
    withholdingTaxRatePercent: contract.withholdingTaxRatePercent,
  });
  const dueDate = rentalDueDateForMonth(contract, periodMonth);
  const { code } = await generateNextDocumentCode(db, 'purchase_vendor_bill', {
    actor: actorName(user),
    userId: user.id,
  });
  const now = Date.now();
  const ref = doc(collection(db, 'purchase_vendor_bills'));
  const bill: PurchaseVendorBill = {
    id: ref.id,
    receiptNo: code,
    purchaseId,
    purchaseNo: contract.contractNo,
    purchaseType: 'CREDIT',
    vendorId: contract.lessorVendorId,
    billAmount: amounts.grossAmount,
    billVatTreatment: amounts.vatRatePercent > 0 ? 'VAT_7' : 'NONE',
    supplierWithholdingEnabledBill: amounts.withholdingTaxRatePercent > 0,
    supplierWithholdingRatePercentBill: amounts.withholdingTaxRatePercent,
    supplierWithholdingTaxBaseBill: amounts.baseRentAmount,
    vendorBillWhtPresetCategory: 'RENT',
    rentalContractId: contract.id,
    rentalPeriodMonth: periodMonth,
    rentalContractNo: contract.contractNo,
    billingReceivedDate: dueDate,
    plannedPaymentDate: dueDate,
    status: 'DRAFT',
    notes: `ค่าเช่า ${contract.rentedItemDescription} ประจำเดือน ${periodMonth} · อ้างสัญญา ${contract.contractNo}`,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(ref, stripUndefinedForFirestore(bill));
  await writeAuditLog(db, user, {
    actionType: 'CREATE',
    entityType: 'PurchaseVendorBill',
    entityId: ref.id,
    entityLabel: code,
    sourceModule: 'accounting',
    sourcePath: `/accounting/rental-contracts/${contract.id}`,
    afterSummary: `ใบวางบิลค่าเช่า ${periodMonth} · อ้างสัญญา ${contract.contractNo} · ${amounts.grossAmount.toFixed(2)} บาท`,
    changedFields: ['status'],
    linkedIds: [contract.id, ref.id, purchaseId],
  });
  return { billId: ref.id, receiptNo: code };
}
