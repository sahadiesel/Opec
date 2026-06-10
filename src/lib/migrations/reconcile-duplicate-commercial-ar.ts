import type { Firestore } from 'firebase-admin/firestore';
import type { AccountsReceivable, MoneyReceipt, TaxInvoice } from '@/lib/types';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';

export type ReconcileDuplicateArPlan = {
  arId: string;
  documentNo: string;
  reason: string;
  patch: {
    creditAmount: number;
    outstandingAmount: number;
    status: 'PAID';
    updatedAt: number;
  };
};

export type ReconcileDuplicateArScan = {
  commercialArPlans: ReconcileDuplicateArPlan[];
  taxArPlans: ReconcileDuplicateArPlan[];
};


function openArStatuses(): string[] {
  return ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'];
}

function closeArPlan(
  arId: string,
  ar: AccountsReceivable,
  reason: string,
  now: number,
): ReconcileDuplicateArPlan {
  const debit = roundMoney2(Number(ar.debitAmount) || 0);
  return {
    arId,
    documentNo: ar.documentNo,
    reason,
    patch: {
      creditAmount: debit,
      outstandingAmount: 0,
      status: 'PAID',
      updatedAt: now,
    },
  };
}

/** สแกน AR ค้างซ้ำจากใบเรียกเก็บ + AR ใบกำกับที่ออกใบเสร็จแล้วแต่ยังไม่ปิด */
export async function scanReconcileDuplicateCommercialAr(db: Firestore): Promise<ReconcileDuplicateArScan> {
  const now = Date.now();
  const commercialArPlans: ReconcileDuplicateArPlan[] = [];
  const taxArPlans: ReconcileDuplicateArPlan[] = [];

  const arSnap = await db.collection('accounts_receivable').where('status', 'in', openArStatuses()).get();

  const taxById = new Map<string, TaxInvoice>();
  const receiptById = new Map<string, MoneyReceipt>();

  for (const arDoc of arSnap.docs) {
    const ar = { id: arDoc.id, ...(arDoc.data() as Omit<AccountsReceivable, 'id'>) };

    if (ar.referenceType === 'COMMERCIAL_INVOICE') {
      const comSnap = await db.collection('commercial_invoices').doc(ar.referenceId).get();
      if (!comSnap.exists) continue;
      const com = comSnap.data() as { linkedTaxInvoiceId?: string };
      const taxId = com.linkedTaxInvoiceId?.trim();
      if (!taxId) continue;

      let tax = taxById.get(taxId);
      if (!tax) {
        const taxSnap = await db.collection('tax_invoices').doc(taxId).get();
        if (!taxSnap.exists) continue;
        tax = { id: taxSnap.id, ...(taxSnap.data() as Omit<TaxInvoice, 'id'>) };
        taxById.set(taxId, tax);
      }

      if (tax.status === 'ISSUED' || tax.linkedReceiptId) {
        commercialArPlans.push(
          closeArPlan(
            ar.id,
            ar,
            `ใบเรียกเก็บมีใบกำกับ ${tax.taxInvoiceNo} แล้ว — ปิด AR-COM ที่ซ้ำ`,
            now,
          ),
        );
      }
      continue;
    }

    if (ar.referenceType === 'TAX_INVOICE') {
      let tax = taxById.get(ar.referenceId);
      if (!tax) {
        const taxSnap = await db.collection('tax_invoices').doc(ar.referenceId).get();
        if (!taxSnap.exists) continue;
        tax = { id: taxSnap.id, ...(taxSnap.data() as Omit<TaxInvoice, 'id'>) };
        taxById.set(ar.referenceId, tax);
      }

      const receiptId = tax.linkedReceiptId?.trim();
      if (!receiptId) continue;

      let receipt = receiptById.get(receiptId);
      if (!receipt) {
        const rSnap = await db.collection('receipts').doc(receiptId).get();
        if (!rSnap.exists) continue;
        receipt = { id: rSnap.id, ...(rSnap.data() as Omit<MoneyReceipt, 'id'>) };
        receiptById.set(receiptId, receipt);
      }

      if (receipt.status !== 'ISSUED') continue;

      taxArPlans.push(
        closeArPlan(
          ar.id,
          ar,
          `ใบกำกับ ${tax.taxInvoiceNo} มีใบเสร็จ ${receipt.receiptNo} แล้ว — ปิด AR ค้าง`,
          now,
        ),
      );
    }
  }

  return { commercialArPlans, taxArPlans };
}

export async function applyReconcileDuplicateCommercialAr(
  db: Firestore,
  plans: ReconcileDuplicateArPlan[],
  dryRun: boolean,
): Promise<number> {
  if (dryRun || plans.length === 0) return 0;

  let batch = db.batch();
  let ops = 0;
  let applied = 0;

  for (const plan of plans) {
    batch.update(db.collection('accounts_receivable').doc(plan.arId), plan.patch);
    ops += 1;
    applied += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
  return applied;
}
