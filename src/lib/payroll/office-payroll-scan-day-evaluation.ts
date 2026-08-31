import { resolveFourScanSlotMs } from '@/lib/attendance/attendance-four-slot-times';
import type { AttendanceDayEffectiveRow } from '@/lib/attendance/correction-merge';
import type { AttendancePunchDoc } from '@/lib/attendance/types';
import {
  evaluateOfficeScanInForPayrollHalf,
  officeShiftMinuteBounds,
  type MonthlyWorkNormPolicyConfig,
  type OfficePayrollWorkingHalf,
} from '@/lib/hr/monthly-work-norm-policy';

type FourScanSlots = {
  morningInMs: number | null;
  morningOutMs: number | null;
  afternoonInMs: number | null;
  afternoonOutMs: number | null;
};

type DayScanPattern =
  | 'none'
  | 'two_punch_full'
  | 'morning_only'
  | 'afternoon_only'
  | 'four_punch'
  | 'partial';

export type OfficePayrollScanDayEvaluation = {
  /** สัดส่วนขาดงานของ \"ภาระงานที่เหลือ\" ในวันนั้น (0–1) */
  absenceDayFraction: number;
  lateMinutes: number;
};

function bangkokMinutesFromMidnight(ms: number): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

function detectScanPattern(slots: FourScanSlots): DayScanPattern {
  const { morningInMs, morningOutMs, afternoonInMs, afternoonOutMs } = slots;
  if (!morningInMs && !morningOutMs && !afternoonInMs && !afternoonOutMs) return 'none';
  if (morningInMs && afternoonOutMs && !morningOutMs && !afternoonInMs) return 'two_punch_full';
  if (!morningInMs && afternoonInMs && afternoonOutMs && !morningOutMs) return 'afternoon_only';
  if (morningInMs && morningOutMs && !afternoonInMs && !afternoonOutMs) return 'morning_only';
  if (morningInMs && morningOutMs && afternoonInMs && afternoonOutMs) return 'four_punch';
  return 'partial';
}

function hasAnyScan(slots: FourScanSlots): boolean {
  return !!(
    slots.morningInMs
    || slots.morningOutMs
    || slots.afternoonInMs
    || slots.afternoonOutMs
  );
}

function lateMinutesForInMs(
  inMs: number | null | undefined,
  norm: MonthlyWorkNormPolicyConfig,
  half: OfficePayrollWorkingHalf,
): number {
  if (inMs == null) return 0;
  return evaluateOfficeScanInForPayrollHalf(bangkokMinutesFromMidnight(inMs), norm, half).lateMinutes;
}

function evaluateFullDayFourSlotScan(
  slots: FourScanSlots,
  norm: MonthlyWorkNormPolicyConfig,
): OfficePayrollScanDayEvaluation {
  const pattern = detectScanPattern(slots);
  const { morningInMs, morningOutMs, afternoonInMs, afternoonOutMs } = slots;

  if (pattern === 'none') {
    return { absenceDayFraction: 1, lateMinutes: 0 };
  }

  if (pattern === 'two_punch_full') {
    return {
      absenceDayFraction: 0,
      lateMinutes: lateMinutesForInMs(morningInMs, norm, 'MORNING'),
    };
  }

  if (pattern === 'morning_only') {
    return {
      absenceDayFraction: 0.5,
      lateMinutes: lateMinutesForInMs(morningInMs, norm, 'MORNING'),
    };
  }

  if (pattern === 'afternoon_only') {
    const afternoonEv = evaluateOfficeScanInForPayrollHalf(
      afternoonInMs != null ? bangkokMinutesFromMidnight(afternoonInMs) : null,
      norm,
      'AFTERNOON',
    );
    return {
      absenceDayFraction: Math.min(1, 0.5 + afternoonEv.absenceDayFraction * 0.5),
      lateMinutes: afternoonEv.lateMinutes,
    };
  }

  let absenceDayFraction = 0;
  let lateMinutes = 0;

  if (morningInMs == null) {
    absenceDayFraction = 0.5;
  } else {
    const morningEv = evaluateOfficeScanInForPayrollHalf(
      bangkokMinutesFromMidnight(morningInMs),
      norm,
      'MORNING',
    );
    lateMinutes += morningEv.lateMinutes;
    if (morningEv.absenceDayFraction > 0) {
      absenceDayFraction = Math.max(absenceDayFraction, morningEv.absenceDayFraction * 0.5);
    }
  }

  if (afternoonInMs == null) {
    if (morningInMs != null) {
      absenceDayFraction = Math.max(absenceDayFraction, 0.5);
    }
  } else {
    const afternoonEv = evaluateOfficeScanInForPayrollHalf(
      bangkokMinutesFromMidnight(afternoonInMs),
      norm,
      'AFTERNOON',
    );
    lateMinutes += afternoonEv.lateMinutes;
    if (afternoonEv.absenceDayFraction > 0) {
      absenceDayFraction = Math.max(absenceDayFraction, 0.5 + afternoonEv.absenceDayFraction * 0.5);
    }
  }

  if (pattern === 'four_punch' && morningInMs != null && morningOutMs == null && afternoonInMs == null) {
    absenceDayFraction = Math.max(absenceDayFraction, 0.5);
  }

  if (morningInMs != null && afternoonOutMs == null && afternoonInMs != null) {
    // เข้าบ่ายแล้วแต่ไม่มีสแกนออก — ไม่เพิ่มหักวัน (ยังถือว่ามาทำงานครึ่งบ่าย)
  }

  return {
    absenceDayFraction: Math.min(1, absenceDayFraction),
    lateMinutes,
  };
}

