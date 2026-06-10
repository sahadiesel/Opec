import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { AccountsReceivable, ARStatus, MoneyReceipt, TaxInvoice } from '@/lib/types';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import {
  detectMoneyReceiptWhtUndercharge,
  type MoneyReceiptWhtFixPlan,
} from '@/lib/accounting/money-receipt-wht-amount';

export type { MoneyReceiptWhtFixPlan } from '@/lib/accounting/money-receipt-wht-amount';
export { detectMoneyReceiptWhtUndercharge, expectedMoneyReceiptAmountFromInvoice } from '@/lib/accounting/money-receipt-wht-amount';

export type ScanMoneyReceiptWhtFixesResult = {
  plans: MoneyReceiptWhtFixPlan[];
  skipped: { receiptId: string; receiptNo: string; reason: string }[];
};

export async function scanMoneyReceiptWhtFixes(
  db: Firestore,
  opts?: { receiptId?: string; receiptNo?: string },
): Promise<ScanMoneyReceiptWhtFixesResult> {
  const plans: MoneyReceiptWhtFixPlan[] = [];
  const skipped: ScanMoneyReceiptWhtFixesResult['skipped'] = [];

  let receiptDocs: QueryDocumentSnapshot[] = [];

  if (opts?.receiptId?.trim()) {
    const snap = await db.collection('receipts').doc(opts.receiptId.trim()).get();
    if (!snap.exists) {
      skipped.push({ receiptId: opts.receiptId, receiptNo: '—', reason: 'ไม่พบใบเสร็จ' });
      return { plans, skipped };
    }
    receiptDocs = [snap as QueryDocumentSnapshot];
  } else if (opts?.receiptNo?.trim()) {
    const snap = await db
      .collection('receipts')
      .where('receiptNo', '==', opts.receiptNo.trim())
      .limit(5)
      .get();
    receiptDocs = snap.docs;
    if (receiptDocs.length === 0) {
      skipped.push({ receiptId: '—', receiptNo: opts.receiptNo, reason: 'ไม่พบใบเสร็จ' });
      return { plans, skipped };
    }
  } else {
    receiptDocs = (await db.collection('receipts').get()).docs;
  }

  for (const rDoc of receiptDocs) {
    const receipt = { id: rDoc.id, ...rDoc.data() } as MoneyReceipt;
    const taxSnap = await db.collection('tax_invoices').doc(receipt.taxInvoiceId).get();
    if (!taxSnap.exists) {
      skipped.push({
        receiptId: receipt.id,
        receiptNo: receipt.receiptNo,
        reason: 'ไม่พบใบกำกับอ้างอิง',
      });
      continue;
    }
    const inv = { id: taxSnap.id, ...taxSnap.data() } as TaxInvoice;
    const fix = detectMoneyReceiptWhtUndercharge(inv, receipt.amount);
    if (!fix) {
      skipped.push({
        receiptId: receipt.id,
        receiptNo: receipt.receiptNo,
        reason: 'ไม่ตรงรูปแบบที่ต้องแก้ (ยอดไม่ใช่แบบหัก ณ ที่จ่ายจากรวม VAT)',
      });
      continue;
    }

    let cashbookAmount: number | undefined;
    if (receipt.cashbookEntryId) {
      const cbSnap = await db.collection('cashbook_entries').doc(receipt.cashbookEntryId).get();
      if (cbSnap.exists) {
        cashbookAmount = roundMoney2(Number(cbSnap.data()?.amount) || 0);
      }
    }

    let arCreditBefore: number | undefined;
    let arDebit: number | undefined;
    const arId = inv.arEntryId?.trim();
    if (arId) {
      const arSnap = await db.collection('accounts_receivable').doc(arId).get();
      if (arSnap.exists) {
        const ar = arSnap.data() as AccountsReceivable;
        arCreditBefore = roundMoney2(Number(ar.creditAmount) || 0);
        arDebit = roundMoney2(Number(ar.debitAmount) || 0);
      }
    }

    plans.push({
      receiptId: receipt.id,
      receiptNo: receipt.receiptNo,
      taxInvoiceId: inv.id,
      taxInvoiceNo: inv.taxInvoiceNo,
      expectedAmount: fix.expectedAmount,
      currentAmount: fix.currentAmount,
      delta: fix.delta,
      cashbookEntryId: receipt.cashbookEntryId,
      cashbookAmount,
      bankAccountId: receipt.bankAccountId,
      arEntryId: arId || undefined,
      arCreditBefore,
      arDebit,
    });
  }

  return { plans, skipped };
}

