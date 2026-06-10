'use client';

import {
  type Firestore,
  type WriteBatch,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { AccountsReceivable, ARStatus, TaxInvoice } from '@/lib/types';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import { sanitizeFirestorePayload } from '@/lib/utils';

export async function findCommercialAccountsReceivable(
  db: Firestore,
  commercialInvoiceId: string,
): Promise<(AccountsReceivable & { id: string }) | null> {
  const snap = await getDocs(
    query(
      collection(db, 'accounts_receivable'),
      where('referenceId', '==', commercialInvoiceId),
      where('referenceType', '==', 'COMMERCIAL_INVOICE' as const),
      limit(1),
    ),
  );
  if (snap.empty) return null;
  const d = snap.docs[0]!;
  return { id: d.id, ...(d.data() as Omit<AccountsReceivable, 'id'>) };
}

export async function findTaxInvoiceAccountsReceivable(
  db: Firestore,
  taxInvoiceId: string,
  arEntryIdHint?: string,
): Promise<(AccountsReceivable & { id: string }) | null> {
  const hint = arEntryIdHint?.trim();
  if (hint) {
    const snap = await getDoc(doc(db, 'accounts_receivable', hint));
    if (snap.exists()) {
      const ar = { id: snap.id, ...(snap.data() as Omit<AccountsReceivable, 'id'>) };
      if (ar.referenceType === 'TAX_INVOICE' && ar.referenceId === taxInvoiceId) {
        return ar;
      }
    }
  }

  const snap = await getDocs(
    query(
      collection(db, 'accounts_receivable'),
      where('referenceId', '==', taxInvoiceId),
      where('referenceType', '==', 'TAX_INVOICE' as const),
      limit(1),
    ),
  );
  if (snap.empty) return null;
  const d = snap.docs[0]!;
  return { id: d.id, ...(d.data() as Omit<AccountsReceivable, 'id'>) };
}

export function isArStillOpen(ar: Pick<AccountsReceivable, 'status' | 'outstandingAmount'>): boolean {
  if (ar.status === 'PAID') return false;
  return roundMoney2(Number(ar.outstandingAmount) || 0) > 0.01;
}

export function isCommercialArStillOpen(ar: Pick<AccountsReceivable, 'status' | 'outstandingAmount'>): boolean {
  return isArStillOpen(ar);
}

export function buildCloseArFullyPatch(
  ar: Pick<AccountsReceivable, 'debitAmount' | 'creditAmount'>,
  now: number,
): Record<string, unknown> {
  const debit = roundMoney2(Number(ar.debitAmount) || 0);
  return sanitizeFirestorePayload({
    creditAmount: debit,
    outstandingAmount: 0,
    status: 'PAID' as const,
    updatedAt: now,
  });
}

export function buildCloseCommercialArPatch(
  ar: Pick<AccountsReceivable, 'debitAmount' | 'creditAmount'>,
  now: number,
): Record<string, unknown> {
  return buildCloseArFullyPatch(ar, now);
}

export function buildApplyReceiptToTaxArPatch(
  ar: Pick<AccountsReceivable, 'debitAmount' | 'creditAmount' | 'status'>,
  receiptAmount: number,
  now: number,
): Record<string, unknown> {
  const debit = roundMoney2(Number(ar.debitAmount) || 0);
  const prevCredit = roundMoney2(Number(ar.creditAmount) || 0);
  const amt = roundMoney2(receiptAmount);
  const newCredit = roundMoney2(prevCredit + amt);
  const outstanding = roundMoney2(Math.max(0, debit - newCredit));
  let nextStatus: ARStatus = ar.status;
  if (outstanding <= 0.01) nextStatus = 'PAID';
  else if (newCredit > 0.01) nextStatus = 'PARTIALLY_PAID';

  return sanitizeFirestorePayload({
    creditAmount: newCredit,
    outstandingAmount: outstanding,
    status: nextStatus,
    updatedAt: now,
  });
}

export type PrepareTaxInvoiceArReceiptUpdateResult = {
  arUpdate?: { ref: ReturnType<typeof doc>; patch: Record<string, unknown> };
  resolvedArEntryId?: string;
};

export async function prepareTaxInvoiceArReceiptUpdate(
  db: Firestore,
  inv: Pick<TaxInvoice, 'id' | 'arEntryId'>,
  receiptAmount: number,
  now: number,
): Promise<PrepareTaxInvoiceArReceiptUpdateResult> {
  const ar = await findTaxInvoiceAccountsReceivable(db, inv.id, inv.arEntryId);
  if (!ar) return {};

  if (!isArStillOpen(ar)) {
    return { resolvedArEntryId: ar.id };
  }

  const debit = roundMoney2(Number(ar.debitAmount) || 0);
  const prevCredit = roundMoney2(Number(ar.creditAmount) || 0);
  const remaining = roundMoney2(debit - prevCredit);
  const amt = roundMoney2(receiptAmount);

  if (amt > remaining + 0.02) {
    throw new Error(
      `ยอดรับเกินยอดค้างชำระในลูกหนี้ (คงเหลือ ${remaining.toLocaleString('th-TH', { minimumFractionDigits: 2 })})`,
    );
  }

  return {
    resolvedArEntryId: ar.id,
    arUpdate: {
      ref: doc(db, 'accounts_receivable', ar.id),
      patch: buildApplyReceiptToTaxArPatch(ar, amt, now),
    },
  };
}

export async function closeOpenCommercialArInBatch(
  db: Firestore,
  batch: WriteBatch,
  commercialInvoiceId: string | undefined,
  now: number,
): Promise<boolean> {
  const cid = commercialInvoiceId?.trim();
  if (!cid) return false;

  const comAr = await findCommercialAccountsReceivable(db, cid);
  if (!comAr || !isArStillOpen(comAr)) return false;

  batch.update(doc(db, 'accounts_receivable', comAr.id), buildCloseArFullyPatch(comAr, now));
  return true;
}

export async function closeOpenCommercialArNow(
  db: Firestore,
  commercialInvoiceId: string | undefined,
): Promise<boolean> {
  const cid = commercialInvoiceId?.trim();
  if (!cid) return false;

  const comAr = await findCommercialAccountsReceivable(db, cid);
  if (!comAr || !isArStillOpen(comAr)) return false;

  await updateDoc(doc(db, 'accounts_receivable', comAr.id), buildCloseArFullyPatch(comAr, Date.now()));
  return true;
}

export type ReconcilePaidTaxInvoiceArResult = {
  fixedTaxAr: boolean;
  fixedCommercialAr: boolean;
  linkedArEntryId?: string;
};

export async function reconcileOpenArForPaidTaxInvoice(
  db: Firestore,
  inv: Pick<
    TaxInvoice,
    'id' | 'arEntryId' | 'sourceCommercialInvoiceId' | 'linkedReceiptId' | 'totalAmount'
  >,
  paidAmount: number,
): Promise<ReconcilePaidTaxInvoiceArResult> {
  if (!inv.linkedReceiptId?.trim()) {
    return { fixedTaxAr: false, fixedCommercialAr: false };
  }

  const now = Date.now();
  const batch = writeBatch(db);
  let fixedTaxAr = false;
  let fixedCommercialAr = false;
  let linkedArEntryId = inv.arEntryId?.trim();

  const taxAr = await findTaxInvoiceAccountsReceivable(db, inv.id, inv.arEntryId);
  if (taxAr && isArStillOpen(taxAr)) {
    const amt = roundMoney2(paidAmount > 0 ? paidAmount : Number(inv.totalAmount) || 0);
    batch.update(
      doc(db, 'accounts_receivable', taxAr.id),
      buildApplyReceiptToTaxArPatch(taxAr, amt, now),
    );
    fixedTaxAr = true;
    linkedArEntryId = taxAr.id;
  } else if (taxAr) {
    linkedArEntryId = taxAr.id;
  }

  const cid = inv.sourceCommercialInvoiceId?.trim();
  if (cid) {
    const comAr = await findCommercialAccountsReceivable(db, cid);
    if (comAr && isArStillOpen(comAr)) {
      batch.update(doc(db, 'accounts_receivable', comAr.id), buildCloseArFullyPatch(comAr, now));
      fixedCommercialAr = true;
    }
  }

  const taxPatch: Record<string, unknown> = { updatedAt: now };
  if (linkedArEntryId && linkedArEntryId !== inv.arEntryId?.trim()) {
    taxPatch.arEntryId = linkedArEntryId;
  }

  if (fixedTaxAr || fixedCommercialAr || taxPatch.arEntryId) {
    batch.update(doc(db, 'tax_invoices', inv.id), sanitizeFirestorePayload(taxPatch));
    await batch.commit();
  }

  return { fixedTaxAr, fixedCommercialAr, linkedArEntryId };
}
