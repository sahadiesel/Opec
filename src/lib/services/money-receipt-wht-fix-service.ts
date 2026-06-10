'use client';

import { doc, getDoc, writeBatch, type Firestore } from 'firebase/firestore';
import type { AccountsReceivable, ARStatus, MoneyReceipt, TaxInvoice, User } from '@/lib/types';
import {
  detectMoneyReceiptWhtUndercharge,
  type MoneyReceiptWhtFixPlan,
} from '@/lib/accounting/money-receipt-wht-amount';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';

export type FixMoneyReceiptWhtAmountResult = {
  receiptId: string;
  receiptNo: string;
  fromAmount: number;
  toAmount: number;
  arUpdated: boolean;
};

/** แก้ใบเสร็จเดิม (client Firestore) — เอกสาร + AR; ไม่แตะ cashbook/ธนาคาร */
export async function fixMoneyReceiptWhtAmount(
  db: Firestore,
  receipt: MoneyReceipt,
  taxInv: TaxInvoice,
  actor: User,
): Promise<FixMoneyReceiptWhtAmountResult> {
  const fix = detectMoneyReceiptWhtUndercharge(taxInv, receipt.amount);
  if (!fix) {
    throw new Error('ใบเสร็จนี้ไม่ตรงรูปแบบที่ต้องแก้ (ยอดไม่ใช่แบบหัก ณ ที่จ่ายจากรวม VAT)');
  }

  const plan: MoneyReceiptWhtFixPlan = {
    receiptId: receipt.id,
    receiptNo: receipt.receiptNo,
    taxInvoiceId: taxInv.id,
    taxInvoiceNo: taxInv.taxInvoiceNo,
    expectedAmount: fix.expectedAmount,
    currentAmount: fix.currentAmount,
    delta: fix.delta,
    cashbookEntryId: receipt.cashbookEntryId,
    bankAccountId: receipt.bankAccountId,
    arEntryId: taxInv.arEntryId?.trim() || undefined,
  };

  const arId = plan.arEntryId;
  if (arId) {
    const arSnap = await getDoc(doc(db, 'accounts_receivable', arId));
    if (arSnap.exists()) {
      const ar = arSnap.data() as AccountsReceivable;
      if (ar.referenceType === 'TAX_INVOICE' && ar.referenceId === taxInv.id) {
        plan.arCreditBefore = roundMoney2(Number(ar.creditAmount) || 0);
        plan.arDebit = roundMoney2(Number(ar.debitAmount) || 0);
      }
    }
  }

  const now = Date.now();
  const batch = writeBatch(db);

  batch.update(doc(db, 'receipts', plan.receiptId), {
    amount: plan.expectedAmount,
    updatedAt: now,
    amountCorrectedAt: now,
    amountCorrectedReason: 'WHT_DOC_GROSS_TOTAL',
    amountCorrectedByUid: actor.id,
    amountCorrectedByName: actor.displayName,
    amountCorrectedFrom: plan.currentAmount,
  });

  let arUpdated = false;
  if (plan.arEntryId && plan.arDebit != null && plan.arCreditBefore != null) {
    const newCredit = roundMoney2(plan.arCreditBefore + plan.delta);
    const outstanding = roundMoney2(Math.max(0, plan.arDebit - newCredit));
    let nextStatus: ARStatus = 'OPEN';
    if (outstanding <= 0.01) nextStatus = 'PAID';
    else if (newCredit > 0.01) nextStatus = 'PARTIALLY_PAID';

    batch.update(doc(db, 'accounts_receivable', plan.arEntryId), {
      creditAmount: newCredit,
      outstandingAmount: outstanding,
      status: nextStatus,
      updatedAt: now,
    });
    arUpdated = true;
  }

  await batch.commit();

  return {
    receiptId: plan.receiptId,
    receiptNo: plan.receiptNo,
    fromAmount: plan.currentAmount,
    toAmount: plan.expectedAmount,
    arUpdated,
  };
}
