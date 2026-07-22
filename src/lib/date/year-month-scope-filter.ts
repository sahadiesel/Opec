/** กรองปี + เดือน สำหรับหน้าบัญชี (หัก ณ ที่จ่าย / ปกส. ฯลฯ) */

export const MONTH_SCOPE_LAST_2 = 'LAST_2';
export const MONTH_SCOPE_LAST_3 = 'LAST_3';

export type MonthScopeLookback = typeof MONTH_SCOPE_LAST_2 | typeof MONTH_SCOPE_LAST_3;

/** ค่าช่องเลือกเดือน: LAST_2 | LAST_3 | '01'..'12' */
export type MonthScopeValue = MonthScopeLookback | string;

const TH_MONTH_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

export function isMonthScopeLookback(v: string): v is MonthScopeLookback {
  return v === MONTH_SCOPE_LAST_2 || v === MONTH_SCOPE_LAST_3;
}

export function currentYearCe(asOf: Date = new Date()): number {
  return asOf.getFullYear();
}

/** เดือนปัจจุบันแบบ '01'..'12' */
export function currentMonthMm(asOf: Date = new Date()): string {
  return String(asOf.getMonth() + 1).padStart(2, '0');
}

export function yearCeToBe(yearCe: number): number {
  return yearCe + 543;
}

/** ตัวเลือกเดือน: 2/3 เดือนย้อนหลัง แล้วตามด้วย ม.ค.–ธ.ค. */
export const MONTH_SCOPE_SELECT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: MONTH_SCOPE_LAST_2, label: '2 เดือนย้อนหลัง' },
  { value: MONTH_SCOPE_LAST_3, label: '3 เดือนย้อนหลัง' },
  ...TH_MONTH_SHORT.map((label, i) => ({
    value: String(i + 1).padStart(2, '0'),
    label,
  })),
];

/**
 * ชุด YYYY-MM ที่ตรงกับตัวกรอง
 * - LAST_2 / LAST_3: นับจากวันปัจจุบันรวมเดือนนี้ (เช่น ก.ค. → LAST_2 = มิ.ย.+ก.ค.)
 * - '01'..'12': เดือนนั้นในปีที่เลือก (ค.ศ.)
 */
export function resolveYearMonthScopeSet(
  yearCe: number,
  monthScope: string,
  asOf: Date = new Date(),
): Set<string> {
  if (isMonthScopeLookback(monthScope)) {
    const count = monthScope === MONTH_SCOPE_LAST_2 ? 2 : 3;
    const set = new Set<string>();
    for (let i = 0; i < count; i += 1) {
      const d = new Date(asOf.getFullYear(), asOf.getMonth() - i, 1);
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return set;
  }
  const mm = /^\d{2}$/.test(monthScope) && Number(monthScope) >= 1 && Number(monthScope) <= 12
    ? monthScope
    : currentMonthMm(asOf);
  return new Set([`${yearCe}-${mm}`]);
}

export function ymMatchesYearMonthScope(
  ym: string | null | undefined,
  yearCe: number,
  monthScope: string,
  asOf?: Date,
): boolean {
  if (!ym) return false;
  const key = String(ym).trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(key)) return false;
  return resolveYearMonthScopeSet(yearCe, monthScope, asOf).has(key);
}

/** รายการปี ค.ศ. สำหรับ dropdown — รวมปีปัจจุบันและปีจากข้อมูล */
export function buildYearCeOptions(
  ymKeys: Iterable<string>,
  asOf: Date = new Date(),
): number[] {
  const set = new Set<number>([currentYearCe(asOf)]);
  for (const ym of ymKeys) {
    const y = Number(String(ym).slice(0, 4));
    if (Number.isFinite(y) && y >= 2000 && y <= 2100) set.add(y);
  }
  return Array.from(set).sort((a, b) => b - a);
}

export function describeYearMonthScopeFilter(yearCe: number, monthScope: string): string {
  if (monthScope === MONTH_SCOPE_LAST_2) return '2 เดือนย้อนหลัง (รวมเดือนปัจจุบัน)';
  if (monthScope === MONTH_SCOPE_LAST_3) return '3 เดือนย้อนหลัง (รวมเดือนปัจจุบัน)';
  const mi = Number(monthScope);
  if (Number.isFinite(mi) && mi >= 1 && mi <= 12) {
    return `${TH_MONTH_SHORT[mi - 1]} พ.ศ. ${yearCeToBe(yearCe)}`;
  }
  return `ปี พ.ศ. ${yearCeToBe(yearCe)}`;
}