function evaluateHalfDayFourSlotScan(
  workingHalf: Exclude<OfficePayrollWorkingHalf, 'FULL'>,
  slots: FourScanSlots,
  norm: MonthlyWorkNormPolicyConfig,
): OfficePayrollScanDayEvaluation {
  if (!hasAnyScan(slots)) {
    return { absenceDayFraction: 1, lateMinutes: 0 };
  }

  if (workingHalf === 'MORNING') {
    if (slots.morningInMs == null) {
      return { absenceDayFraction: 1, lateMinutes: 0 };
    }
    const ev = evaluateOfficeScanInForPayrollHalf(
      bangkokMinutesFromMidnight(slots.morningInMs),
      norm,
      'MORNING',
    );
    return { absenceDayFraction: ev.absenceDayFraction, lateMinutes: ev.lateMinutes };
  }

  if (slots.afternoonInMs == null) {
    if (slots.morningInMs != null && slots.afternoonOutMs != null) {
      return {
        absenceDayFraction: 0,
        lateMinutes: lateMinutesForInMs(slots.morningInMs, norm, 'MORNING'),
      };
    }
    return { absenceDayFraction: 1, lateMinutes: 0 };
  }

  const ev = evaluateOfficeScanInForPayrollHalf(
    bangkokMinutesFromMidnight(slots.afternoonInMs),
    norm,
    'AFTERNOON',
  );
  return { absenceDayFraction: ev.absenceDayFraction, lateMinutes: ev.lateMinutes };
}

/**
 * ประเมินหักสาย/ขาดจากสแกน 4 ช่วง — ให้สอดคล้องกับตาราง Attendance และ HR Settings
 */
export function evaluateOfficePayrollScanDay(input: {
  workingHalf: OfficePayrollWorkingHalf;
  remainingWorkFraction: number;
  slots: FourScanSlots;
  monthlyWorkNorm: MonthlyWorkNormPolicyConfig;
}): OfficePayrollScanDayEvaluation {
  const remaining = Math.max(0, Math.min(1, Number(input.remainingWorkFraction) || 0));
  if (remaining <= 0) {
    return { absenceDayFraction: 0, lateMinutes: 0 };
  }

  const bounds = officeShiftMinuteBounds(input.monthlyWorkNorm);
  if (!bounds) {
    const firstIn = input.slots.morningInMs ?? input.slots.afternoonInMs;
    if (firstIn == null) {
      return { absenceDayFraction: 1, lateMinutes: 0 };
    }
    const ev = evaluateOfficeScanInForPayrollHalf(
      bangkokMinutesFromMidnight(firstIn),
      input.monthlyWorkNorm,
      input.workingHalf,
    );
    return { absenceDayFraction: ev.absenceDayFraction, lateMinutes: ev.lateMinutes };
  }

  const base =
    input.workingHalf === 'FULL'
      ? evaluateFullDayFourSlotScan(input.slots, input.monthlyWorkNorm)
      : evaluateHalfDayFourSlotScan(input.workingHalf, input.slots, input.monthlyWorkNorm);

  return {
    absenceDayFraction: Math.min(1, base.absenceDayFraction),
    lateMinutes: Math.max(0, base.lateMinutes),
  };
}

export function resolveOfficePayrollDayFourScanSlots(input: {
  dayRow: AttendanceDayEffectiveRow | undefined;
  dayPunches: AttendancePunchDoc[];
  monthlyWorkNorm: MonthlyWorkNormPolicyConfig;
}): FourScanSlots {
  if (!input.dayRow) {
    return { morningInMs: null, morningOutMs: null, afternoonInMs: null, afternoonOutMs: null };
  }
  const resolved = resolveFourScanSlotMs({
    dayRow: input.dayRow,
    dayPunches: input.dayPunches,
    monthlyWorkNorm: input.monthlyWorkNorm,
  });
  return {
    morningInMs: resolved.morningInAtMs,
    morningOutMs: resolved.morningOutAtMs,
    afternoonInMs: resolved.afternoonInAtMs,
    afternoonOutMs: resolved.afternoonOutAtMs,
  };
}

export function currentBangkokYmd(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}
