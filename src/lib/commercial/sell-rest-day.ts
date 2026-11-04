import type { MainContract } from '@/lib/types';
import { coerceToGregorianYmd, gregorianYmdsEqual } from '@/lib/date-thai';
import { isBangkokWeeklyRestDayYmd } from '@/lib/attendance/bangkok-calendar';

export interface SellRestDayResolution {
  active: boolean;
  kind: 'none' | 'public_holiday' | 'weekly_rest';
  publicHolidayWrap?: number;
  weeklyNormalMult?: number;
  weeklyOtMult?: number;
}

/**
 * วันหยุด / เสาร์–อาทิตย์ ฝั่งขาย — จากสัญญาหลัก (sell multipliers + ปฏิทิน/weekly pattern ฝั่งขาย)
 */
export function resolveSellRestDay(
  dateStr: string,
  contract: MainContract | undefined,
): SellRestDayResolution {
  const sell = contract?.rateMultiplierPolicy?.sell;
  if (!sell) return { active: false, kind: 'none' };

  const ymd = coerceToGregorianYmd(dateStr);
  const holidays = contract.contractSellCalendarHolidays || [];
  if (ymd && holidays.some((h) => gregorianYmdsEqual(h.date, ymd))) {
    return {
      active: true,
      kind: 'public_holiday',
      publicHolidayWrap: Number(sell.publicHoliday ?? 1),
    };
  }

  if (!ymd) return { active: false, kind: 'none' };

  const pattern = contract.contractSellWeeklyRestPattern || 'none';
  const sunday = Number(sell.sunday ?? 1);
  const sundayOt = Number(sell.sundayOt ?? sell.sunday ?? 1);

  if (isBangkokWeeklyRestDayYmd(ymd, pattern)) {
    return {
      active: true,
      kind: 'weekly_rest',
      weeklyNormalMult: sunday,
      weeklyOtMult: sundayOt,
    };
  }

  return { active: false, kind: 'none' };
}
