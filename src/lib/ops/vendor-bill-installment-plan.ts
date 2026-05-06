import type { Purchase, PurchaseVendorBill, VendorBillPaymentInstallment } from '@/lib/types';
import { stripUndefinedForFirestore } from '@/lib/firestore/strip-undefined-for-firestore';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';

export function vendorBillTotalInclVat(bill: PurchaseVendorBill, purchase: Purchase): number {
  return roundMoney2(Number(bill.billAmount ?? purchase.totalAmount) || 0);
}

export function billUsesPaymentInstallmentPlan(bill: PurchaseVendorBill): boolean {
  return !!(bill.paymentInstallments && bill.paymentInstallments.length > 0);
}

/** สร้างแผนงวดแบ่งเท่าๆ — งวดสุดท้ายรับเศษสตางค์ */
export function buildEqualInstallmentDrafts(
  count: number,
  totalInclVat: number,
): VendorBillPaymentInstallment[] {
  const n = Math.min(5, Math.max(1, Math.floor(count)));
  const total = roundMoney2(totalInclVat);
  const base = roundMoney2(total / n);
  const rows: VendorBillPaymentInstallment[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    const amt = isLast ? roundMoney2(total - sum) : base;
    sum = roundMoney2(sum + amt);
    rows.push({
      id:
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `inst_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 9)}`,
      sequence: i + 1,
      label: `งวดที่ ${i + 1}`,
      amountInclVat: amt,
      payStatus: 'PENDING',
    });
  }
  return rows;
}

export function validateInstallmentsAgainstTotal(
  installments: VendorBillPaymentInstallment[],
  totalInclVat: number,
): string | null {
  if (!installments.length) return 'ต้องมีอย่างน้อยหนึ่งงวดจ่าย';
  const sum = roundMoney2(installments.reduce((s, x) => s + Number(x.amountInclVat || 0), 0));
  if (Math.abs(sum - roundMoney2(totalInclVat)) > 0.02) {
    return `ผลรวมงวด (${sum.toFixed(2)}) ต้องเท่ากับยอดใบรับวางบิล (${roundMoney2(totalInclVat).toFixed(2)})`;
  }
  return null;
}

/** งวดเดียวเต็มยอด — ใช้ตอนส่งบัญชีถ้ายังไม่ได้สร้างแผนในฟอร์ม */
export function singleFullInstallment(totalInclVat: number): VendorBillPaymentInstallment[] {
  return buildEqualInstallmentDrafts(1, totalInclVat);
}

/** ยอดที่ยังต้องจัดแผนงวด (เต็มใบ หรือเฉพาะงวดที่ยัง PENDING หลังหักงวดที่จ่ายแล้ว) */
export function vendorBillRemainingForPendingInstallments(
  bill: PurchaseVendorBill,
  purchase: Purchase,
): number {
  const total = vendorBillTotalInclVat(bill, purchase);
  const paidSum = roundMoney2(
    (bill.paymentInstallments ?? [])
      .filter((i) => i.payStatus === 'PAID')
      .reduce((s, i) => s + Number(i.amountInclVat || 0), 0),
  );
  return roundMoney2(total - paidSum);
}

/** คงงวดที่จ่ายแล้วไว้ — แทนที่เฉพาะชุดงวด PENDING ด้วยแบบร่างใหม่ (บัญชีแบ่งงวดย้อนหลัง) */
export function mergePaidInstallmentsWithPendingDraft(
  bill: PurchaseVendorBill,
  pendingDraft: VendorBillPaymentInstallment[],
): VendorBillPaymentInstallment[] {
  const paid = (bill.paymentInstallments ?? [])
    .filter((i) => i.payStatus === 'PAID')
    .slice()
    .sort((a, b) => a.sequence - b.sequence);
  const maxSeq = paid.length ? Math.max(...paid.map((p) => p.sequence)) : 0;
  const freshPending: VendorBillPaymentInstallment[] = pendingDraft.map((row, idx) => {
    const seq = maxSeq + idx + 1;
    const id =
      row.id?.trim() ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `inst_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 9)}`);
    const inst: VendorBillPaymentInstallment = {
      id,
      sequence: seq,
      label: String(row.label ?? `งวดที่ ${seq}`).trim() || `งวดที่ ${seq}`,
      amountInclVat: roundMoney2(Number(row.amountInclVat || 0)),
      payStatus: 'PENDING',
    };
    const due = row.dueDate?.trim();
    if (due) inst.dueDate = due;
    return inst;
  });
  const merged = [...paid, ...freshPending];
  return stripUndefinedForFirestore(merged);
}
