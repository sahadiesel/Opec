/**
 * Structured extras for position rates on main contracts (OT policy, weekly rest, calendar holidays).
 * Legacy `sellSpecialDays` / `costSpecialDays` string[] remain populated for backward compatibility.
 */

export type WeeklyRestPattern = 'none' | 'sat_sun' | 'sunday_only';

export type OvertimeRuleKey = 'NONE' | 'MULT_1_0' | 'MULT_1_5' | 'MULT_2_0';

export interface CalendarHolidayEntry {
  /** YYYY-MM-DD (local / contract calendar day) */
  date: string;
  label: string;
}

const WEEKLY_PREFIX = 'WEEKLY_REST:';
const CAL_PREFIX = 'CAL_DATE:';

export const OVERTIME_RULE_OPTIONS: { key: OvertimeRuleKey; label: string; description: string }[] = [
  {
    key: 'NONE',
    label: 'ไม่มีนโยบาย OT',
    description: 'ไม่คิด OT ใน payroll (ลูกค้าไม่จ่าย OT)',
  },
  {
    key: 'MULT_1_0',
    label: 'x1.0',
    description: 'เท่าของค่าแรงหารชั่วโมงทำงานปกติ (8/12 ชม.)',
  },
  {
    key: 'MULT_1_5',
    label: 'x1.5',
    description: '1.5 เท่าของอัตราชั่วโมง',
  },
  {
    key: 'MULT_2_0',
    label: 'x2.0',
    description: '2 เท่าของอัตราชั่วโมง',
  },
];

export function getOvertimeRuleLabel(key: OvertimeRuleKey): string {
  const o = OVERTIME_RULE_OPTIONS.find((x) => x.key === key);
  return o ? `${o.label} — ${o.description}` : key;
}

/** Snapshot string for PO line / display */
export function overtimeRuleKeyToSnapshotLabel(key: OvertimeRuleKey): string {
  switch (key) {
    case 'NONE':
      return 'NO_OT_POLICY';
    case 'MULT_1_0':
      return 'OT_1_0X_HOURLY';
    case 'MULT_1_5':
      return 'OT_1_5X_HOURLY';
    case 'MULT_2_0':
      return 'OT_2_0X_HOURLY';
    default:
      return 'OT_1_5X_HOURLY';
  }
}

export function parseOvertimeRuleKeyFromSnapshot(s: string | undefined | null): OvertimeRuleKey {
  const x = String(s || '').trim();
  if (x === 'NO_OT_POLICY' || /ไม่มีนโยบาย|ไม่คิด\s*OT/i.test(x)) return 'NONE';
  if (x === 'OT_1_0X_HOURLY' || /1\.0|x1\.0|1_0/i.test(x)) return 'MULT_1_0';
  if (x === 'OT_2_0X_HOURLY' || /2\.0|x2\.0|2_0/i.test(x)) return 'MULT_2_0';
  if (x === 'OT_1_5X_HOURLY' || /1\.5|x1\.5|1_5/i.test(x)) return 'MULT_1_5';
  return 'MULT_1_5';
}

export function buildSpecialDaysStrings(
  weekly: WeeklyRestPattern,
  holidays: CalendarHolidayEntry[],
): string[] {
  const out: string[] = [`${WEEKLY_PREFIX}${weekly}`];
  for (const h of holidays) {
    const d = (h.date || '').trim();
    const lab = (h.label || '').trim();
    if (d && lab) out.push(`${CAL_PREFIX}${d}|${lab}`);
  }
  return out;
}

export function parseSpecialDaysStrings(lines: string[] | undefined | null): {
  weekly: WeeklyRestPattern;
  holidays: CalendarHolidayEntry[];
} {
  let weekly: WeeklyRestPattern = 'none';
  const holidays: CalendarHolidayEntry[] = [];
  for (const raw of lines || []) {
    const s = String(raw).trim();
    if (s.startsWith(WEEKLY_PREFIX)) {
      const v = s.slice(WEEKLY_PREFIX.length) as WeeklyRestPattern;
      if (v === 'sat_sun' || v === 'sunday_only' || v === 'none') weekly = v;
      continue;
    }
    if (s.startsWith(CAL_PREFIX)) {
      const rest = s.slice(CAL_PREFIX.length);
      const pipe = rest.indexOf('|');
      if (pipe > 0) {
        holidays.push({ date: rest.slice(0, pipe).trim(), label: rest.slice(pipe + 1).trim() });
      }
      continue;
    }
    if (s) holidays.push({ date: '', label: s });
  }
  return { weekly, holidays };
}

