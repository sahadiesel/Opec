import type { DailyTimesheet } from '@/lib/types';
import { LEGAL_NORMAL_HOURS_PER_DAY } from '@/lib/commercial/package-hourly-rate';

export interface ParsedWorkDayHours {
  nh: number;
  o15: number;
  o20: number;
  o30: number;
  legalNormal: number;
  overflowNormal: number;
  tierOtHours: number;
}

export function parseWorkDayHours(ts: DailyTimesheet): ParsedWorkDayHours {
  const nh = Math.max(0, ts.normalHours || 0);
  const o15 = Math.max(0, ts.ot15Hours || 0);
  const o20 = Math.max(0, ts.ot20Hours || 0);
  const o30 = Math.max(0, ts.ot30Hours || 0);
  const legalNormal = Math.min(nh, LEGAL_NORMAL_HOURS_PER_DAY);
  const overflowNormal = Math.max(0, nh - LEGAL_NORMAL_HOURS_PER_DAY);
  return {
    nh,
    o15,
    o20,
    o30,
    legalNormal,
    overflowNormal,
    tierOtHours: o15 + o20 + o30,
  };
}
