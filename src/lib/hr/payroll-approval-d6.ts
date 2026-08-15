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

/** รายการที่ผู้อนุมัติกดดูได้จากแถว validation */
export interface ValidationInspectItem {
  workerId: string;
  workerName: string;
  lineId: string;
  /** สุทธิบนแถว */
  netAmount: number;
  /** รายการที่แก้/เพิ่มมือ */
  entries: Array<{ kind: 'เพิ่ม' | 'หัก' | 'หมายเหตุ'; label: string; amount?: number }>;
  slipHref?: string;
}

export interface ValidationCheck {
  id: string;
  label: string;
  severity: CheckSeverity;
  detail?: string;
  /** ขั้นตอนที่ผู้ใช้ทำได้เมื่อติดปัญหา — แสดงในศูนย์อนุมัติ */
  howToFix?: string;
  /** รายละเอียดกดดูได้ (เช่น รายการแก้มือ) */
  inspectItems?: ValidationInspectItem[];
}

export function hasBlockingRed(checks: ValidationCheck[]): boolean {
  return checks.some((c) => c.severity === 'red');
}

export function countAnomalies(checks: ValidationCheck[]): number {
  return checks.filter((c) => c.severity === 'red' || c.severity === 'yellow').length;
}

/** สอดคล้องหน้า batch: ไม่มี method → ถือเป็น CASH */
function resolvedPaymentMethod(line: PayrollBatchLine): string {
  const raw = line.workerPaymentProfileSnapshot?.paymentMethod;
  return String(raw || 'CASH')
    .trim()
    .toUpperCase();
}

/**
 * บัญชีไม่ครบจริงเมื่อตั้งใจโอน/พร้อมเพย์ แต่ snapshot ไม่มีเลขบัญชีหรือธนาคาร
 * (CASH / ไม่ระบุวิธีจ่าย = ผ่าน — ตรงกับที่หน้า batch แสดง CASH)
 */
function lineMissingBank(line: PayrollBatchLine): boolean {
  const method = resolvedPaymentMethod(line);
  if (method === 'CASH' || method === 'OTHER') return false;
  if (method === 'PROMPTPAY') {
    const pp = (line.workerPaymentProfileSnapshot?.promptPayId || '').trim();
    return !pp;
  }
  // BANK_TRANSFER หรือค่าอื่นที่ต้องมีบัญชี
  const p = line.workerPaymentProfileSnapshot;
  const acct = (p?.accountNumber || '').trim();
  const bank = (p?.bankName || p?.bankCode || '').toString().trim();
  return !acct || !bank;
}

function lineHasPriorPeriodPay(line: PayrollBatchLine): boolean {
  const items = line.hrLineAdjustments?.priorPeriodAllowanceItems;
  if (Array.isArray(items) && items.length > 0) return true;
  return false;
}

/**
 * งวด SUPPLEMENTAL / แถวที่มีรายการตกเบิกจากแก้ไขย้อนหลัง — ไม่บังคับ sourceTimesheetIds
 * (สร้างแถวจาก retro ไม่ใช่จาก daily timesheet ของงวดนี้)
 */
function lineMissingTimesheetRef(batch: PayrollBatch, line: PayrollBatchLine): boolean {
  if (batch.batchType === 'SUPPLEMENTAL') return false;
  if (lineHasPriorPeriodPay(line)) return false;
  return !line.sourceTimesheetIds || line.sourceTimesheetIds.length === 0;
}

function lineHasManualAdjustment(line: PayrollBatchLine): boolean {
  const remark = (line.remarks || '').toLowerCase();
  if (remark.includes('adjust') || remark.includes('แก้') || remark.includes('manual')) return true;
  const allow = line.hrLineAdjustments?.allowanceItems;
  const ded = line.hrLineAdjustments?.deductionItems;
  if (Array.isArray(allow) && allow.some((x) => Math.abs(Number(x.amount) || 0) > 0 || String(x.label || '').trim())) {
    return true;
  }
  if (Array.isArray(ded) && ded.some((x) => Math.abs(Number(x.amount) || 0) > 0 || String(x.label || '').trim())) {
    return true;
  }
  const notes = (line.hrLineAdjustments?.notes || '').trim();
  if (notes) return true;
  return false;
}

function buildManualInspectItem(batch: PayrollBatch, line: PayrollBatchLine): ValidationInspectItem {
  const entries: ValidationInspectItem['entries'] = [];
  for (const a of line.hrLineAdjustments?.allowanceItems ?? []) {
    const label = String(a.label || '').trim() || 'เบี้ยเลี้ยง/เพิ่มมือ';
    const amount = Number(a.amount) || 0;
    if (!label && amount === 0) continue;
    entries.push({ kind: 'เพิ่ม', label, amount });
  }
  for (const d of line.hrLineAdjustments?.deductionItems ?? []) {
    const label = String(d.label || '').trim() || 'หักพิเศษ';
    const amount = Number(d.amount) || 0;
    if (!label && amount === 0) continue;
    entries.push({ kind: 'หัก', label, amount });
  }
  const notes = (line.hrLineAdjustments?.notes || '').trim();
  if (notes) entries.push({ kind: 'หมายเหตุ', label: notes });
  const remark = (line.remarks || '').trim();
  if (remark && /adjust|แก้|manual/i.test(remark)) {
    entries.push({ kind: 'หมายเหตุ', label: remark });
  }
  if (entries.length === 0) {
    entries.push({ kind: 'หมายเหตุ', label: 'พบธงแก้มือบนแถว — เปิดสลิปเพื่อตรวจรายละเอียด' });
  }
  return {
    workerId: line.workerId,
    workerName: line.workerNameSnapshot || line.workerId,
    lineId: line.id,
    netAmount: Number(line.netAmount) || 0,
    entries,
    slipHref: `/payroll/batches/${batch.id}/workers/${line.workerId}`,
  };
}

