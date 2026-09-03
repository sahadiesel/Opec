'use client';

/**
 * สัญญาเช่าที่ OPEC เป็นผู้ให้เช่า (เครื่องมือ/อุปกรณ์)
 * — สร้างใบแจ้งหนี้ (commercial_invoices) อัตโนมัติเมื่อถึงวันวางบิลรายเดือน
 * — ใบกำกับภาษี / ใบเสร็จ ออกต่อด้วย flow เดิมจากใบแจ้งหนี้
 */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import type {
  CommercialInvoice,
  CommercialInvoiceLine,
  Customer,
  EquipmentRentalContract,
  EquipmentRentalContractStatus,
  EquipmentRentalLineItem,
  User,
} from '@/lib/types';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { writeAuditLog } from '@/lib/services/audit-service';
import { canManageEquipmentRentalContracts } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import { sanitizeFirestorePayload } from '@/lib/utils';

export const EQUIPMENT_RENTAL_PO_PLACEHOLDER = '__equipment_rental__';
export const EQUIPMENT_RENTAL_WAVE_PLACEHOLDER = '__equipment_rental__';

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function newLineId(): string {
  return `ln_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ymd(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

export function equipmentRentalBillingDateForMonth(
  contract: Pick<EquipmentRentalContract, 'billingDayOfMonth' | 'startDate' | 'endDate'>,
  periodMonth: string,
): string {
  const [year, month] = periodMonth.split('-').map(Number);
  const monthIndex = month - 1;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  let due = ymd(year, monthIndex, Math.min(lastDay, Math.max(1, contract.billingDayOfMonth)));
  if (periodMonth === contract.startDate.slice(0, 7) && due < contract.startDate) due = contract.startDate;
  if (periodMonth === contract.endDate.slice(0, 7) && due > contract.endDate) due = contract.endDate;
  return due;
}

export const EQUIPMENT_RENTAL_LESSOR_NAME_FALLBACK =
  'บริษัท โอเปค เอ็นจิเนียริ่ง แอนด์ แมนเนจเม้นท์ จำกัด';

type EquipmentRentalLineInput = {
  description?: string;
  brand?: string;
  serialNumber?: string;
  size?: string;
  horsepower?: string;
  quantity?: number;
  unitPrice?: number;
  unit?: string;
  ratePeriod?: 'DAY' | 'MONTH';
  id?: string;
};

/** ยอดวางบิลรายเดือนของรายการ — DAY ใช้ฐาน 30 วันตามข้อ ๗ ของแบบสัญญา */
export function equipmentRentalLineMonthlyAmount(row: {
  quantity: number;
  unitPrice: number;
  ratePeriod?: 'DAY' | 'MONTH';
}): number {
  const quantity = Math.max(0, Number(row.quantity) || 0);
  const unitPrice = roundMoney(Number(row.unitPrice) || 0);
  const period = row.ratePeriod === 'DAY' ? 'DAY' : 'MONTH';
  const factor = period === 'DAY' ? 30 : 1;
  return roundMoney(quantity * unitPrice * factor);
}

export function normalizeEquipmentRentalLineItems(
  raw: Array<EquipmentRentalLineInput>,
): EquipmentRentalLineItem[] {
  const items: EquipmentRentalLineItem[] = [];
  for (const row of raw) {
    const description = String(row.description || '').trim();
    if (!description) continue;
    const quantity = Math.max(0, Number(row.quantity) || 0);
    const unitPrice = roundMoney(Number(row.unitPrice) || 0);
    if (quantity <= 0 || unitPrice < 0) continue;
    const unit = String(row.unit || '').trim();
    const ratePeriod = row.ratePeriod === 'DAY' ? 'DAY' : 'MONTH';
    const brand = String(row.brand || '').trim();
    const serialNumber = String(row.serialNumber || '').trim();
    const size = String(row.size || '').trim();
    const horsepower = String(row.horsepower || '').trim();
    items.push({
      id: String(row.id || '').trim() || newLineId(),
      description,
      quantity,
      unitPrice,
      ratePeriod,
      ...(unit ? { unit } : {}),
      ...(brand ? { brand } : {}),
      ...(serialNumber ? { serialNumber } : {}),
      ...(size ? { size } : {}),
      ...(horsepower ? { horsepower } : {}),
      amount: equipmentRentalLineMonthlyAmount({ quantity, unitPrice, ratePeriod }),
    });
  }
  return items;
}

function optTrim(v: unknown): string | undefined {
  const s = String(v ?? '').trim();
  return s || undefined;
}

function optNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** ฟิลด์แบบสัญญาเช่าเครื่องจักรกล (ข้อกรอกช่องว่าง) */
export type EquipmentRentalContractDetailInput = {
  customerAddressSnapshot?: string | null;
  customerTaxIdSnapshot?: string | null;
  lesseeAuthorizedSignatory?: string | null;
  lesseeCertificateDate?: string | null;
  madeAtTambon?: string | null;
  madeAtAmphoe?: string | null;
  madeAtProvince?: string | null;
  contractDate?: string | null;
  lessorName?: string | null;
  lessorAddress?: string | null;
  lessorTaxId?: string | null;
  lessorAuthorizedSignatory?: string | null;
  lessorIsIndividual?: boolean | null;
  lessorIdCardNo?: string | null;
  insuranceClass?: string | null;
  rentalDurationValue?: number | null;
  rentalDurationUnit?: 'DAY' | 'MONTH' | null;
  appendix1Pages?: number | null;
  appendix2Pages?: number | null;
  appendix3Pages?: number | null;
  invoiceLeadWorkingDays?: number | null;
  bankName?: string | null;
  bankBranch?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  interruptionThresholdDays?: number | null;
  storageReturnNoticeDays?: number | null;
  maxEquipmentAgeYears?: number | null;
  deliveryLocation?: string | null;
  deliveryDate?: string | null;
  deliveryNoticeWorkingDays?: number | null;
  replacementDeliveryDays?: number | null;
  repairCorrectionDays?: number | null;
  replacementPenaltyPerDay?: number | null;
  maxReplacementDelayDays?: number | null;
  relocationNoticeDays?: number | null;
  performanceBondType?: string | null;
  performanceBondAmount?: number | null;
  performanceBondPercent?: number | null;
  performanceBondTopUpDays?: number | null;
  lossReplacementDays?: number | null;
  alternateRentalWindowValue?: number | null;
  alternateRentalWindowUnit?: 'DAY' | 'MONTH' | null;
  lateDeliveryPenaltyPerDay?: number | null;
  penaltyDebtPayDays?: number | null;
  equipmentReturnDays?: number | null;
  addressChangeNoticeDays?: number | null;
  witness1Name?: string | null;
  witness2Name?: string | null;
};

const DETAIL_STRING_KEYS = [
  'customerAddressSnapshot',
  'customerTaxIdSnapshot',
  'lesseeAuthorizedSignatory',
  'lesseeCertificateDate',
  'madeAtTambon',
  'madeAtAmphoe',
  'madeAtProvince',
  'contractDate',
  'lessorName',
  'lessorAddress',
  'lessorTaxId',
  'lessorAuthorizedSignatory',
  'lessorIdCardNo',
  'insuranceClass',
  'bankName',
  'bankBranch',
  'bankAccountName',
  'bankAccountNumber',
  'deliveryLocation',
  'deliveryDate',
  'performanceBondType',
  'witness1Name',
  'witness2Name',
] as const;

const DETAIL_NUMBER_KEYS = [
  'rentalDurationValue',
  'appendix1Pages',
  'appendix2Pages',
  'appendix3Pages',
  'invoiceLeadWorkingDays',
  'interruptionThresholdDays',
  'storageReturnNoticeDays',
  'maxEquipmentAgeYears',
  'deliveryNoticeWorkingDays',
  'replacementDeliveryDays',
  'repairCorrectionDays',
  'replacementPenaltyPerDay',
  'maxReplacementDelayDays',
  'relocationNoticeDays',
  'performanceBondAmount',
  'performanceBondPercent',
  'performanceBondTopUpDays',
  'lossReplacementDays',
  'alternateRentalWindowValue',
  'lateDeliveryPenaltyPerDay',
  'penaltyDebtPayDays',
  'equipmentReturnDays',
  'addressChangeNoticeDays',
] as const;

function applyEquipmentRentalDetails(
  target: Record<string, unknown>,
  details?: EquipmentRentalContractDetailInput,
) {
  if (!details) return;
  for (const key of DETAIL_STRING_KEYS) {
    if (!(key in details)) continue;
    const v = details[key];
    target[key] = v == null ? null : optTrim(v) ?? null;
  }
  for (const key of DETAIL_NUMBER_KEYS) {
    if (!(key in details)) continue;
    const v = details[key];
    if (v == null || v === ('' as unknown)) {
      target[key] = null;
      continue;
    }
    const n = optNum(v);
    target[key] = n == null ? null : n;
  }
  if ('lessorIsIndividual' in details) {
    target.lessorIsIndividual = details.lessorIsIndividual ? true : false;
  }
  if ('rentalDurationUnit' in details) {
    const u = details.rentalDurationUnit;
    target.rentalDurationUnit = u === 'DAY' || u === 'MONTH' ? u : null;
  }
  if ('alternateRentalWindowUnit' in details) {
    const u = details.alternateRentalWindowUnit;
    target.alternateRentalWindowUnit = u === 'DAY' || u === 'MONTH' ? u : null;
  }
}

export function sumEquipmentRentalMonthly(items: readonly EquipmentRentalLineItem[]): number {
  return roundMoney(items.reduce((s, it) => s + (Number(it.amount) || 0), 0));
}

function assertCanManage(user: User) {
  if (!canManageEquipmentRentalContracts(user) && !isSystemAdmin(user)) {
    throw new Error('ไม่มีสิทธิ์จัดการสัญญาเช่า — ต้องเป็น Admin / Sales / Sales Manager');
  }
}

export function equipmentRentalInvoiceDocId(contractId: string, periodMonth: string): string {
  return `erc_${contractId}_${periodMonth}`;
}

export async function createEquipmentRentalContract(
  db: Firestore,
  user: User,
  input: {
    customer: Pick<Customer, 'id' | 'name' | 'registeredAddress' | 'billingAddress' | 'taxId'>;
    title: string;
    lineItems: Array<EquipmentRentalLineInput>;
    vatRatePercent?: number;
    startDate: string;
    endDate: string;
    billingDayOfMonth: number;
    notes?: string;
    details?: EquipmentRentalContractDetailInput;
  },
): Promise<string> {
  assertCanManage(user);
  if (!input.customer?.id) throw new Error('กรุณาเลือกลูกค้าผู้เช่า');
  const title = String(input.title || '').trim();
  if (!title) throw new Error('กรุณาระบุชื่อสัญญา');
  const lineItems = normalizeEquipmentRentalLineItems(input.lineItems);
  if (lineItems.length === 0) throw new Error('กรุณาเพิ่มรายการเครื่องมือ/อุปกรณ์อย่างน้อย 1 รายการ');
  const monthlyRentAmount = sumEquipmentRentalMonthly(lineItems);
  if (monthlyRentAmount <= 0) throw new Error('ยอดค่าเช่ารายเดือนต้องมากกว่า 0');
  if (!input.startDate || !input.endDate || input.endDate < input.startDate) {
    throw new Error('ช่วงวันที่สัญญาไม่ถูกต้อง');
  }
  const billingDayOfMonth = Math.min(31, Math.max(1, Math.round(Number(input.billingDayOfMonth) || 1)));
  const vatRatePercent = Math.max(0, Math.min(100, Number(input.vatRatePercent) ?? 7));

  const { code: contractNo } = await generateNextDocumentCode(db, 'equipment_rental_contract', {
    actor: user.displayName,
    userId: user.id,
  });

  const now = Date.now();
  const customerAddress =
    optTrim(input.details?.customerAddressSnapshot) ||
    optTrim(input.customer.registeredAddress) ||
    optTrim(input.customer.billingAddress);
  const customerTaxId =
    optTrim(input.details?.customerTaxIdSnapshot) || optTrim(input.customer.taxId);

  const payload: Record<string, unknown> = {
    contractNo,
    status: 'DRAFT' satisfies EquipmentRentalContractStatus,
    customerId: input.customer.id,
    customerNameSnapshot: String(input.customer.name || '').trim() || input.customer.id,
    ...(customerAddress ? { customerAddressSnapshot: customerAddress } : {}),
    ...(customerTaxId ? { customerTaxIdSnapshot: customerTaxId } : {}),
    title,
    lineItems,
    monthlyRentAmount,
    vatRatePercent,
    startDate: input.startDate,
    endDate: input.endDate,
    billingDayOfMonth,
    lessorName: EQUIPMENT_RENTAL_LESSOR_NAME_FALLBACK,
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    createdAt: now,
    createdByUid: user.id,
    createdByName: user.displayName || user.email || user.id,
    updatedAt: now,
  };
  applyEquipmentRentalDetails(payload, {
    ...input.details,
    // keep snapshots already resolved above unless explicitly overridden
    customerAddressSnapshot: input.details?.customerAddressSnapshot ?? customerAddress ?? null,
    customerTaxIdSnapshot: input.details?.customerTaxIdSnapshot ?? customerTaxId ?? null,
    lessorName: input.details?.lessorName ?? EQUIPMENT_RENTAL_LESSOR_NAME_FALLBACK,
  });

  const ref = await addDoc(
    collection(db, 'equipment_rental_contracts'),
    sanitizeFirestorePayload(payload),
  );

  await writeAuditLog(db, user, {
    actionType: 'CREATE',
    entityType: 'EquipmentRentalContract',
    entityId: ref.id,
    entityLabel: contractNo,
    sourceModule: 'main_contracts',
    afterSummary: `สร้างสัญญาเช่าอุปกรณ์ ${contractNo} · ${payload.customerNameSnapshot}`,
  });

  return ref.id;
}

export async function updateEquipmentRentalContract(
  db: Firestore,
  user: User,
  contractId: string,
  patch: {
    title?: string;
    lineItems?: Array<EquipmentRentalLineInput>;
    vatRatePercent?: number;
    startDate?: string;
    endDate?: string;
    billingDayOfMonth?: number;
    notes?: string | null;
    details?: EquipmentRentalContractDetailInput;
  },
): Promise<void> {
  assertCanManage(user);
  const ref = doc(db, 'equipment_rental_contracts', contractId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบสัญญาเช่า');
  const cur = { id: snap.id, ...(snap.data() as object) } as EquipmentRentalContract;
  if (cur.status !== 'DRAFT' && cur.status !== 'ACTIVE') {
    throw new Error('แก้ไขได้เฉพาะสัญญาร่างหรือที่ใช้งานอยู่');
  }

  const next: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.title != null) {
    const title = String(patch.title).trim();
    if (!title) throw new Error('กรุณาระบุชื่อสัญญา');
    next.title = title;
  }
  if (patch.lineItems) {
    const lineItems = normalizeEquipmentRentalLineItems(patch.lineItems);
    if (lineItems.length === 0) throw new Error('ต้องมีรายการอย่างน้อย 1 รายการ');
    next.lineItems = lineItems;
    next.monthlyRentAmount = sumEquipmentRentalMonthly(lineItems);
  }
  if (patch.vatRatePercent != null) {
    next.vatRatePercent = Math.max(0, Math.min(100, Number(patch.vatRatePercent) || 0));
  }
  if (patch.startDate) next.startDate = patch.startDate;
  if (patch.endDate) next.endDate = patch.endDate;
  if (patch.billingDayOfMonth != null) {
    next.billingDayOfMonth = Math.min(31, Math.max(1, Math.round(Number(patch.billingDayOfMonth) || 1)));
  }
  if (patch.notes !== undefined) {
    next.notes = patch.notes?.trim() ? patch.notes.trim() : null;
  }
  if (patch.details) applyEquipmentRentalDetails(next, patch.details);

  const startDate = String(next.startDate || cur.startDate);
  const endDate = String(next.endDate || cur.endDate);
  if (endDate < startDate) throw new Error('ช่วงวันที่สัญญาไม่ถูกต้อง');

  await updateDoc(ref, sanitizeFirestorePayload(next) as any);
}

export async function activateEquipmentRentalContract(
  db: Firestore,
  user: User,
  contractId: string,
): Promise<{ invoicesCreated: number }> {
  assertCanManage(user);
  const ref = doc(db, 'equipment_rental_contracts', contractId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบสัญญาเช่า');
  const cur = { id: snap.id, ...(snap.data() as object) } as EquipmentRentalContract;
  if (cur.status !== 'DRAFT' && cur.status !== 'ACTIVE') {
    throw new Error('เปิดใช้งานได้เฉพาะสัญญาร่าง');
  }
  if (cur.status === 'DRAFT') {
    const now = Date.now();
    await updateDoc(ref, {
      status: 'ACTIVE' satisfies EquipmentRentalContractStatus,
      activatedAt: now,
      activatedByUid: user.id,
      activatedByName: user.displayName || user.email || user.id,
      updatedAt: now,
    });
  }
  const refreshed = (
    cur.status === 'DRAFT'
      ? { ...cur, status: 'ACTIVE' as const }
      : cur
  ) as EquipmentRentalContract;
  const invoicesCreated = await generateDueEquipmentRentalInvoices(db, user, refreshed);
  await writeAuditLog(db, user, {
    actionType: 'UPDATE',
    entityType: 'EquipmentRentalContract',
    entityId: contractId,
    entityLabel: cur.contractNo,
    sourceModule: 'main_contracts',
    afterSummary: `เปิดใช้งานสัญญาเช่า ${cur.contractNo} · สร้างใบแจ้งหนี้ ${invoicesCreated} ใบ`,
  });
  return { invoicesCreated };
}

export async function cancelEquipmentRentalContract(
  db: Firestore,
  user: User,
  contractId: string,
  reason?: string,
): Promise<void> {
  assertCanManage(user);
  const ref = doc(db, 'equipment_rental_contracts', contractId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ไม่พบสัญญาเช่า');
  const cur = snap.data() as EquipmentRentalContract;
  if (cur.status === 'CANCELLED') return;
  const now = Date.now();
  await updateDoc(ref, {
    status: 'CANCELLED' satisfies EquipmentRentalContractStatus,
    cancelledAt: now,
    cancelledByUid: user.id,
    cancelledByName: user.displayName || user.email || user.id,
    ...(reason?.trim() ? { cancellationReason: reason.trim() } : {}),
    updatedAt: now,
  });
}

/**
 * สร้างใบแจ้งหนี้ DRAFT สำหรับทุกเดือนที่วันวางบิลถึงแล้ว (และยังไม่มีใบ)
 */
export async function generateDueEquipmentRentalInvoices(
  db: Firestore,
  user: User,
  contract: EquipmentRentalContract,
  todayYmd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
): Promise<number> {
  if (contract.status !== 'ACTIVE') return 0;
  const horizon = todayYmd < contract.endDate ? todayYmd : contract.endDate;
  if (horizon < contract.startDate) return 0;

  let created = 0;
  for (const month of monthsBetween(contract.startDate, horizon)) {
    const billingDate = equipmentRentalBillingDateForMonth(contract, month);
    if (billingDate > todayYmd || billingDate < contract.startDate || billingDate > contract.endDate) {
      continue;
    }
    const made = await createEquipmentRentalCommercialInvoiceForPeriod(db, user, contract, month, billingDate);
    if (made) created += 1;
  }
  return created;
}

export async function syncDueEquipmentRentalInvoicesForAllActive(
  db: Firestore,
  user: User,
): Promise<number> {
  assertCanManage(user);
  const snap = await getDocs(
    query(collection(db, 'equipment_rental_contracts'), where('status', '==', 'ACTIVE')),
  );
  let total = 0;
  for (const d of snap.docs) {
    const contract = { id: d.id, ...(d.data() as object) } as EquipmentRentalContract;
    total += await generateDueEquipmentRentalInvoices(db, user, contract);
  }
  return total;
}

async function createEquipmentRentalCommercialInvoiceForPeriod(
  db: Firestore,
  user: User,
  contract: EquipmentRentalContract,
  periodMonth: string,
  billingDate: string,
): Promise<boolean> {
  const invoiceId = equipmentRentalInvoiceDocId(contract.id, periodMonth);
  const invoiceRef = doc(db, 'commercial_invoices', invoiceId);
  const already = await getDoc(invoiceRef);
  if (already.exists()) return false;

  const lines: CommercialInvoiceLine[] = (contract.lineItems || []).map((it, idx) => ({
    id: newLineId(),
    displayOrder: idx,
    description: [
      it.description,
      it.brand ? `ยี่ห้อ ${it.brand}` : '',
      it.serialNumber ? `เลขที่ ${it.serialNumber}` : '',
      it.unit ? `(${it.unit})` : '',
      it.ratePeriod === 'DAY' ? 'ค่าเช่ารายวัน×30' : 'ค่าเช่ารายเดือน',
      periodMonth,
    ]
      .filter(Boolean)
      .join(' · '),
    quantity: Number(it.quantity) || 0,
    unitPrice: roundMoney(Number(it.unitPrice) || 0),
    amount: roundMoney(Number(it.amount) || 0),
    lineSource: 'manual' as const,
  }));
  const amountBeforeTax = roundMoney(lines.reduce((s, l) => s + l.amount, 0));
  if (amountBeforeTax <= 0) return false;

  const vatPercent = Math.max(0, Number(contract.vatRatePercent) || 0);
  const vatAmount = roundMoney((amountBeforeTax * vatPercent) / 100);
  const totalAmount = roundMoney(amountBeforeTax + vatAmount);

  const [py, pm] = periodMonth.split('-').map(Number);
  const periodStart = `${periodMonth}-01`;
  const periodEnd = ymd(py, pm - 1, new Date(py, pm, 0).getDate());

  const { code: invoiceNo } = await generateNextDocumentCode(db, 'commercial_invoice', {
    actor: user.displayName,
    userId: user.id,
  });

  const now = Date.now();
  const payload: Omit<CommercialInvoice, 'id'> = {
    invoiceNo,
    status: 'DRAFT',
    customerId: contract.customerId,
    poId: EQUIPMENT_RENTAL_PO_PLACEHOLDER,
    waveId: EQUIPMENT_RENTAL_WAVE_PLACEHOLDER,
    equipmentRentalContractId: contract.id,
    equipmentRentalPeriodMonth: periodMonth,
    periodStart,
    periodEnd,
    issueDate: billingDate,
    currency: 'THB',
    vatPercent,
    amountBeforeTax,
    vatAmount,
    withholdingTaxAmount: 0,
    totalAmount,
    lines,
    generationWarnings: [
      `สร้างอัตโนมัติจากสัญญาเช่าอุปกรณ์ ${contract.contractNo} · วันวางบิลวันที่ ${contract.billingDayOfMonth} ของเดือน`,
    ],
    timesheetCount: 0,
    notes: `ค่าเช่าอุปกรณ์ตามสัญญา ${contract.contractNo} ประจำเดือน ${periodMonth}`,
    createdAt: now,
    createdByUid: user.id,
    createdByName: user.displayName || user.email || user.id,
    updatedAt: now,
    revisionNo: 0,
    revisionRootId: invoiceId,
    baseInvoiceNo: invoiceNo,
  };

  const wasCreated = await runTransaction(db, async (tx) => {
    const existing = await tx.get(invoiceRef);
    if (existing.exists()) return false;
    tx.set(invoiceRef, sanitizeFirestorePayload(payload as Record<string, unknown>));
    return true;
  });

  if (wasCreated) {
    await writeAuditLog(db, user, {
      actionType: 'CREATE_COMMERCIAL_INVOICE',
      entityType: 'CommercialInvoice',
      entityId: invoiceId,
      entityLabel: `ERC ${contract.contractNo} / ${periodMonth}`,
      sourceModule: 'commercial_invoices',
      linkedIds: [contract.customerId, contract.id],
      afterSummary: `ใบแจ้งหนี้ค่าเช่าอุปกรณ์ ${periodMonth} จาก ${contract.contractNo}`,
    });
  }

  return wasCreated;
}

export async function listEquipmentRentalInvoicesForContract(
  db: Firestore,
  contractId: string,
): Promise<Array<CommercialInvoice & { id: string }>> {
  const snap = await getDocs(
    query(
      collection(db, 'commercial_invoices'),
      where('equipmentRentalContractId', '==', contractId),
    ),
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) }) as CommercialInvoice & { id: string })
    .sort((a, b) =>
      String(a.equipmentRentalPeriodMonth || '').localeCompare(String(b.equipmentRentalPeriodMonth || '')),
    );
}

/** บังคับสร้างใบของเดือนที่ระบุ (แม้ยังไม่ถึงวันวางบิล) — ใช้ตอนกดมือ */
export async function forceCreateEquipmentRentalInvoiceForMonth(
  db: Firestore,
  user: User,
  contractId: string,
  periodMonth: string,
): Promise<{ created: boolean; invoiceId: string }> {
  assertCanManage(user);
  const snap = await getDoc(doc(db, 'equipment_rental_contracts', contractId));
  if (!snap.exists()) throw new Error('ไม่พบสัญญาเช่า');
  const contract = { id: snap.id, ...(snap.data() as object) } as EquipmentRentalContract;
  if (contract.status !== 'ACTIVE') throw new Error('สัญญาต้องอยู่ในสถานะใช้งาน');
  if (!/^\d{4}-\d{2}$/.test(periodMonth)) throw new Error('รูปแบบเดือนไม่ถูกต้อง');
  if (periodMonth < contract.startDate.slice(0, 7) || periodMonth > contract.endDate.slice(0, 7)) {
    throw new Error('เดือนนี้อยู่นอกช่วงสัญญา');
  }
  const billingDate = equipmentRentalBillingDateForMonth(contract, periodMonth);
  const invoiceId = equipmentRentalInvoiceDocId(contract.id, periodMonth);
  const created = await createEquipmentRentalCommercialInvoiceForPeriod(
    db,
    user,
    contract,
    periodMonth,
    billingDate,
  );
  return { created, invoiceId };
}
