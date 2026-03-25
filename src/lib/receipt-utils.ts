import type { Receipt } from '@/lib/types';

/** เงินโอนเข้าบัญชีจริง (ไม่รวมหัก ณ) */
export function receiptCashDepositAmount(r: Pick<Receipt, 'receivedAmount' | 'cashDepositAmount'>): number {
  return r.cashDepositAmount ?? r.receivedAmount;
}

/** หัก ณ ระดับใบเสร็จ */
export function receiptHeaderWithholding(r: Pick<Receipt, 'withholdingTaxAmount'>): number {
  return Number(r.withholdingTaxAmount) || 0;
}