/** ตรวจ worker payroll batch ก่อน HR approve (ไม่สร้างโมเดลใหม่ — ใช้ snapshot ใน batch line) */
export function validateWorkerPayrollBatch(
  batch: PayrollBatch,
  lines: PayrollBatchLine[],
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  if (!lines.length) {
    checks.push({
      id: 'no-lines',
      label: 'ไม่มีรายการบรรทัดใน batch',
      severity: 'red',
      detail: 'ต้องมีอย่างน้อย 1 แถวก่อนอนุมัติ',
      howToFix: 'กลับไปหน้างวดจ่าย → สร้าง/คำนวณบรรทัดจาก timesheet หรือดึงรายการตกเบิกให้มีอย่างน้อย 1 คน',
    });
    return checks;
  }

  const missingBank = lines.filter(lineMissingBank);
  if (missingBank.length > 0) {
    checks.push({
      id: 'bank',
      label: 'วิธีจ่ายโอน/พร้อมเพย์ แต่ snapshot บัญชีไม่ครบ',
      severity: 'red',
      detail: `${missingBank.length} แถว — ตัวอย่าง: ${missingBank
        .slice(0, 3)
        .map((l) => l.workerNameSnapshot)
        .join(', ')}${missingBank.length > 3 ? ' …' : ''}`,
      howToFix:
        '1) เปิดทะเบียนลูกจ้าง → แท็บการจ่ายเงิน ใส่บัญชี/พร้อมเพย์ให้ครบแล้วบันทึก 2) กลับมางวดนี้ กดคำนวณใหม่รายคน (หรือสร้างงวดใหม่) เพื่อให้ snapshot อัปเดต — ถ้ายอดจ่ายเงินสด ให้ตั้งวิธีจ่ายเป็น CASH บนทะเบียนแล้วคำนวณใหม่',
    });
  }

  const missingTs = lines.filter((l) => lineMissingTimesheetRef(batch, l));
  if (missingTs.length > 0) {
    checks.push({
      id: 'timesheet',
      label: 'งวดปกติยังไม่มีอ้างอิง timesheet บนแถว',
      severity: 'red',
      detail: `${missingTs.length} แถวไม่มี sourceTimesheetIds (งวด NORMAL ต้องผูกใบงานรายวัน)`,
      howToFix:
        'เปิดหน้างวด batch → คำนวณใหม่รายคนจาก timesheet ที่พร้อมจ่าย หรือสร้างงวด NORMAL ใหม่หลังปิดงวดเวลาแล้ว — ถ้างวดนี้เป็นตกเบิก (SUPPLEMENTAL) ให้ตรวจว่า batchType เป็น SUPPLEMENTAL',
    });
  } else if (batch.batchType === 'SUPPLEMENTAL' || lines.some(lineHasPriorPeriodPay)) {
    checks.push({
      id: 'timesheet',
      label: 'อ้างอิง timesheet (งวดตกเบิก / ส่วนเพิ่มงวดก่อน)',
      severity: 'green',
      detail: 'งวดตกเบิกไม่บังคับ sourceTimesheetIds — ยอดอ้างจากรายการแก้ไขย้อนหลัง / ส่วนเพิ่มงวดก่อน',
    });
  }

  const manual = lines.filter(lineHasManualAdjustment);
  if (manual.length > 0) {
    const inspectItems = manual.map((l) => buildManualInspectItem(batch, l));
    const entryCount = inspectItems.reduce((s, it) => s + it.entries.length, 0);
    checks.push({
      id: 'manual',
      label: 'มีรายการแก้มือ / ปรับบนสลิป',
      severity: 'yellow',
      detail: `${manual.length} คน · ${entryCount} รายการ — กดแถวนี้เพื่อดูว่าแก้รายการไหน ยอดเท่าไร`,
      howToFix: 'กดดูรายละเอียดด้านล่าง ตรวจยอดให้ถูกก่อนอนุมัติ — ไม่บล็อกการอนุมัติ',
      inspectItems,
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
  staffById: Map<string, OfficeStaff>,
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  if (!lines.length) {
    checks.push({
      id: 'no-lines',
      label: 'ยังไม่มีบรรทัดในงวด',
      severity: 'red',
      detail: 'กดคำนวณ/สร้างบรรทัดก่อนอนุมัติ',
      howToFix: 'เปิดงวดสำนักงาน → กดคำนวณให้มีบรรทัดครบก่อนส่งอนุมัติ',
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
      howToFix: 'เปิดทะเบียนพนักงานสำนักงาน → ใส่ชื่อธนาคารและเลขบัญชีให้ครบ แล้วกลับมาตรวจงวดนี้อีกครั้ง',
    });
  }
  if (missingTax > 0) {
    checks.push({
      id: 'tax',
      label: 'ไม่มีเลขภาษี',
      severity: 'red',
      detail: `${missingTax} รายการ`,
      howToFix: 'เปิดทะเบียนพนักงานสำนักงาน → กรอกเลขผู้เสียภาษีให้ครบ',
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
      howToFix: 'เปิดงวดสำนักงาน → คำนวณใหม่ให้มียอดรวมครบ',
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
