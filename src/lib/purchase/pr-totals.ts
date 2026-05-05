import type { PurchaseRequestVatTreatment } from '@/lib/types';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';

export function sumLineAmounts(lines: { amount: number }[]): number {
  return roundMoney2(lines.reduce((s, l) => s + Number(l.amount || 0), 0));
}

/**
 * จากผลรวมบรรทัด (ตามโหมด) → แตกเป็นฐาน / VAT / รวม
 * - NONE: บรรทัดไม่มี VAT
 * - EXCLUSIVE: ผลรวมบรรทัด = ฐานก่อน VAT
 * - INCLUSIVE: ผลรวมบรรทัด = ยอดรวมรวม VAT แล้ว
 */
export function computePurchaseTotalsFromLines(
  lineSum: number,
  vat: PurchaseRequestVatTreatment | undefined
): { amountBeforeTax: number; vatAmount: number; totalAmount: number } {
  const mode = vat ?? 'EXCLUSIVE';
  const sum = roundMoney2(lineSum);
  if (mode === 'NONE') {
    return { amountBeforeTax: sum, vatAmount: 0, totalAmount: sum };
  }
  if (mode === 'EXCLUSIVE') {
    const amountBeforeTax = sum;
    const vatAmount = roundMoney2(amountBeforeTax * 0.07);
    return {
      amountBeforeTax,
      vatAmount,
      totalAmount: roundMoney2(amountBeforeTax + vatAmount),
    };
  }
  const totalAmount = sum;
  const amountBeforeTax = roundMoney2(totalAmount / 1.07);
  const vatAmount = roundMoney2(totalAmount - amountBeforeTax);
  return { amountBeforeTax, vatAmount, totalAmount };
}
