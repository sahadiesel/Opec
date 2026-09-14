import type { PayrollBatchLine } from '@/lib/types';
import { CASH_ADVANCE_PAYROLL_DEDUCTION_KEY } from '@/lib/payroll/cash-advance-recovery';

type LineWithDeductionsBreakdown = {
  deductionsBreakdown?: Record<string, number> | null;
};

type LineWithHrAllowanceItems = {
  hrLineAdjustments?: {
    allowanceItems?: Array<{ amount: number }> | null;
    deductionItems?: Array<{ label: string; amount: number }> | null;
  } | null;
};

/** รวมยอดหักจาก deductionsBreakdown (ทุกคีย์) */
export function lineDeductionsTotal(line: LineWithDeductionsBreakdown): number {
  return Object.values(line.deductionsBreakdown || {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

/** รวมเบี้ยเลี้ยง / รายได้เพิ่มจาก hrLineAdjustments.allowanceItems */
export function hrAllowanceTotal(line: LineWithHrAllowanceItems): number {
  return (line.hrLineAdjustments?.allowanceItems ?? []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
}

/** alias — ใช้บน worker batch line (ชื่อเดิมใน worker page) */
export const allowanceItemsTotal = hrAllowanceTotal;

/** รายการหักสำหรับแสดงบน worker payslip / รายละเอียดบรรทัด (SS / ภงด. / หักพิเศษที่บันทึก) */
export function deductionDisplayRows(
  line: PayrollBatchLine,
  opts?: { isSupplemental?: boolean },
): Array<{ label: string; amount: number }> {
  const isSupplemental = opts?.isSupplemental === true;
  const d = line.deductionsBreakdown || {};
  const rows: Array<{ label: string; amount: number }> = [];
  const ss = isSupplemental ? 0 : Number(d.social_security) || 0;
  if (ss > 0.005 || !isSupplemental) {
    rows.push({ label: 'ประกันสังคม', amount: ss });
  }
  const pit = Number(d.pit_withholding) || 0;
  rows.push({
    label: isSupplemental
      ? 'ภาษี ณ ที่จ่าย (ภงด.) — การจ่ายตกเบิกครั้งนี้'
      : 'ภาษี ณ ที่จ่าย (ภงด.)',
    amount: pit,
  });
  const caAmt = Number(d[CASH_ADVANCE_PAYROLL_DEDUCTION_KEY]) || 0;
  if (caAmt > 0) {
    rows.push({
      label: 'หักคืนเบิกล่วงหน้า (อัตโนมัติ · จ่ายแล้วรอหักสลิป)',
      amount: caAmt,
    });
  }
  const manual = line.hrLineAdjustments?.deductionItems ?? [];
  manual.forEach((item, idx) => {
    const key = `manual_ded_${idx}`;
    const amt = Number(d[key]);
    if (amt > 0) rows.push({ label: item.label?.trim() || `หักพิเศษ (${idx + 1})`, amount: amt });
  });
  const known = new Set<string>([
    'social_security',
    'pit_withholding',
    CASH_ADVANCE_PAYROLL_DEDUCTION_KEY,
    'prior_paid_recovery',
  ]);
  manual.forEach((_, idx) => known.add(`manual_ded_${idx}`));
  for (const [k, v] of Object.entries(d)) {
    if (known.has(k)) continue;
    if (isSupplemental && (/prior.?paid|หักยอดที่ชำระ|social.?security/i.test(k))) continue;
    const n = Number(v) || 0;
    if (n !== 0) rows.push({ label: k, amount: n });
  }
  return rows;
}

/** ป้ายชื่อคีย์หักจาก snapshot (ออฟฟิศ / ผู้บริหาร) */
export function snapshotDeductionLabel(key: string, line: LineWithHrAllowanceItems): string {
  if (key === 'social_security') return 'ประกันสังคม';
  if (key === 'pit_withholding') return 'ภาษี ณ ที่จ่าย (ภงด.)';
  if (key === 'pre_employment_deduction') return 'หักก่อนวันเริ่มงาน (เงินเดือนไม่เต็มเดือน)';
  if (key === 'post_employment_deduction') return 'หักหลังวันสิ้นสุดการจ้าง';
  if (key === 'late_deduction') return 'หักมาสาย';
  if (key === 'absence_deduction') return 'หักขาดงาน (จากสแกน)';
  if (key === 'unpaid_leave_deduction') return 'หักลาเกินสิทธิ์ / ลาไม่อนุมัติ';
  if (key === 'cash_advance_recovery') return 'หักคืนเบิกล่วงหน้า';
  const m = /^manual_ded_(\d+)$/.exec(key);
  if (m) {
    const idx = Number(m[1]);
    const item = line.hrLineAdjustments?.deductionItems?.[idx];
    if (item?.label?.trim()) return item.label.trim();
    return `หักเพิ่ม (${idx + 1})`;
  }
  return key.replace(/_/g, ' ');
}
