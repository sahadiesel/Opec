/**
 * ตัวคูณ + ปฏิทินวันหยุดฝั่งต้นทุนลูกจ้าง — แหล่งความจริงเดียวจาก HR Settings (`payroll_policies/policy_worker_global_labor`)
 */
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import type { PayrollPolicyRecord } from '@/lib/types';
import type { CalendarHolidayEntry, WeeklyRestPattern } from '@/lib/contract-position-rate-extras';
import { HR_WORKER_GLOBAL_LABOR_POLICY_ID } from '@/lib/payroll/d8/hr-statutory-policy-ids';
import type { PayrollRestDaySchedule } from '@/lib/payroll/package-labor-cost';

export type WorkerGlobalLaborCostMultipliers = {
  otAfterShift: number;
  holiday: number;
  publicHoliday: number;
  sunday: number;
  sundayOt: number;
  standby: number;
  mobilization: number;
  demobilization: number;
  travel: number;
};

export type WorkerGlobalLaborContext = {
  cost: WorkerGlobalLaborCostMultipliers;
  weeklyRestPattern: WeeklyRestPattern;
  calendarHolidays: CalendarHolidayEntry[];
};

/** สอดคล้องกับ DEFAULT_REGISTRY_EVENT_MULTIPLIER_POLICY เดิม */
export const DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT: WorkerGlobalLaborContext = {
  cost: {
    otAfterShift: 1.5,
    holiday: 1.5,
    publicHoliday: 1,
    sunday: 1.5,
    sundayOt: 2,
    standby: 0.5,
    mobilization: 1,
    demobilization: 1,
    travel: 1,
  },
  weeklyRestPattern: 'none',
  calendarHolidays: [],
};

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function readCostMult(cfg: Record<string, unknown>): WorkerGlobalLaborCostMultipliers {
  const raw = cfg.costMultipliers;
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT.cost;
  return {
    otAfterShift: num(o.otAfterShift, d.otAfterShift),
    holiday: num(o.holiday, d.holiday),
    publicHoliday: num(o.publicHoliday, d.publicHoliday),
    sunday: num(o.sunday, d.sunday),
    sundayOt: num(o.sundayOt, d.sundayOt),
    standby: num(o.standby, d.standby),
    mobilization: num(o.mobilization, d.mobilization),
    demobilization: num(o.demobilization, d.demobilization),
    travel: num(o.travel, d.travel),
  };
}

function readWeeklyPattern(cfg: Record<string, unknown>): WeeklyRestPattern {
  const v = cfg.weeklyRestPattern;
  if (v === 'none' || v === 'sat_sun' || v === 'sunday_only') return v;
  return DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT.weeklyRestPattern;
}

function readCalendarHolidays(cfg: Record<string, unknown>): CalendarHolidayEntry[] {
  const raw = cfg.calendarHolidays;
  if (!Array.isArray(raw)) return [];
  const out: CalendarHolidayEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const date = String(r.date || '').trim();
    const label = String(r.label || '').trim();
    if (!date || !label) continue;
    out.push({ date, label });
  }
  return out;
}

export function workerGlobalLaborContextFromPolicy(rec: PayrollPolicyRecord | null | undefined): WorkerGlobalLaborContext {
  if (!rec || rec.kind !== 'worker_global_labor' || rec.status !== 'active') {
    return DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT;
  }
  const cfg = rec.config && typeof rec.config === 'object' ? (rec.config as Record<string, unknown>) : {};
  return {
    cost: readCostMult(cfg),
    weeklyRestPattern: readWeeklyPattern(cfg),
    calendarHolidays: readCalendarHolidays(cfg),
  };
}

export function workerGlobalLaborToPayrollRestSchedule(ctx: WorkerGlobalLaborContext): PayrollRestDaySchedule {
  return {
    weeklyRestPattern: ctx.weeklyRestPattern,
    calendarHolidays: ctx.calendarHolidays,
    costMultipliers: {
      publicHoliday: ctx.cost.publicHoliday,
      sunday: ctx.cost.sunday,
      sundayOt: ctx.cost.sundayOt,
    },
  };
}

export async function fetchWorkerGlobalLaborContextFromFirestore(db: Firestore): Promise<WorkerGlobalLaborContext> {
  const snap = await getDoc(doc(db, 'payroll_policies', HR_WORKER_GLOBAL_LABOR_POLICY_ID));
  if (!snap.exists()) return DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT;
  const rec = { id: snap.id, ...(snap.data() as Omit<PayrollPolicyRecord, 'id'>) };
  return workerGlobalLaborContextFromPolicy(rec);
}

export async function fetchWorkerGlobalLaborPolicyRecord(db: Firestore): Promise<PayrollPolicyRecord | null> {
  const snap = await getDoc(doc(db, 'payroll_policies', HR_WORKER_GLOBAL_LABOR_POLICY_ID));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<PayrollPolicyRecord, 'id'>) };
}
