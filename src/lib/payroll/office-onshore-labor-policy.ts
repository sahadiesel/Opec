/**
 * ปฏิทินวันหยุดร่วมพนักงานออฟฟิศ + ลูกจ้างบริษัท Onshore
 * ตัวคูณแยก: ออฟฟิศ (A/B/C) vs ลูกจ้าง Onshore (OT/วันหยุด/SB)
 */
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import type { PayrollPolicyRecord } from '@/lib/types';
import type { CalendarHolidayEntry, WeeklyRestPattern } from '@/lib/contract-position-rate-extras';
import { HR_OFFICE_ONSHORE_LABOR_POLICY_ID, HR_WORKER_GLOBAL_LABOR_POLICY_ID } from '@/lib/payroll/d8/hr-statutory-policy-ids';
import { DEFAULT_MONTHLY_WORK_NORM, type MonthlyWorkNormPolicyConfig } from '@/lib/hr/monthly-work-norm-policy';
import {
  DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT,
  type WorkerGlobalLaborContext,
  type WorkerGlobalLaborCostMultipliers,
  workerGlobalLaborContextFromPolicy,
} from '@/lib/payroll/worker-global-labor-policy';
import { coerceToGregorianYmd } from '@/lib/date-thai';

export type OfficeHolidayMultipliers = {
  holidayNormal: number;
  weekdayOt: number;
  holidayOt: number;
};

export type OfficeOnshoreLaborContext = {
  weeklyRestPattern: WeeklyRestPattern;
  calendarHolidays: CalendarHolidayEntry[];
  office: OfficeHolidayMultipliers;
  workerCost: WorkerGlobalLaborCostMultipliers;
};

export const DEFAULT_OFFICE_ONSHORE_LABOR_CONTEXT: OfficeOnshoreLaborContext = {
  weeklyRestPattern: DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT.weeklyRestPattern,
  calendarHolidays: [],
  office: {
    holidayNormal: DEFAULT_MONTHLY_WORK_NORM.officeHolidayNormalWorkMultiplier ?? 1,
    weekdayOt: DEFAULT_MONTHLY_WORK_NORM.officeWeekdayOvertimeMultiplier ?? 1.5,
    holidayOt: DEFAULT_MONTHLY_WORK_NORM.officeHolidayOvertimeMultiplier ?? 1.5,
  },
  workerCost: { ...DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT.cost },
};

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function holidayDateToYmd(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return coerceToGregorianYmd(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  if (typeof raw === 'object') {
    const o = raw as { toDate?: () => Date; date?: unknown; seconds?: unknown };
    if (typeof o.toDate === 'function') {
      try {
        return holidayDateToYmd(o.toDate().getTime());
      } catch {
        /* ignore */
      }
    }
    if (typeof o.seconds === 'number') return holidayDateToYmd(o.seconds * 1000);
    if (o.date != null) return holidayDateToYmd(o.date);
  }
  return coerceToGregorianYmd(String(raw));
}

function readHolidays(cfg: Record<string, unknown>): CalendarHolidayEntry[] {
  const raw = cfg.calendarHolidays;
  if (!Array.isArray(raw)) return [];
  const out: CalendarHolidayEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const date = holidayDateToYmd(r.date);
    const label = String(r.label || '').trim();
    if (!date || !label) continue;
    out.push({ date, label });
  }
  return out;
}

function readWeekly(cfg: Record<string, unknown>): WeeklyRestPattern {
  const v = cfg.weeklyRestPattern;
  if (v === 'none' || v === 'sat_sun' || v === 'sunday_only') return v;
  return DEFAULT_OFFICE_ONSHORE_LABOR_CONTEXT.weeklyRestPattern;
}

