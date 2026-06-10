'use client';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import type { AccountsReceivable, MoneyReceipt, TaxInvoice } from '@/lib/types';
import {
  buildCloseArFullyPatch,
  findCommercialAccountsReceivable,
  findTaxInvoiceAccountsReceivable,
  isArStillOpen,
  reconcileOpenArForPaidTaxInvoice,
  type ReconcilePaidTaxInvoiceArResult,
} from '@/lib/services/accounts-receivable-reconcile-service';

export async function taxInvoiceNeedsArReconcile(db: Firestore, inv: TaxInvoice): Promise<boolean> {
  if (!inv.linkedReceiptId?.trim()) return false;

  const taxAr = await findTaxInvoiceAccountsReceivable(db, inv.id, inv.arEntryId);
  if (taxAr && isArStillOpen(taxAr)) return true;

  const cid = inv.sourceCommercialInvoiceId?.trim();
  if (cid) {
    const comAr = await findCommercialAccountsReceivable(db, cid);
    if (comAr && isArStillOpen(comAr)) return true;
  }

  return false;
}

export async function reconcileTaxInvoiceArIfPaid(
  db: Firestore,
  inv: TaxInvoice,
): Promise<ReconcilePaidTaxInvoiceArResult & { fixed: boolean }> {
  if (!inv.linkedReceiptId?.trim()) {
    return { fixed: false, fixedTaxAr: false, fixedCommercialAr: false };
  }

  const needs = await taxInvoiceNeedsArReconcile(db, inv);
  if (!needs) {
    return { fixed: false, fixedTaxAr: false, fixedCommercialAr: false };
  }

  let paidAmount = Number(inv.totalAmount) || 0;
  const receiptSnap = await getDoc(doc(db, 'receipts', inv.linkedReceiptId));
  if (receiptSnap.exists()) {
    paidAmount = Number((receiptSnap.data() as MoneyReceipt).amount) || paidAmount;
  }

  const result = await reconcileOpenArForPaidTaxInvoice(db, inv, paidAmount);
  return {
    ...result,
    fixed: result.fixedTaxAr || result.fixedCommercialAr,
  };
}

/** ปิด AR-COM ที่ค้างเมื่อมีใบกำกับ ISSUED แล้ว (ข้อมูลเก่า) */
export async function reconcileStaleCommercialArSupersededByTaxInvoice(db: Firestore): Promise<number> {
  const arSnap = await getDocs(
    query(
      collection(db, 'accounts_receivable'),
      where('status', 'in', ['OPEN', 'PARTIALLY_PAID', 'OVERDUE']),
      limit(200),
    ),
  );

  let fixedCount = 0;
  for (const arDoc of arSnap.docs) {
    const ar = { id: arDoc.id, ...(arDoc.data() as Omit<AccountsReceivable, 'id'>) };
    if (ar.referenceType !== 'COMMERCIAL_INVOICE') continue;
    const comSnap = await getDoc(doc(db, 'commercial_invoices', ar.referenceId));
    if (!comSnap.exists()) continue;

    const taxId = (comSnap.data() as { linkedTaxInvoiceId?: string }).linkedTaxInvoiceId?.trim();
    if (!taxId) continue;

    const taxSnap = await getDoc(doc(db, 'tax_invoices', taxId));
    if (!taxSnap.exists()) continue;
    if ((taxSnap.data() as TaxInvoice).status !== 'ISSUED') continue;

    await updateDoc(doc(db, 'accounts_receivable', ar.id), buildCloseArFullyPatch(ar, Date.now()));
    fixedCount += 1;
  }
  return fixedCount;
}

/** ซิงก์ AR ค้างของใบกำกับที่ออกใบเสร็จแล้วทั้งหมด (ข้อมูลเก่า) */
export async function reconcileAllStaleArFromPaidTaxInvoices(db: Firestore): Promise<number> {
  const snap = await getDocs(
    query(collection(db, 'tax_invoices'), where('status', '==', 'ISSUED'), limit(200)),
  );

  let fixedCount = 0;
  for (const d of snap.docs) {
    const inv = { id: d.id, ...(d.data() as Omit<TaxInvoice, 'id'>) };
    if (!inv.linkedReceiptId?.trim()) continue;
    const { fixed } = await reconcileTaxInvoiceArIfPaid(db, inv);
    if (fixed) fixedCount += 1;
  }
  return fixedCount;
}

export async function reconcileAllStaleArEntries(db: Firestore): Promise<{
  paidTaxInvoices: number;
  supersededCommercial: number;
}> {
  const [paidTaxInvoices, supersededCommercial] = await Promise.all([
    reconcileAllStaleArFromPaidTaxInvoices(db),
    reconcileStaleCommercialArSupersededByTaxInvoice(db),
  ]);
  return { paidTaxInvoices, supersededCommercial };
}
