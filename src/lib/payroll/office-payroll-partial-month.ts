import {
  isBangkokWeeklyRestDayYmd,
  type WeeklyRestPatternForCalendar,
} from '@/lib/attendance/bangkok-calendar';
import type { CalendarHolidayEntry } from '@/lib/contract-position-rate-extras';
import { isHrSettingsCalendarHolidayYmd } from '@/lib/payroll/worker-global-labor-policy';
import type { OfficeStaff } from '@/lib/types';

function enumerateYmdsInclusive(startYmd: string, endYmd: string): string[] {
  const a = Date.parse(`${startYmd.slice(0, 10)}T00:00:00+07:00`);
  const b = Date.parse(`${endYmd.slice(0, 10)}T00:00:00+07:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const out: string[] = [];
  for (let t = a; t <= b; t += 86_400_000) {
    out.push(new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }));
  }
  return out;
}

function isScheduledWorkDay(
  ymd: string,
  weeklyRestPattern: WeeklyRestPatternForCalendar,
  calendarHolidays: CalendarHolidayEntry[],
): boolean {
  if (isBangkokWeeklyRestDayYmd(ymd, weeklyRestPattern)) return false;
  if (isHrSettingsCalendarHolidayYmd(ymd, calendarHolidays)) return false;
  return true;
}

/** นับวันทำงานในงวดที่ยังไม่ได้เริ่มจ้าง / หลังสิ้นสุดการจ้าง — ใช้หักเงินเดือนไม่เต็มเดือน */
export function countPartialMonthUnpaidWorkDays(
  periodStart: string,
  periodEnd: string,
  staff: Pick<OfficeStaff, 'startDate' | 'employmentEndDate'>,
  weeklyRestPattern: WeeklyRestPatternForCalendar,
  calendarHolidays: CalendarHolidayEntry[],
): { preEmploymentDays: number; postEmploymentDays: number } {
  const startYmd = staff.startDate?.slice(0, 10);
  const endYmd = staff.employmentEndDate?.slice(0, 10);
  let preEmploymentDays = 0;
  let postEmploymentDays = 0;

  for (const ymd of enumerateYmdsInclusive(periodStart, periodEnd)) {
    if (!isScheduledWorkDay(ymd, weeklyRestPattern, calendarHolidays)) continue;
    if (startYmd && ymd < startYmd) preEmploymentDays += 1;
    else if (endYmd && ymd > endYmd) postEmploymentDays += 1;
  }

  return { preEmploymentDays, postEmploymentDays };
}
