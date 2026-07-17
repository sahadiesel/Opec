'use client';

import {
  collection,
  doc,
  getDoc,
  increment,
  runTransaction,
  updateDoc,
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
  User,
  Vendor,
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
    status: 'DRAFT',
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
    afterSummary: `สร้างสัญญาเช่า ${contractNo} · ${input.lessor.vendorName} · ${monthlyRentAmount.toFixed(2)} บาท/เดือน`,
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
  const horizon = todayYmd < contract.endDate ? todayYmd : contract.endDate;
  if (horizon < contract.startDate) return 0;
  let created = 0;
  for (const month of monthsBetween(contract.startDate, horizon)) {
    const dueDate = rentalDueDateForMonth(contract, month);
    if (dueDate > todayYmd || dueDate < contract.startDate || dueDate > contract.endDate) continue;
    const id = rentalPayableId(contract.id, month);
    const payableRef = doc(db, 'rental_payables', id);
    const apRef = doc(db, 'accounts_payable', id);
    const gross = roundMoney2(contract.monthlyRentAmount);
    const wht = roundMoney2((gross * contract.withholdingTaxRatePercent) / 100);
    const net = roundMoney2(gross - wht);
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
        grossAmount: gross,
        withholdingTaxRatePercent: contract.withholdingTaxRatePercent,
        withholdingTaxAmount: wht,
        netPayableAmount: net,
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
        debitAmount: gross,
        creditAmount: 0,
        outstandingAmount: gross,
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
  },
): Promise<{ cashbookEntryNo: string; whtCertificateId?: string }> {
  if (!canExecuteBankCashbookPayments(user)) {
    throw new Error('ทำจ่ายได้เฉพาะผู้จัดการบัญชีหรือ Admin');
  }
  const { contract, payable, vendor } = params;
  if (contract.status !== 'ACTIVE' && contract.status !== 'EXPIRED') throw new Error('สัญญาไม่อยู่ในสถานะทำจ่าย');
  if (payable.status !== 'PENDING' || payable.cashbookEntryId) throw new Error('รายการนี้ถูกจ่ายหรือยกเลิกแล้ว');
  if (!params.entryDate) throw new Error('กรุณาระบุวันที่ทำรายการ');
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
  const description = `จ่ายค่าเช่า ${payable.vendorName} · ${contract.rentedItemDescription} · ${payable.periodMonth}${
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
  batch.update(payableRef, {
    status: 'PAID',
    paidAt: now,
    paidByUid: user.id,
    paidByName: actor,
    bankAccountId: params.bankAccountId,
    paymentMethod: params.paymentMethod,
    cashbookEntryId: cashbookRef.id,
    cashbookEntryNo: entryNo,
    updatedAt: now,
  });
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
      baseBeforeVat: payable.grossAmount,
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
      billVatTreatment: 'NONE',
      supplierWithholdingEnabledBill: true,
      supplierWithholdingRatePercentBill: payable.withholdingTaxRatePercent,
      supplierWithholdingTaxBaseBill: payable.grossAmount,
      vendorBillWhtPresetCategory: 'RENT',
      notes: payable.description,
      createdAt: payable.createdAt,
      updatedAt: now,
    } as PurchaseVendorBill;
    const syntheticPurchase = {
      id: contract.id,
      purchaseNo: contract.contractNo,
      totalAmount: payable.grossAmount,
      amountBeforeTax: payable.grossAmount,
      taxAmount: 0,
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
    changedFields: ['status', 'cashbookEntryId', 'paidAt', 'whtCertificateDocumentId'],
    linkedIds: [contract.id, payable.id, cashbookRef.id, ...(whtCertificateId ? [whtCertificateId] : [])],
  });
  return { cashbookEntryNo: entryNo, whtCertificateId };
}
