import type { TaxInvoice } from '@/lib/types';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';

/** ยอดใบเสร็จ = ยอดรวมใบกำกับ (ฐานภาษี + VAT) */
export function expectedMoneyReceiptAmountFromInvoice(inv: Pick<TaxInvoice, 'totalAmount'>): number {
  return roundMoney2(inv.totalAmount);
}

/** ใบเสร็จเดิมที่หัก ณ ที่จ่ายออกจากยอดรวม (รวม VAT) แล้ว */
export function detectMoneyReceiptWhtUndercharge(
  inv: Pick<TaxInvoice, 'totalAmount' | 'withholdingTaxAmount' | 'showWithholdingOnDocument'>,
  receiptAmount: number,
): { expectedAmount: number; currentAmount: number; delta: number } | null {
  const expected = expectedMoneyReceiptAmountFromInvoice(inv);
  const current = roundMoney2(receiptAmount);
  if (Math.abs(current - expected) <= 0.005) return null;

  const wht = roundMoney2(Number(inv.withholdingTaxAmount) || 0);
  if (inv.showWithholdingOnDocument !== true || wht <= 0.005) return null;

  const oldBugAmount = roundMoney2(expected - wht);
  if (Math.abs(current - oldBugAmount) > 0.005) return null;

  return {
    expectedAmount: expected,
    currentAmount: current,
    delta: roundMoney2(expected - current),
  };
}

export type MoneyReceiptWhtFixPlan = {
  receiptId: string;
  receiptNo: string;
  taxInvoiceId: string;
  taxInvoiceNo: string;
  expectedAmount: number;
  currentAmount: number;
  delta: number;
  cashbookEntryId?: string;
  cashbookAmount?: number;
  bankAccountId?: string;
  arEntryId?: string;
  arCreditBefore?: number;
  arDebit?: number;
};
