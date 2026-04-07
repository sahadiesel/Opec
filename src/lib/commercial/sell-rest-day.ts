import type { MainContract } from '@/lib/types';

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

  const holidays = contract.contractSellCalendarHolidays || [];
  if (holidays.some((h) => h.date === dateStr)) {
    return {
      active: true,
      kind: 'public_holiday',
      publicHolidayWrap: Number(sell.publicHoliday ?? 1),
    };
  }

  const parts = dateStr.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return { active: false, kind: 'none' };

  const local = new Date(y, m - 1, d);
  const dow = local.getDay();

  const pattern = contract.contractSellWeeklyRestPattern || 'none';
  const sunday = Number(sell.sunday ?? 1);
  const sundayOt = Number(sell.sundayOt ?? sell.sunday ?? 1);

  if (pattern === 'sunday_only' && dow === 0) {
    return {
      active: true,
      kind: 'weekly_rest',
      weeklyNormalMult: sunday,
      weeklyOtMult: sundayOt,
    };
  }
  if (pattern === 'sat_sun' && (dow === 0 || dow === 6)) {
    return {
      active: true,
      kind: 'weekly_rest',
      weeklyNormalMult: sunday,
      weeklyOtMult: sundayOt,
    };
  }

  return { active: false, kind: 'none' };
}
