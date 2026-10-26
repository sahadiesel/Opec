/** Diff + persist ประวัติแก้ไขหน้าตั้งค่า HR (ผู้แก้ + ฟิลด์ที่เปลี่ยน) */

import { addDoc, collection, type Firestore } from 'firebase/firestore';
import { HR_CONFIGURATION_COLLECTION } from '@/lib/attendance/constants';
import type { OfficeLeaveEntitlementsDoc } from '@/lib/attendance/types';
import { WEEKLY_REST_OPTIONS } from '@/lib/contract-position-rate-extras';
import {
  DEFAULT_MONTHLY_WORK_NORM,
  monthlyWorkNormFromUnknownConfig,
  type MonthlyWorkNormPolicyConfig,
} from '@/lib/hr/monthly-work-norm-policy';
import { writeAuditLog } from '@/lib/services/audit-service';
import type { PayrollPolicyRecord, User } from '@/lib/types';
import {
  workerGlobalLaborContextFromPolicy,
  type WorkerGlobalLaborContext,
} from '@/lib/payroll/worker-global-labor-policy';
import { cloneDefaultPitBands, type PitProgressiveBand } from '@/lib/hr/pit-thailand';
import { DEFAULT_ANNUAL_PERSONAL_ALLOWANCE } from '@/lib/payroll/employee-payroll-deductions';
import {
  DEFAULT_EMPLOYEE_ASSISTANCE_FUND_MONTHLY_CEILING_BAHT,
  DEFAULT_EMPLOYEE_ASSISTANCE_FUND_RATE_PERCENT,
} from '@/lib/payroll/employee-assistance-fund';

export const HR_SETTINGS_CHANGE_LOG_KIND = 'hr_settings_change_log';

export type HrSettingsChangeLogDoc = {
  id?: string;
  kind: typeof HR_SETTINGS_CHANGE_LOG_KIND;
  actorUserId: string;
  actorName: string;
  actorRole: string;
  eventAt: number;
  changedFields: string[];
  lines: string[];
  beforeSummary: string;
  afterSummary: string;
};

export type HrSettingsSnapshotValues = {
  ssoRate: number;
  ssoCeiling: number;
  assistanceFundRate: number;
  assistanceFundCeiling: number;
  annualAllowance: number;
  pitBands: PitProgressiveBand[];
  monthlyWork: MonthlyWorkNormPolicyConfig;
  leavePersonal: number;
  leaveSick: number;
  leaveAnnual: number;
  workerLabor: WorkerGlobalLaborContext;
};

export type HrSettingsFieldChange = {
  key: string;
  label: string;
  before: string;
  after: string;
};

const LABELS: Record<string, string> = {
  ssoRate: 'อัตราประกันสังคมลูกจ้าง (%)',
  ssoCeiling: 'เพดานค่าจ้าง ปสง. (บาท/เดือน)',
  assistanceFundRate: 'อัตรากองทุนสงเคราะห์ (%)',
  assistanceFundCeiling: 'เพดานกองทุนสงเคราะห์ (บาท/เดือน)',
  annualAllowance: 'ลดหย่อนรายปี (บาท)',
  pitBands: 'ขั้นบันไดภาษี',
  workDaysPerMonth: 'วันทำงานมาตรฐานต่อเดือน',
  normalWorkHoursPerDay: 'ชั่วโมงทำงานปกติต่อวัน',
  breakHoursPerDay: 'ชั่วโมงพักต่อวัน',
  workStartTime: 'เวลาเริ่มงาน',
  breakStartTime: 'เวลาเริ่มพัก',
  lateGraceMinutes: 'นาทีผ่อนผันสาย',
  latePenaltyBands: 'ช่วงหักสาย',
  officeHolidayNormalWorkMultiplier: 'ตัวคูณทำงานวันหยุด (ออฟฟิศ)',
  officeWeekdayOvertimeMultiplier: 'ตัวคูณ OT วันทำงาน (ออฟฟิศ)',
  officeHolidayOvertimeMultiplier: 'ตัวคูณ OT วันหยุด (ออฟฟิศ)',
  leavePersonal: 'โควตาลากิจ (วัน/ปี)',
  leaveSick: 'โควตาลาป่วย (วัน/ปี)',
  leaveAnnual: 'โควตาลาพักร้อน (วัน/ปี)',
  weeklyRestPattern: 'วันหยุดประจำสัปดาห์ (ลูกจ้าง)',
  calendarHolidays: 'วันหยุดในปฏิทิน (ลูกจ้าง)',
  cost_otAfterShift: 'ตัวคูณ OT หลังกะ (ลูกจ้าง)',
  cost_holiday: 'ตัวคูณวันหยุด (ลูกจ้าง)',
  cost_publicHoliday: 'ตัวคูณนักขัตฤกษ์ (ลูกจ้าง)',
  cost_sunday: 'ตัวคูณวันอาทิตย์ (ลูกจ้าง)',
  cost_sundayOt: 'ตัวคูณ OT วันอาทิตย์ (ลูกจ้าง)',
  cost_standby: 'ตัวคูณ Standby (ลูกจ้าง)',
  cost_mobilization: 'ตัวคูณ Mob (ลูกจ้าง)',
  cost_demobilization: 'ตัวคูณ Demob (ลูกจ้าง)',
  cost_travel: 'ตัวคูณ Travel (ลูกจ้าง)',
};

