'use client';

import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  writeBatch,
  query,
  where,
  limit,
} from 'firebase/firestore';
import type { BillingNote, BillingNoteLine, DocumentApprovalEvent, TaxInvoice, User } from '@/lib/types';
import { writeAuditLog } from '@/lib/services/audit-service';

function randomTokenSegment(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

export function buildTaxInvoiceBillingApprovalToken(taxInvoiceNo: string): string {
  const seg = randomTokenSegment();
  return `${taxInvoiceNo}-BIL-${seg}`;
}

function collectTimesheetIdsFromLines(lines: BillingNoteLine[]): string[] {
  const set = new Set<string>();
  for (const line of lines) {
    const ids = line.timesheetIds;
    if (!ids?.length) continue;
    for (const id of ids) {
      if (id) set.add(id);
    }
  }
  return [...set];
}

/**
 * ล็อก timesheet ตาม wave + ช่วงวันที่ใบวางบิล (สำรองเมื่อบรรทัดไม่มี timesheetIds)
 */
async function collectTimesheetIdsByWaveAndPeriod(
  db: Firestore,
  waveId: string,
  periodStart: string,
  periodEnd: string
): Promise<string[]> {
  const q = query(
    collection(db, 'daily_timesheets'),
    where('waveId', '==', waveId),
    where('date', '>=', periodStart),
    where('date', '<=', periodEnd),
    limit(2000)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.id);
}

export interface RecordBillingCustomerApprovalParams {
  channel: 'internal_ui' | 'client_portal';
  note?: string;
}

function timesheetLockPayload(invoiceId: string, approvalToken: string, now: number) {
  return {
    status: 'LOCKED' as const,
    lockedAt: now,
    lockedBy: `billing_customer_approval:${approvalToken}`,
    billingLockedByTaxInvoiceId: invoiceId,
    lockedForBillingAt: now,
    updatedAt: now,
  };
}

/**
 * ลูกค้าอนุมัติ billing (draft tax invoice): ออกโทเคน, เก็บ audit บนเอกสาร + audit_logs, ล็อก timesheet ที่เกี่ยวข้อง
 */
export async function recordTaxInvoiceBillingCustomerApproval(
  db: Firestore,
  invoice: TaxInvoice,
  billingNote: BillingNote,
  lines: BillingNoteLine[],
  user: User,
  params: RecordBillingCustomerApprovalParams
): Promise<{ approvalToken: string; timesheetsLocked: number }> {
  if (invoice.status !== 'DRAFT') {
    throw new Error('อนุมัติ billing ได้เฉพาะใบที่ยังเป็น DRAFT');
  }
  if (invoice.billingCustomerApprovedAt) {
    throw new Error('ลูกค้าอนุมัติ billing แล้ว');
  }

  const invRef = doc(db, 'tax_invoices', invoice.id);
  const snap = await getDoc(invRef);
  if (!snap.exists()) throw new Error('ไม่พบใบกำกับ');
  const fresh = { ...snap.data(), id: snap.id } as TaxInvoice;
  if (fresh.status !== 'DRAFT' || fresh.billingCustomerApprovedAt) {
    throw new Error('สถานะเอกสารเปลี่ยนแล้ว — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  }

  let tsIds = collectTimesheetIdsFromLines(lines);
  if (tsIds.length === 0 && billingNote.waveId) {
    tsIds = await collectTimesheetIdsByWaveAndPeriod(
      db,
      billingNote.waveId,
      billingNote.billingPeriodStart,
      billingNote.billingPeriodEnd
    );
  }

  const approvalToken = buildTaxInvoiceBillingApprovalToken(
    String(invoice.taxInvoiceNo || '').trim() || invoice.id,
  );
  const now = Date.now();
  const eventId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${now}_${Math.random().toString(36).slice(2, 11)}`;

  const event: DocumentApprovalEvent = {
    id: eventId,
    action: 'BILLING_CUSTOMER_APPROVED',
    at: now,
    actorUid: user.id,
    actorName: user.displayName || user.email || user.id,
    actorRole: user.assignedRoleKey || undefined,
    channel: params.channel,
    approvalToken,
    note: params.note,
  };

  const prevEvents = Array.isArray(fresh.billingApprovalEvents) ? fresh.billingApprovalEvents : [];
  const billingApprovalEvents = [...prevEvents, event];

  const source: 'internal_representative' | 'client_portal' =
    params.channel === 'client_portal' ? 'client_portal' : 'internal_representative';

  const invoicePayload = {
    billingCustomerApprovedAt: now,
    billingCustomerApprovedByUid: user.id,
    billingCustomerApprovedByName: user.displayName || user.email || user.id,
    billingCustomerApprovalSource: source,
    billingApprovalToken: approvalToken,
    billingApprovalEvents,
    updatedAt: now,
  };

  const tsPayload = timesheetLockPayload(invoice.id, approvalToken, now);

  const firstChunkSize = tsIds.length === 0 ? 0 : Math.min(tsIds.length, 499);
  const firstTs = tsIds.slice(0, firstChunkSize);
  const restTs = tsIds.slice(firstChunkSize);

  const batch0 = writeBatch(db);
  batch0.update(invRef, invoicePayload);
  for (const tsId of firstTs) {
    batch0.update(doc(db, 'daily_timesheets', tsId), tsPayload);
  }
  await batch0.commit();

  let locked = firstTs.length;
  let idx = 0;
  while (idx < restTs.length) {
    const batch = writeBatch(db);
    let count = 0;
    while (count < 500 && idx < restTs.length) {
      batch.update(doc(db, 'daily_timesheets', restTs[idx]), tsPayload);
      idx++;
      count++;
      locked++;
    }
    await batch.commit();
  }

  await writeAuditLog(db, user, {
    actionType: 'TAX_INVOICE_BILLING_CUSTOMER_APPROVED',
    entityType: 'TaxInvoice',
    entityId: invoice.id,
    entityLabel: invoice.taxInvoiceNo,
    taxInvoiceId: invoice.id,
    billingNoteId: invoice.billingNoteId,
    waveId: billingNote.waveId,
    sourceModule: params.channel === 'client_portal' ? 'client_portal' : 'tax_invoices',
    linkedIds: tsIds.slice(0, 50),
    afterSummary: `Billing customer approval token=${approvalToken}; locked ${locked} timesheet(s).`,
  });

  return { approvalToken, timesheetsLocked: locked };
}