function readWorkerCost(cfg: Record<string, unknown>): WorkerGlobalLaborCostMultipliers {
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

export function officeOnshoreLaborContextFromPolicy(
  rec: PayrollPolicyRecord | null | undefined,
): OfficeOnshoreLaborContext {
  if (!rec || rec.status !== 'active') return { ...DEFAULT_OFFICE_ONSHORE_LABOR_CONTEXT, workerCost: { ...DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT.cost } };
  if (rec.kind !== 'office_onshore_labor' && rec.id !== HR_OFFICE_ONSHORE_LABOR_POLICY_ID) {
    return { ...DEFAULT_OFFICE_ONSHORE_LABOR_CONTEXT, workerCost: { ...DEFAULT_WORKER_GLOBAL_LABOR_CONTEXT.cost } };
  }
  const cfg = rec.config && typeof rec.config === 'object' ? (rec.config as Record<string, unknown>) : {};
  const om = cfg.officeMultipliers && typeof cfg.officeMultipliers === 'object'
    ? (cfg.officeMultipliers as Record<string, unknown>)
    : {};
  const d = DEFAULT_OFFICE_ONSHORE_LABOR_CONTEXT.office;
  return {
    weeklyRestPattern: readWeekly(cfg),
    calendarHolidays: readHolidays(cfg),
    office: {
      holidayNormal: num(om.holidayNormal, d.holidayNormal),
      weekdayOt: num(om.weekdayOt, d.weekdayOt),
      holidayOt: num(om.holidayOt, d.holidayOt),
    },
    workerCost: readWorkerCost(cfg),
  };
}

export function onshoreWorkerLaborContextFromOfficeOnshore(
  ctx: OfficeOnshoreLaborContext,
): WorkerGlobalLaborContext {
  return {
    cost: { ...ctx.workerCost },
    weeklyRestPattern: ctx.weeklyRestPattern,
    calendarHolidays: ctx.calendarHolidays,
  };
}

export function overlayOfficeMultipliersOnMonthlyWorkNorm(
  norm: MonthlyWorkNormPolicyConfig,
  office: OfficeHolidayMultipliers,
): MonthlyWorkNormPolicyConfig {
  return {
    ...norm,
    officeHolidayNormalWorkMultiplier: office.holidayNormal,
    officeWeekdayOvertimeMultiplier: office.weekdayOt,
    officeHolidayOvertimeMultiplier: office.holidayOt,
    officeOvertimeHourMultiplier: office.weekdayOt,
    officeHolidayHourMultiplier: office.holidayNormal,
  };
}

/** ปฏิทินออฟฟิศ/ออนชอร์ — ถ้ายังไม่มีเอกสารใหม่ ให้ใช้ปฏิทินลูกจ้างบริษัทชุดเดิมชั่วคราว */
export function resolveOfficeOnshoreRestFromPolicies(
  officeOnshoreRec: PayrollPolicyRecord | null | undefined,
  workerGlobalRec?: PayrollPolicyRecord | null,
): Pick<OfficeOnshoreLaborContext, 'weeklyRestPattern' | 'calendarHolidays'> {
  if (officeOnshoreRec && (officeOnshoreRec.kind === 'office_onshore_labor' || officeOnshoreRec.id === HR_OFFICE_ONSHORE_LABOR_POLICY_ID) && officeOnshoreRec.status === 'active') {
    const ctx = officeOnshoreLaborContextFromPolicy(officeOnshoreRec);
    return { weeklyRestPattern: ctx.weeklyRestPattern, calendarHolidays: ctx.calendarHolidays };
  }
  const fallback = workerGlobalLaborContextFromPolicy(workerGlobalRec ?? null);
  return {
    weeklyRestPattern: fallback.weeklyRestPattern,
    calendarHolidays: fallback.calendarHolidays,
  };
}

export async function fetchOfficeOnshoreLaborContextFromFirestore(
  db: Firestore,
): Promise<OfficeOnshoreLaborContext> {
  const snap = await getDoc(doc(db, 'payroll_policies', HR_OFFICE_ONSHORE_LABOR_POLICY_ID));
  if (snap.exists()) {
    const rec = { id: snap.id, ...(snap.data() as Omit<PayrollPolicyRecord, 'id'>) };
    return officeOnshoreLaborContextFromPolicy(rec);
  }
  const wl = await getDoc(doc(db, 'payroll_policies', HR_WORKER_GLOBAL_LABOR_POLICY_ID));
  const wlRec = wl.exists()
    ? ({ id: wl.id, ...(wl.data() as Omit<PayrollPolicyRecord, 'id'>) } as PayrollPolicyRecord)
    : null;
  const seeded = workerGlobalLaborContextFromPolicy(wlRec);
  return {
    ...DEFAULT_OFFICE_ONSHORE_LABOR_CONTEXT,
    weeklyRestPattern: seeded.weeklyRestPattern,
    calendarHolidays: seeded.calendarHolidays,
    workerCost: { ...seeded.cost },
  };
}
