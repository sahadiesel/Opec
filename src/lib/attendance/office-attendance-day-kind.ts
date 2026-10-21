import {
  bangkokIsoWeekdayFromYmd,
  isBangkokWeeklyRestDayYmd,
  type WeeklyRestPatternForCalendar,
} from '@/lib/attendance/bangkok-calendar';
import type { OfficeLeaveRequestDoc } from '@/lib/leaves/types';

export function attendanceDayTypeTags(
  ymd: string,
  weeklyRestPattern: WeeklyRestPatternForCalendar,
  calendarHolidayLabel: string | null,
): string[] {
  const tags: string[] = [];
  if (calendarHolidayLabel) tags.push(calendarHolidayLabel);
  const iso = bangkokIsoWeekdayFromYmd(ymd);
  if (iso === 7 && (weeklyRestPattern === 'sat_sun' || weeklyRestPattern === 'sunday_only')) {
    tags.push('วันอาทิตย์');
  } else if (iso === 6 && weeklyRestPattern === 'sat_sun') {
    tags.push('วันเสาร์');
  }
  return tags;
}

export function leaveOverlapsPayrollMonth(r: OfficeLeaveRequestDoc, payrollMonth: string): boolean {
  const monthStart = `${payrollMonth}-01`;
  const [y, m] = payrollMonth.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${payrollMonth}-${String(lastDay).padStart(2, '0')}`;
  const start = r.startDate.slice(0, 10);
  const end = r.endDate.slice(0, 10);
  return start <= monthEnd && end >= monthStart;
}

export function isAttendanceWeekendOrHolidayYmd(
  ymd: string,
  weeklyRestPattern: WeeklyRestPatternForCalendar,
  isCalendarHoliday: boolean,
): boolean {
  return isBangkokWeeklyRestDayYmd(ymd, weeklyRestPattern) || isCalendarHoliday;
}
