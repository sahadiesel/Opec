import type { DailyTimesheet } from '@/lib/types';

/** อัตรา OT ที่ผูกชั่วโมงลงใบงาน / แก้ไขย้อนหลัง — ดึงราคาจากสัญญาตอนออกใบแจ้งหนี้และ payroll */
export type TimesheetOtTier = 'ot15' | 'ot20' | 'ot30';

export const TIMESHEET_OT_TIER_OPTIONS: ReadonlyArray<{ value: TimesheetOtTier; label: string }> = [
  { value: 'ot15', label: 'OT1.5' },
  { value: 'ot20', label: 'OT2' },
  { value: 'ot30', label: 'OT3' },
];

export function parseTimesheetOtTier(value: string | null | undefined): TimesheetOtTier {
  if (value === 'ot20' || value === 'ot30') return value;
  return 'ot15';
}

export function timesheetOtTierLabel(tier: TimesheetOtTier): string {
  return TIMESHEET_OT_TIER_OPTIONS.find((o) => o.value === tier)?.label ?? 'OT1.5';
}

export function totalTimesheetOtHours(
  ts: Pick<DailyTimesheet, 'ot15Hours' | 'ot20Hours' | 'ot30Hours'> | undefined,
): number {
  if (!ts) return 0;
  return (
    Math.max(0, Number(ts.ot15Hours) || 0) +
    Math.max(0, Number(ts.ot20Hours) || 0) +
    Math.max(0, Number(ts.ot30Hours) || 0)
  );
}

export function inferTimesheetOtTier(
  buckets: { ot15?: number; ot20?: number; ot30?: number } | undefined,
): TimesheetOtTier {
  const o15 = Math.max(0, Number(buckets?.ot15) || 0);
  const o20 = Math.max(0, Number(buckets?.ot20) || 0);
  const o30 = Math.max(0, Number(buckets?.ot30) || 0);
  if (o30 >= o20 && o30 >= o15 && o30 > 0) return 'ot30';
  if (o20 >= o15 && o20 > 0) return 'ot20';
  return 'ot15';
}

export function inferTimesheetOtTierFromTimesheet(
  ts: Pick<DailyTimesheet, 'ot15Hours' | 'ot20Hours' | 'ot30Hours'> | undefined,
): TimesheetOtTier {
  return inferTimesheetOtTier({
    ot15: ts?.ot15Hours,
    ot20: ts?.ot20Hours,
    ot30: ts?.ot30Hours,
  });
}

export function inferTimesheetOtTierFromRetroRows(
  rows: readonly {
    addedOt15Hours?: number;
    addedOt20Hours?: number;
    addedOt30Hours?: number;
    status?: string;
  }[],
  status?: 'approved' | 'applied',
): TimesheetOtTier | null {
  const list = rows.filter((r) => (status ? r.status === status : r.status !== 'void'));
  const o15 = list.reduce((s, r) => s + Math.max(0, Number(r.addedOt15Hours) || 0), 0);
  const o20 = list.reduce((s, r) => s + Math.max(0, Number(r.addedOt20Hours) || 0), 0);
  const o30 = list.reduce((s, r) => s + Math.max(0, Number(r.addedOt30Hours) || 0), 0);
  if (o15 + o20 + o30 <= 0) return null;
  return inferTimesheetOtTier({ ot15: o15, ot20: o20, ot30: o30 });
}

export function resolveOtTierForRetroForm(
  ts: Pick<DailyTimesheet, 'ot15Hours' | 'ot20Hours' | 'ot30Hours'> | undefined,
  retroRows: readonly {
    addedOt15Hours?: number;
    addedOt20Hours?: number;
    addedOt30Hours?: number;
    status?: string;
  }[],
): TimesheetOtTier {
  const fromApproved = inferTimesheetOtTierFromRetroRows(retroRows, 'approved');
  if (fromApproved) return fromApproved;
  if (totalTimesheetOtHours(ts) > 0) return inferTimesheetOtTierFromTimesheet(ts);
  return inferTimesheetOtTierFromRetroRows(retroRows, 'applied') ?? 'ot15';
}

export function timesheetOtHoursPayload(
  tier: TimesheetOtTier,
  hours: number,
): { ot15Hours: number; ot20Hours: number; ot30Hours: number } {
  const h = Math.max(0, Math.min(24, Number(hours) || 0));
  return {
    ot15Hours: tier === 'ot15' ? h : 0,
    ot20Hours: tier === 'ot20' ? h : 0,
    ot30Hours: tier === 'ot30' ? h : 0,
  };
}

export function retroOtHoursDeltaPayload(
  tier: TimesheetOtTier,
  hours: number,
): {
  addedOt15Hours?: number;
  addedOt20Hours?: number;
  addedOt30Hours?: number;
} {
  const h = Math.max(0, Number(hours) || 0);
  if (h <= 0) return {};
  if (tier === 'ot20') return { addedOt20Hours: h };
  if (tier === 'ot30') return { addedOt30Hours: h };
  return { addedOt15Hours: h };
}

export function formatTimesheetOtHoursHint(
  ts: Pick<DailyTimesheet, 'ot15Hours' | 'ot20Hours' | 'ot30Hours'> | undefined,
): string {
  const o15 = Math.max(0, Number(ts?.ot15Hours) || 0);
  const o20 = Math.max(0, Number(ts?.ot20Hours) || 0);
  const o30 = Math.max(0, Number(ts?.ot30Hours) || 0);
  const parts: string[] = [];
  if (o15 > 0) parts.push(`OT1.5 ${o15} ชม.`);
  if (o20 > 0) parts.push(`OT2 ${o20} ชม.`);
  if (o30 > 0) parts.push(`OT3 ${o30} ชม.`);
  return parts.length ? parts.join(' · ') : 'OT 0 ชม.';
}