function weeklyRestLabel(v: string): string {
  return WEEKLY_REST_OPTIONS.find((o) => o.value === v)?.label || v;
}

function fmtNum(n: number): string {
  return Number.isFinite(n) ? String(n) : '';
}

function fmtBands(bands: PitProgressiveBand[]): string {
  return bands
    .map((b) => `${b.fromBaht}-${b.toBaht ?? '∞'}@${b.ratePercent}%`)
    .join(', ');
}

function fmtLateBands(bands: MonthlyWorkNormPolicyConfig['latePenaltyBands']): string {
  if (!bands?.length) return '(หักตามนาทีจริง)';
  return bands
    .map((b) => `${b.fromAfterStartMinutes}-${b.toAfterStartMinutes}น. หัก ${b.deductMinutes}`)
    .join(', ');
}

function fmtHolidays(ctx: WorkerGlobalLaborContext): string {
  if (!ctx.calendarHolidays.length) return '(ไม่มี)';
  return [...ctx.calendarHolidays]
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))
    .map((h) => `${h.date} ${h.label}`.trim())
    .join('; ');
}

export function flattenHrSettingsSnapshot(v: HrSettingsSnapshotValues): Record<string, string> {
  const mw = v.monthlyWork;
  const c = v.workerLabor.cost;
  return {
    ssoRate: fmtNum(v.ssoRate),
    ssoCeiling: fmtNum(v.ssoCeiling),
    assistanceFundRate: fmtNum(v.assistanceFundRate),
    assistanceFundCeiling: fmtNum(v.assistanceFundCeiling),
    annualAllowance: fmtNum(v.annualAllowance),
    pitBands: fmtBands(v.pitBands),
    workDaysPerMonth: fmtNum(mw.standardWorkingDaysPerMonth),
    normalWorkHoursPerDay: fmtNum(mw.normalWorkingHoursPerDay),
    breakHoursPerDay: fmtNum(mw.breakHoursPerDay),
    workStartTime: mw.workStartTime || '',
    breakStartTime: mw.breakStartTime || '',
    lateGraceMinutes: fmtNum(mw.lateGraceMinutes ?? 0),
    latePenaltyBands: fmtLateBands(mw.latePenaltyBands),
    officeHolidayNormalWorkMultiplier: fmtNum(mw.officeHolidayNormalWorkMultiplier ?? 1),
    officeWeekdayOvertimeMultiplier: fmtNum(mw.officeWeekdayOvertimeMultiplier ?? 1.5),
    officeHolidayOvertimeMultiplier: fmtNum(mw.officeHolidayOvertimeMultiplier ?? 1.5),
    leavePersonal: fmtNum(v.leavePersonal),
    leaveSick: fmtNum(v.leaveSick),
    leaveAnnual: fmtNum(v.leaveAnnual),
    weeklyRestPattern: weeklyRestLabel(v.workerLabor.weeklyRestPattern),
    calendarHolidays: fmtHolidays(v.workerLabor),
    cost_otAfterShift: fmtNum(c.otAfterShift),
    cost_holiday: fmtNum(c.holiday),
    cost_publicHoliday: fmtNum(c.publicHoliday),
    cost_sunday: fmtNum(c.sunday),
    cost_sundayOt: fmtNum(c.sundayOt),
    cost_standby: fmtNum(c.standby),
    cost_mobilization: fmtNum(c.mobilization),
    cost_demobilization: fmtNum(c.demobilization),
    cost_travel: fmtNum(c.travel),
  };
}

export function diffHrSettingsSnapshots(
  before: Record<string, string>,
  after: Record<string, string>,
): HrSettingsFieldChange[] {
  const keys = Object.keys(LABELS);
  const out: HrSettingsFieldChange[] = [];
  for (const key of keys) {
    const b = before[key] ?? '';
    const a = after[key] ?? '';
    if (b === a) continue;
    out.push({ key, label: LABELS[key] || key, before: b, after: a });
  }
  return out;
}

