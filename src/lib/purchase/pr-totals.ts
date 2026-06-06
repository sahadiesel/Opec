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
  vat: PurchaseRequestVatTreatment | undefined,
  discountAmount = 0,
): { lineSum: number; discountAmount: number; amountBeforeTax: number; vatAmount: number; totalAmount: number } {
  const mode = vat ?? 'EXCLUSIVE';
  const sum = roundMoney2(lineSum);
  const discount = Math.max(0, roundMoney2(Number(discountAmount) || 0));

  if (mode === 'NONE') {
    const amountBeforeTax = Math.max(0, roundMoney2(sum - discount));
    return { lineSum: sum, discountAmount: discount, amountBeforeTax, vatAmount: 0, totalAmount: amountBeforeTax };
  }
  if (mode === 'EXCLUSIVE') {
    const amountBeforeTax = Math.max(0, roundMoney2(sum - discount));
    const vatAmount = roundMoney2(amountBeforeTax * 0.07);
    return {
      lineSum: sum,
      discountAmount: discount,
      amountBeforeTax,
      vatAmount,
      totalAmount: roundMoney2(amountBeforeTax + vatAmount),
    };
  }
  const preDiscountBeforeTax = roundMoney2(sum / 1.07);
  const cappedDiscount = Math.min(discount, preDiscountBeforeTax);
  const amountBeforeTax = Math.max(0, roundMoney2(preDiscountBeforeTax - cappedDiscount));
  const vatAmount = roundMoney2(amountBeforeTax * 0.07);
  return {
    lineSum: sum,
    discountAmount: cappedDiscount,
    amountBeforeTax,
    vatAmount,
    totalAmount: roundMoney2(amountBeforeTax + vatAmount),
  };
}
