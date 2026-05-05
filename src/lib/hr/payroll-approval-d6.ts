/**
 * HR-D6: validation + policy labels for Payroll Approval Center (Worker batch / Office run).
 */

import type {
  OfficePayrollLine,
  OfficePayrollRun,
  OfficeStaff,
  PayrollBatch,
  PayrollBatchLine,
} from '@/lib/types';
import {
  DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT,
  DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT,
} from '@/lib/hr/pit-thailand';
import { D8_ENGINE_VERSION } from '@/lib/payroll/d8/constants';

export const PAYROLL_POLICY_VERSION_LABEL = `${D8_ENGINE_VERSION} — pit-thailand annual ladder + policy records (SS ${DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT}%, เพดาน ${DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT.toLocaleString('th-TH')} บ./ด.)`;

export type CheckSeverity = 'red' | 'yellow' | 'green';

export interface ValidationCheck {
  id: string;
  label: string;
  severity: CheckSeverity;
  detail?: string;
}

export function hasBlockingRed(checks: ValidationCheck[]): boolean {
  return checks.some((c) => c.severity === 'red');
}

export function countAnomalies(checks: ValidationCheck[]): number {
  return checks.filter((c) => c.severity === 'red' || c.severity === 'yellow').length;
}

function lineMissingBank(line: PayrollBatchLine): boolean {
  const p = line.workerPaymentProfileSnapshot;
  if (!p) return true;
  if (p.paymentMethod === 'CASH') return false;
  const acct = (p.accountNumber || '').trim();
  const bank = (p.bankName || p.bankCode || '').toString().trim();
  return !acct || !bank;
}

function lineMissingTimesheetRef(line: PayrollBatchLine): boolean {
  return !line.sourceTimesheetIds || line.sourceTimesheetIds.length === 0;
}

function lineHasManualAdjustment(line: PayrollBatchLine): boolean {
  const d = line.deductionsBreakdown || {};
  const remark = (line.remarks || '').toLowerCase();
  if (Object.keys(d).length > 0) return true;
  if (remark.includes('adjust') || remark.includes('แก้') || remark.includes('manual')) return true;
  return false;
}

/** ตรวจ worker payroll batch ก่อน HR approve (ไม่สร้างโมเดลใหม่ — ใช้ snapshot ใน batch line) */
export function validateWorkerPayrollBatch(
  batch: PayrollBatch,
  lines: PayrollBatchLine[]
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  if (!lines.length) {
    checks.push({
      id: 'no-lines',
      label: 'ไม่มีรายการบรรทัดใน batch',
      severity: 'red',
      detail: 'ต้องมีอย่างน้อย 1 แถวก่อนอนุมัติ',
    });
    return checks;
  }

  const missingBank = lines.filter(lineMissingBank);
  if (missingBank.length > 0) {
    checks.push({
      id: 'bank',
      label: `ไม่มีบัญชีธนาคาร (หรือไม่ครบใน snapshot)`,
      severity: 'red',
      detail: `${missingBank.length} แถว — ตัวอย่าง: ${missingBank
        .slice(0, 3)
        .map((l) => l.workerNameSnapshot)
        .join(', ')}${missingBank.length > 3 ? ' …' : ''}`,
    });
  }

  const missingTs = lines.filter(lineMissingTimesheetRef);
  if (missingTs.length > 0) {
    checks.push({
      id: 'timesheet',
      label: 'worker ยังขาดการอ้างอิง timesheet',
      severity: 'red',
      detail: `${missingTs.length} แถวไม่มี sourceTimesheetIds`,
    });
  }

  const manual = lines.filter(lineHasManualAdjustment);
  if (manual.length > 0) {
    checks.push({
      id: 'manual',
      label: 'มี manual adjustment / รายการแก้มือใน snapshot',
      severity: 'yellow',
      detail: `${manual.length} แถว — ตรวจสอบ deductionsBreakdown / earningsBreakdown / หมายเหตุ`,
    });
  }

  checks.push({
    id: 'rate-term',
    label: 'rate / term กับสัญญาโครงการ',
    severity: 'green',
    detail: 'ยอด freeze จาก snapshot ณ เวลา generate — หากสงสัยให้สุ่มตรวจ PO/สัญญา',
  });

  return checks;
}

function staffMissingBank(s: OfficeStaff): boolean {
  return !(s.bankAccountNumber?.trim() && s.bankName?.trim());
}

function staffMissingTax(s: OfficeStaff): boolean {
  return !s.taxId?.trim();
}

/** ตรวจ office payroll run จากบรรทัด + master office_staff (ถ้ามี) */
export function validateOfficePayrollRun(
  run: OfficePayrollRun,
  lines: OfficePayrollLine[],
  staffById: Map<string, OfficeStaff>
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  if (!lines.length) {
    checks.push({
      id: 'no-lines',
      label: 'ยังไม่มีบรรทัดในงวด',
      severity: 'red',
      detail: 'กดคำนวณ/สร้างบรรทัดก่อนอนุมัติ',
    });
    return checks;
  }

  let missingBank = 0;
  let missingTax = 0;
  for (const line of lines) {
    const s = staffById.get(line.staffId);
    if (s) {
      if (staffMissingBank(s)) missingBank++;
      if (staffMissingTax(s)) missingTax++;
    } else {
      missingBank++;
      missingTax++;
    }
  }

  if (missingBank > 0) {
    checks.push({
      id: 'bank',
      label: 'ไม่มีบัญชีธนาคาร (จากทะเบียนพนักงาน)',
      severity: 'red',
      detail: `${missingBank} รายการที่ map กับทะเบียนแล้วยังไม่ครบบัญชี`,
    });
  }
  if (missingTax > 0) {
    checks.push({
      id: 'tax',
      label: 'ไม่มีเลขภาษี',
      severity: 'red',
      detail: `${missingTax} รายการ`,
    });
  }

  checks.push({
    id: 'timesheet-na',
    label: 'timesheet รายวัน (office)',
    severity: 'green',
    detail: 'งวด office ไม่ใช้ daily timesheet — ใช้ทะเบียน + บรรทัดงวดแทน',
  });

  if (run.totalDeductions == null || run.grossAmount == null) {
    checks.push({
      id: 'totals',
      label: 'ยอดรวมงวดยังไม่สมบูรณ์',
      severity: 'yellow',
    });
  }

  return checks;
}

export const WORKER_FREEZE_BULLETS: string[] = [
  'Source timesheets ที่ถูกล็อกตอน generate batch จะคงสถานะ LOCKED',
  'บรรทัด batch (PayrollBatchLine) ถือเป็น snapshot หลังอนุมัติ — แก้ตรงไม่ได้ ต้องใช้ correction workflow',
  'หลังผู้จัดการกดอนุมัติจ่ายเงิน สถานะ batch → FINANCE_PREPARED (คิวบัญชีรอจ่าย) — ไม่มีขั้น HR_APPROVED + ส่งบัญชีแยก',
];

export const OFFICE_FREEZE_BULLETS: string[] = [
  'บรรทัด office_payroll_runs/{id}/lines เป็นยอด snapshot หลังอนุมัติ HR',
  'การแก้ยอดหลัง HR_APPROVED ต้องผ่านบัญชี / correction ตามนโยบาย',
  'ภาษี/ประกันสังคมอ้างอิง ' + PAYROLL_POLICY_VERSION_LABEL,
];
