/**
 * ลูกจ้างแบบเหมา — ชั้นเสริมบน payroll ลูกจ้างบริษัท
 * ไม่ใช้กับสูตร D8 / ปสง. / ภงด.1 ของลูกจ้างบริษัท และไม่ใช้กับราคาขายลูกค้า
 */
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import type { Assignment, PayrollBatchLine, PayrollPolicyRecord, Worker } from '@/lib/types';
import { effectiveWorkerJobStatus } from '@/lib/ops/worker-effective-job-status';
import { HR_LUMP_SUM_WORKER_LABOR_POLICY_ID } from '@/lib/payroll/d8/hr-statutory-policy-ids';
import {
  DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT,
  type WorkerGlobalLaborContext,
} from '@/lib/payroll/worker-global-labor-policy';

export const LUMP_SUM_WHT_DEDUCTION_KEY = 'lump_sum_wht';
export const DEFAULT_LUMP_SUM_WHT_RATE_PERCENT = 3;

export const DEFAULT_LUMP_SUM_WORKER_LABOR_CONTEXT: WorkerGlobalLaborContext = {
  cost: {
    otAfterShift: 1.5,
    holiday: 1,
    publicHoliday: 1,
    sunday: 1,
    sundayOt: 1.5,
    standby: 0.5,
    mobilization: 1,
    demobilization: 1,
    travel: 1,
  },
  weeklyRestPattern: 'none',
  calendarHolidays: [],
};

export function isLumpSumWorker(
  worker?: Pick<Worker, 'payrollEngagementKind'> | null,
): boolean {
  return worker?.payrollEngagementKind === 'LUMP_SUM';
}

export const LUMP_SUM_ENGAGEMENT_LOCKED_MESSAGE =
  'ไม่สามารถเปลี่ยนประเภทลูกจ้างได้ในขณะนี้ เพราะลูกจ้างยังอยู่ในรอบการทำงาน (มอบหมายงาน / ลงไซต์) และยังคำนวณค่าแรงแบบเดิมอยู่ — ให้คำนวณและจ่ายค่าแรงในระบบปัจจุบันให้สิ้นสุด และ Unassign / จบงานก่อน จึงจะเปลี่ยนระหว่างลูกจ้างบริษัทกับลูกจ้างแบบเหมาได้';

/** เปลี่ยนประเภทได้เฉพาะเมื่อยังไม่ mob / ยังไม่ถูกมอบหมายลงงาน */
export function workerPayrollEngagementChangeBlocked(
  worker: Pick<Worker, 'id' | 'workerStatus'> | null | undefined,
  mobilizations: Assignment[] | null | undefined,
): boolean {
  if (!worker) return false;
  const job = effectiveWorkerJobStatus(worker as Worker, mobilizations);
  return job === 'ASSIGNED' || job === 'ON_SITE';
}

export function isLumpSumPayrollLine(
  line?: Pick<PayrollBatchLine, 'payrollEngagementKind'> | null,
  worker?: Pick<Worker, 'payrollEngagementKind'> | null,
): boolean {
  if (line?.payrollEngagementKind === 'LUMP_SUM') return true;
  if (line?.payrollEngagementKind === 'COMPANY') return false;
  return isLumpSumWorker(worker);
}

