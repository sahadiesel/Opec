'use client';

import {
  Firestore,
  collection,
  addDoc,
  doc,
  getDoc,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import type { CommercialInvoice, CommercialInvoiceLine, PurchaseOrder, Quotation, SalesContractTerm, User } from '@/lib/types';
import { generateBillingLines } from '@/lib/services/billing-line-generator';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { sanitizeFirestorePayload } from '@/lib/utils';
import { writeAuditLog } from '@/lib/services/audit-service';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function newLineId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

async function resolveVatPercent(db: Firestore, customerId: string): Promise<number> {
  const [salesTermsSnap, quotationsSnap] = await Promise.all([
    getDocs(query(collection(db, 'sales_contract_terms'), where('customerId', '==', customerId))),
    getDocs(query(collection(db, 'quotations'), where('customerId', '==', customerId))),
  ]);
  const st = salesTermsSnap.docs[0]?.data() as SalesContractTerm | undefined;
  if (st?.vatPercent != null) return Number(st.vatPercent);
  const q0 = quotationsSnap.docs[0]?.data() as Quotation | undefined;
  if (q0?.taxPercent != null) return Number(q0.taxPercent);
  return 7;
}

/**
 * สร้างใบแจ้งหนี้ร่าง (เรียกเก็บ) จาก timesheet ที่พร้อมวางบิล — แยกจากใบกำกับภาษี
 */
export async function createCommercialDraftInvoice(
  db: Firestore,
  params: {
    poId: string;
    waveId: string;
    periodStart: string;
    periodEnd: string;
    issueDate: string;
    currency?: string;
    actor: User;
    notes?: string;
  }
): Promise<{ id: string; invoiceNo: string }> {
  const { poId, waveId, periodStart, periodEnd, issueDate, actor } = params;
  const currency = params.currency || 'THB';

  const gen = await generateBillingLines(db, poId, periodStart, periodEnd, waveId);
  if (gen.lines.length === 0) {
    throw new Error(
      'ไม่มีรายการจาก timesheet — ตรวจช่วงวันที่ / wave / สถานะ timesheet (ต้อง readyForBilling)',
    );
  }

  const [poSnap, waveSnap] = await Promise.all([
    getDoc(doc(db, 'purchase_orders', poId)),
    getDoc(doc(db, 'waves', waveId)),
  ]);
  if (!poSnap.exists()) throw new Error('ไม่พบ PO');
  const po = { ...poSnap.data(), id: poSnap.id } as PurchaseOrder;
  const waveCode = waveSnap.exists() ? String((waveSnap.data() as { waveCode?: string }).waveCode || '') : '';

  const vatPercent = await resolveVatPercent(db, po.customerId);
  const amountBeforeTax = roundMoney(gen.totalAmount);
  const vatAmount = roundMoney((amountBeforeTax * vatPercent) / 100);
  const totalAmount = roundMoney(amountBeforeTax + vatAmount);

  const lines: CommercialInvoiceLine[] = gen.lines.map((l) => ({
    id: newLineId(),
    description: l.description,
    workerId: l.workerId,
    workerName: l.workerName,
    positionId: l.positionId,
    eventType: l.eventType,
    timesheetIds: l.timesheetIds,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    amount: l.amount,
  }));

  const { code: invoiceNo } = await generateNextDocumentCode(db, 'commercial_invoice', {
    actor: actor.displayName,
    userId: actor.id,
  });

  const now = Date.now();
  const payload: Omit<CommercialInvoice, 'id'> = {
    invoiceNo,
    status: 'DRAFT',
    customerId: po.customerId,
    contractId: po.contractId || undefined,
    poId,
    waveId,
    waveCode: waveCode || undefined,
    periodStart,
    periodEnd,
    issueDate,
    currency,
    vatPercent,
    amountBeforeTax,
    vatAmount,
    withholdingTaxAmount: 0,
    totalAmount,
    lines,
    generationWarnings: gen.warnings,
    timesheetCount: gen.timesheetCount,
    notes: params.notes,
    createdAt: now,
    createdByUid: actor.id,
    createdByName: actor.displayName,
    updatedAt: now,
  };

  const ref = await addDoc(
    collection(db, 'commercial_invoices'),
    sanitizeFirestorePayload(payload as Record<string, unknown>),
  );

  await writeAuditLog(db, actor, {
    actionType: 'CREATE_COMMERCIAL_INVOICE',
    entityType: 'CommercialInvoice',
    entityId: ref.id,
    entityLabel: `${invoiceNo} (wave ${waveId})`,
    sourceModule: 'commercial_invoices',
    linkedIds: [po.customerId, poId, waveId],
    afterSummary: `สร้างใบแจ้งหนี้ร่าง (เรียกเก็บ) ${invoiceNo}`,
  });

  return { id: ref.id, invoiceNo };
}