export function hrSettingsSnapshotFromStored(input: {
  ssoConfig?: Record<string, unknown> | null;
  taxConfig?: Record<string, unknown> | null;
  monthlyWorkConfig?: Record<string, unknown> | null;
  workerLaborPolicy?: PayrollPolicyRecord | null;
  leave?: Partial<OfficeLeaveEntitlementsDoc> | null;
}): HrSettingsSnapshotValues {
  const sso = input.ssoConfig || {};
  const tax = input.taxConfig || {};
  const leave = input.leave || {};
  const rawBands = tax.pitProgressiveBands;
  const pitBands = Array.isArray(rawBands) && rawBands.length > 0
    ? (rawBands as PitProgressiveBand[])
    : cloneDefaultPitBands();
  return {
    ssoRate: Number(sso.employeeRatePercent ?? 5),
    ssoCeiling: Number(sso.monthlyCeilingBaht ?? 15_000),
    assistanceFundRate: Number(sso.employeeAssistanceFundRatePercent ?? DEFAULT_EMPLOYEE_ASSISTANCE_FUND_RATE_PERCENT),
    assistanceFundCeiling: Number(
      sso.employeeAssistanceFundMonthlyCeilingBaht ?? DEFAULT_EMPLOYEE_ASSISTANCE_FUND_MONTHLY_CEILING_BAHT,
    ),
    annualAllowance: Number(tax.annualPersonalAllowance ?? DEFAULT_ANNUAL_PERSONAL_ALLOWANCE),
    pitBands,
    monthlyWork: input.monthlyWorkConfig
      ? monthlyWorkNormFromUnknownConfig(input.monthlyWorkConfig)
      : { ...DEFAULT_MONTHLY_WORK_NORM },
    leavePersonal: Number(leave.personalDaysPerYear ?? 0),
    leaveSick: Number(leave.sickDaysPerYear ?? 0),
    leaveAnnual: Number(leave.annualVacationDaysPerYear ?? 0),
    workerLabor: workerGlobalLaborContextFromPolicy(input.workerLaborPolicy),
  };
}

function asConfig(data: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const cfg = data?.config;
  return cfg && typeof cfg === 'object' ? (cfg as Record<string, unknown>) : null;
}

export function hrSettingsSnapshotFromPolicyDocs(input: {
  ssoData?: Record<string, unknown> | null;
  taxData?: Record<string, unknown> | null;
  monthlyWorkData?: Record<string, unknown> | null;
  workerLaborData?: Record<string, unknown> | null;
  leaveData?: Record<string, unknown> | null;
}): HrSettingsSnapshotValues {
  const wlRaw = input.workerLaborData;
  const workerLaborPolicy =
    wlRaw && typeof wlRaw === 'object'
      ? ({ id: 'policy_worker_global_labor', ...(wlRaw as object) } as PayrollPolicyRecord)
      : null;
  return hrSettingsSnapshotFromStored({
    ssoConfig: asConfig(input.ssoData || undefined),
    taxConfig: asConfig(input.taxData || undefined),
    monthlyWorkConfig: asConfig(input.monthlyWorkData || undefined),
    workerLaborPolicy,
    leave: input.leaveData as Partial<OfficeLeaveEntitlementsDoc> | null,
  });
}

export function formatHrSettingsChangeLines(changes: HrSettingsFieldChange[]): string[] {
  return changes.map((c) => `${c.label}: ${c.before || '—'} → ${c.after || '—'}`);
}

export async function persistHrSettingsChangeLog(input: {
  firestore: Firestore;
  user: User;
  changes: HrSettingsFieldChange[];
}): Promise<void> {
  if (input.changes.length === 0) return;
  const lines = formatHrSettingsChangeLines(input.changes);
  const changedFields = input.changes.map((c) => c.label);
  const beforeSummary = input.changes.map((c) => `${c.label}=${c.before || '—'}`).join('\n');
  const afterSummary = lines.join('\n');
  const eventAt = Date.now();
  const actorName = input.user.displayName || input.user.email || input.user.id;
  const actorRole = input.user.assignedRoleKey || input.user.roleId || 'unknown';

  await addDoc(collection(input.firestore, HR_CONFIGURATION_COLLECTION), {
    kind: HR_SETTINGS_CHANGE_LOG_KIND,
    actorUserId: input.user.id,
    actorName,
    actorRole,
    eventAt,
    changedFields,
    lines,
    beforeSummary,
    afterSummary,
  } satisfies Omit<HrSettingsChangeLogDoc, 'id'>);

  await writeAuditLog(input.firestore, input.user, {
    actionType: 'UPDATE',
    entityType: 'HrSettings',
    entityId: 'payroll_settings',
    entityLabel: 'ตั้งค่า HR — ภาษีและประกันสังคม',
    changedFields,
    beforeSummary,
    afterSummary,
    sourceModule: 'hr',
    sourcePath: '/hr/settings',
  });
}
