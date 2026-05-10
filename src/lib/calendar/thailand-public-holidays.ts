/**
 * Fixed / commonly observed Thai public holidays (Gregorian).
 * Lunar holidays may shift — extend {@link FIXED_BY_YEAR} per Cabinet announcements.
 */

import { isBangkokWeekendYmd } from '@/lib/attendance/bangkok-calendar';

const FIXED_BY_YEAR: Record<number, string[]> = {
  2025: [
    '2025-01-01',
    '2025-04-13',
    '2025-04-14',
    '2025-04-15',
    '2025-05-01',
    '2025-05-05',
    '2025-06-03',
    '2025-07-28',
    '2025-08-12',
    '2025-10-13',
    '2025-12-05',
    '2025-12-10',
    '2025-12-31',
  ],
  2026: [
    '2026-01-01',
    '2026-03-03',
    '2026-04-06',
    '2026-04-13',
    '2026-04-14',
    '2026-04-15',
    '2026-05-01',
    '2026-05-04',
    '2026-05-15',
    '2026-06-03',
    '2026-07-28',
    '2026-08-12',
    '2026-10-13',
    '2026-12-05',
    '2026-12-07',
    '2026-12-10',
    '2026-12-31',
  ],
  2027: [
    '2027-01-01',
    '2027-02-24',
    '2027-04-06',
    '2027-04-13',
    '2027-04-14',
    '2027-04-15',
    '2027-05-01',
    '2027-05-05',
    '2027-05-24',
    '2027-06-03',
    '2027-07-28',
    '2027-08-12',
    '2027-10-13',
    '2027-12-05',
    '2027-12-06',
    '2027-12-10',
    '2027-12-31',
  ],
};

export function isThaiPublicHolidayYmd(ymd: string): boolean {
  const y = Number(ymd.slice(0, 4));
  const list = FIXED_BY_YEAR[y];
  if (!list) return false;
  return list.includes(ymd);
}

/** Mon–Fri excluding weekends and listed public holidays */
export function countBangkokWorkingDaysInMonth(ymDs: string[]): number {
  let n = 0;
  for (const ymd of ymDs) {
    if (isBangkokWeekendYmd(ymd)) continue;
    if (isThaiPublicHolidayYmd(ymd)) continue;
    n++;
  }
  return n;
}