/** Prefer structured Firestore fields; fall back to legacy `sellSpecialDays` lines. */
export function resolveSellScheduleFromRate(rate: {
  sellWeeklyRestPattern?: WeeklyRestPattern;
  sellCalendarHolidays?: CalendarHolidayEntry[];
  sellSpecialDays?: string[];
}): { weekly: WeeklyRestPattern; holidays: CalendarHolidayEntry[] } {
  const parsed = parseSpecialDaysStrings(rate.sellSpecialDays);
  const weekly = rate.sellWeeklyRestPattern ?? parsed.weekly;
  const holidays =
    rate.sellCalendarHolidays && rate.sellCalendarHolidays.length > 0
      ? rate.sellCalendarHolidays
      : parsed.holidays.filter((h) => h.date);
  return { weekly, holidays };
}

/** Prefer structured fields; fall back to legacy `costSpecialDays`. */
export function resolveCostScheduleFromRate(rate: {
  costWeeklyRestPattern?: WeeklyRestPattern;
  costCalendarHolidays?: CalendarHolidayEntry[];
  costSpecialDays?: string[];
}): { weekly: WeeklyRestPattern; holidays: CalendarHolidayEntry[] } {
  const parsed = parseSpecialDaysStrings(rate.costSpecialDays);
  const weekly = rate.costWeeklyRestPattern ?? parsed.weekly;
  const holidays =
    rate.costCalendarHolidays && rate.costCalendarHolidays.length > 0
      ? rate.costCalendarHolidays
      : parsed.holidays.filter((h) => h.date);
  return { weekly, holidays };
}

/** Contract-level holiday schedule (shared by all position rates). */
export function resolveContractHolidaySchedule(contract: {
  contractSellWeeklyRestPattern?: WeeklyRestPattern;
  contractSellCalendarHolidays?: CalendarHolidayEntry[];
  contractSellSpecialDays?: string[];
  contractCostWeeklyRestPattern?: WeeklyRestPattern;
  contractCostCalendarHolidays?: CalendarHolidayEntry[];
  contractCostSpecialDays?: string[];
}): {
  sellWeekly: WeeklyRestPattern;
  sellHolidays: CalendarHolidayEntry[];
  costWeekly: WeeklyRestPattern;
  costHolidays: CalendarHolidayEntry[];
} {
  const sellParsed = parseSpecialDaysStrings(contract.contractSellSpecialDays);
  const costParsed = parseSpecialDaysStrings(contract.contractCostSpecialDays);
  const sellWeekly = contract.contractSellWeeklyRestPattern ?? sellParsed.weekly;
  const costWeekly = contract.contractCostWeeklyRestPattern ?? costParsed.weekly;
  const sellHolidays =
    contract.contractSellCalendarHolidays && contract.contractSellCalendarHolidays.length > 0
      ? contract.contractSellCalendarHolidays
      : sellParsed.holidays.filter((h) => h.date);
  const costHolidays =
    contract.contractCostCalendarHolidays && contract.contractCostCalendarHolidays.length > 0
      ? contract.contractCostCalendarHolidays
      : costParsed.holidays.filter((h) => h.date);
  return { sellWeekly, sellHolidays, costWeekly, costHolidays };
}

export const WEEKLY_REST_OPTIONS: { value: WeeklyRestPattern; label: string }[] = [
  { value: 'none', label: 'ไม่มีวันหยุดประจำ (ยกเว้นวันที่เพิ่มเองด้านล่าง)' },
  { value: 'sat_sun', label: 'หยุดเสาร์–อาทิตย์' },
  { value: 'sunday_only', label: 'หยุดทุกวันอาทิตย์' },
];
