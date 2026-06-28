import type { HrPayrollLineAdjustments, PriorPeriodAllowanceItem } from '@/lib/types';

/** ข้อความบนสลิป — ระบุชัดว่าเป็นรายได้ของงวดที่ล็อคแล้ว (จ่ายในงวด payroll ปัจจุบัน) */
export function formatPriorPeriodAllowancePayslipLabel(item: PriorPeriodAllowanceItem): string {
  const base = String(item.label || '').trim() || 'รายได้ย้อนหลัง';
  const ym = String(item.sourceYearMonth || '').trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return base;
  const [ys, ms] = ym.split('-').map(Number);
  const d = new Date(ys, ms - 1, 1);
  const monthLabel = d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
  return `ส่วนเพิ่มจากงวด ${monthLabel} — ${base}`;
}

export function sumPriorPeriodAllowances(items: readonly PriorPeriodAllowanceItem[] | undefined): number {
  return (items ?? []).reduce((s, x) => s + Math.max(0, Number(x.amount) || 0), 0);
}

export function sumRegularAllowances(
  items: readonly { amount: number }[] | undefined,
): number {
  return (items ?? []).reduce((s, x) => s + Math.max(0, Number(x.amount) || 0), 0);
}

/** รวมเบี้ยเลี้ยงปกติ + รายการย้อนหลัง — ใช้คำนวณ gross / SS / PIT */
export function sumAllHrAllowances(adj?: HrPayrollLineAdjustments | null): number {
  return (
    sumRegularAllowances(adj?.allowanceItems) + sumPriorPeriodAllowances(adj?.priorPeriodAllowanceItems)
  );
}

export function normalizePriorPeriodAllowanceItems(
  items: Array<{ sourceYearMonth: string; label: string; amount: number }> | undefined,
): PriorPeriodAllowanceItem[] {
  return (items ?? [])
    .map((x) => ({
      sourceYearMonth: String(x.sourceYearMonth || '').trim(),
      label: String(x.label || '').trim(),
      amount: Math.max(0, Number(x.amount) || 0),
    }))
    .filter((x) => /^\d{4}-\d{2}$/.test(x.sourceYearMonth) && x.label && x.amount > 0);
}