export function laborContextForWorker(
  worker: Pick<Worker, 'payrollEngagementKind'> | undefined | null,
  companyLabor: WorkerGlobalLaborContext,
  lumpSumLabor: WorkerGlobalLaborContext,
): WorkerGlobalLaborContext {
  return isLumpSumWorker(worker) ? lumpSumLabor : companyLabor;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function lumpSumWithholdingBaht(
  gross: number,
  ratePercent: number = DEFAULT_LUMP_SUM_WHT_RATE_PERCENT,
): number {
  const rate = Number.isFinite(ratePercent) && ratePercent >= 0 ? ratePercent : DEFAULT_LUMP_SUM_WHT_RATE_PERCENT;
  return round2(Math.max(0, gross) * (rate / 100));
}

/** แทน ปสง. + ภงด.1 ด้วยหัก ณ ที่จ่ายเหมา — คงหักอื่น (เบิกล่วงหน้า / หักพิเศษ) */
export function applyLumpSumStatutoryDeductions(
  deductions: Record<string, number>,
  gross: number,
  ratePercent: number = DEFAULT_LUMP_SUM_WHT_RATE_PERCENT,
): Record<string, number> {
  const next: Record<string, number> = { ...deductions };
  delete next.social_security;
  delete next.employee_assistance_fund;
  delete next.pit_withholding;
  const wht = lumpSumWithholdingBaht(gross, ratePercent);
  if (wht > 0) next[LUMP_SUM_WHT_DEDUCTION_KEY] = wht;
  else delete next[LUMP_SUM_WHT_DEDUCTION_KEY];
  return next;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function laborFromPolicyConfig(
  cfg: Record<string, unknown>,
  defaults: WorkerGlobalLaborContext,
): WorkerGlobalLaborContext {
  const raw = cfg.costMultipliers;
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = defaults.cost;
  const weekly = cfg.weeklyRestPattern;
  const weeklyRestPattern =
    weekly === 'none' || weekly === 'sat_sun' || weekly === 'sunday_only'
      ? weekly
      : defaults.weeklyRestPattern;
  const rawHolidays = cfg.calendarHolidays;
  const calendarHolidays: WorkerGlobalLaborContext['calendarHolidays'] = [];
  if (Array.isArray(rawHolidays)) {
    for (const row of rawHolidays) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const date = String(r.date || '').trim();
      const label = String(r.label || '').trim();
      if (!date || !label) continue;
      calendarHolidays.push({ date, label });
    }
  }
  return {
    cost: {
      otAfterShift: num(o.otAfterShift, d.otAfterShift),
      holiday: num(o.holiday, d.holiday),
      publicHoliday: num(o.publicHoliday, d.publicHoliday),
      sunday: num(o.sunday, d.sunday),
      sundayOt: num(o.sundayOt, d.sundayOt),
      standby: num(o.standby, d.standby),
      mobilization: num(o.mobilization, d.mobilization),
      demobilization: num(o.demobilization, d.demobilization),
      travel: num(o.travel, d.travel),
    },
    weeklyRestPattern,
    calendarHolidays,
  };
}

export function lumpSumLaborContextFromPolicy(
  rec: PayrollPolicyRecord | null | undefined,
): WorkerGlobalLaborContext {
  if (!rec || rec.kind !== 'lump_sum_worker_labor' || rec.status !== 'active') {
    return DEFAULT_LUMP_SUM_WORKER_LABOR_CONTEXT;
  }
  const cfg = rec.config && typeof rec.config === 'object' ? (rec.config as Record<string, unknown>) : {};
  return laborFromPolicyConfig(cfg, DEFAULT_LUMP_SUM_WORKER_LABOR_CONTEXT);
}

export function lumpSumWithholdingRatePercentFromPolicy(
  rec: PayrollPolicyRecord | null | undefined,
): number {
  const cfg = rec?.config && typeof rec.config === 'object' ? (rec.config as Record<string, unknown>) : {};
  return num(cfg.withholdingRatePercent, DEFAULT_LUMP_SUM_WHT_RATE_PERCENT);
}

export async function fetchLumpSumWorkerLaborContextFromFirestore(
  db: Firestore,
): Promise<WorkerGlobalLaborContext> {
  const snap = await getDoc(doc(db, 'payroll_policies', HR_LUMP_SUM_WORKER_LABOR_POLICY_ID));
  if (!snap.exists()) return DEFAULT_LUMP_SUM_WORKER_LABOR_CONTEXT;
  const rec = { id: snap.id, ...(snap.data() as Omit<PayrollPolicyRecord, 'id'>) };
  return lumpSumLaborContextFromPolicy(rec);
}

export async function fetchLumpSumWithholdingRatePercentFromFirestore(db: Firestore): Promise<number> {
  const snap = await getDoc(doc(db, 'payroll_policies', HR_LUMP_SUM_WORKER_LABOR_POLICY_ID));
  if (!snap.exists()) return DEFAULT_LUMP_SUM_WHT_RATE_PERCENT;
  const rec = { id: snap.id, ...(snap.data() as Omit<PayrollPolicyRecord, 'id'>) };
  return lumpSumWithholdingRatePercentFromPolicy(rec);
}

/** ใช้ตอน generate/recalc — ถ้าไม่โหลด policy เหมาได้ ให้ใช้ตัวคูณบริษัท (ไม่ทำให้ generate พัง) */
export function companyLaborOrDefault(ctx: WorkerGlobalLaborContext | null | undefined): WorkerGlobalLaborContext {
  return ctx ?? DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT;
}