export type ApplyMoneyReceiptWhtFixParams = {
  /** ปรับ cashbook + ยอดธนาคารด้วย (ใช้เมื่อเงินเข้าบัญชีจริงเป็นยอดเต็ม) — ค่าเริ่มต้น false */
  includeCashbook?: boolean;
  actorUid?: string;
  actorName?: string;
};

export type ApplyMoneyReceiptWhtFixResult = {
  receiptId: string;
  receiptNo: string;
  fromAmount: number;
  toAmount: number;
  arUpdated: boolean;
  cashbookUpdated: boolean;
};

/**
 * แก้ใบเสร็จเดิม: ยอดเอกสาร = รวม VAT ตามใบกำกับ
 * ค่าเริ่มต้นไม่แตะ cashbook/ธนาคาร (เงินโอนจริงมักเป็นยอดหลังหัก ณ ที่จ่าย)
 */
export async function applyMoneyReceiptWhtFix(
  db: Firestore,
  plan: MoneyReceiptWhtFixPlan,
  params?: ApplyMoneyReceiptWhtFixParams,
): Promise<ApplyMoneyReceiptWhtFixResult> {
  const includeCashbook = params?.includeCashbook === true;
  const now = Date.now();
  const batch = db.batch();

  const receiptRef = db.collection('receipts').doc(plan.receiptId);
  batch.update(receiptRef, {
    amount: plan.expectedAmount,
    updatedAt: now,
    amountCorrectedAt: now,
    amountCorrectedReason: 'WHT_DOC_GROSS_TOTAL',
    amountCorrectedByUid: params?.actorUid ?? null,
    amountCorrectedByName: params?.actorName ?? null,
    amountCorrectedFrom: plan.currentAmount,
  });

  let arUpdated = false;
  if (plan.arEntryId && plan.arDebit != null && plan.arCreditBefore != null) {
    const newCredit = roundMoney2(plan.arCreditBefore + plan.delta);
    const outstanding = roundMoney2(Math.max(0, plan.arDebit - newCredit));
    let nextStatus: ARStatus = 'OPEN';
    if (outstanding <= 0.01) nextStatus = 'PAID';
    else if (newCredit > 0.01) nextStatus = 'PARTIALLY_PAID';

    batch.update(db.collection('accounts_receivable').doc(plan.arEntryId), {
      creditAmount: newCredit,
      outstandingAmount: outstanding,
      status: nextStatus,
      updatedAt: now,
    });
    arUpdated = true;
  }

  let cashbookUpdated = false;
  if (includeCashbook && plan.cashbookEntryId) {
    batch.update(db.collection('cashbook_entries').doc(plan.cashbookEntryId), {
      amount: plan.expectedAmount,
      updatedAt: now,
    });
    if (plan.bankAccountId) {
      batch.update(db.collection('bank_accounts').doc(plan.bankAccountId), {
        currentBalance: FieldValue.increment(plan.delta),
        updatedAt: now,
      });
    }
    cashbookUpdated = true;
  }

  await batch.commit();

  return {
    receiptId: plan.receiptId,
    receiptNo: plan.receiptNo,
    fromAmount: plan.currentAmount,
    toAmount: plan.expectedAmount,
    arUpdated,
    cashbookUpdated,
  };
}
