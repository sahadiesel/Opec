import { assignFourScanSlots, buildEffectivePunchLists } from '@/lib/attendance/office-attendance-grid-day-cell';
import type { AttendanceDayEffectiveRow } from '@/lib/attendance/correction-merge';
import { formatBangkokHmFromUtcMs, utcMsFromBangkokYmdAndHm } from '@/lib/attendance/bangkok-calendar';
import type { AttendanceDayOverrideDoc, AttendanceCorrectionRequestDoc, AttendancePunchDoc } from '@/lib/attendance/types';
import { officeShiftMinuteBounds, type MonthlyWorkNormPolicyConfig } from '@/lib/hr/monthly-work-norm-policy';

export type AttendanceFourSlotTimesMs = {
  morningInAtMs: number | null;
  morningOutAtMs: number | null;
  afternoonInAtMs: number | null;
  afternoonOutAtMs: number | null;
};

export type AttendanceFourSlotHm = {
  morningInHm: string;
  morningOutHm: string;
  afternoonInHm: string;
  afternoonOutHm: string;
};

export const EMPTY_FOUR_SLOT_MS: AttendanceFourSlotTimesMs = {
  morningInAtMs: null,
  morningOutAtMs: null,
  afternoonInAtMs: null,
  afternoonOutAtMs: null,
};

function hmOrDash(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return formatBangkokHmFromUtcMs(ms);
}

export function deriveLegacyInOutFromFourSlots(
  slots: AttendanceFourSlotTimesMs,
): { inAtMs: number | null; outAtMs: number | null } {
  const ins = [slots.morningInAtMs, slots.afternoonInAtMs].filter(
    (ms): ms is number => ms != null && Number.isFinite(ms),
  );
  const outs = [slots.morningOutAtMs, slots.afternoonOutAtMs].filter(
    (ms): ms is number => ms != null && Number.isFinite(ms),
  );
  ins.sort((a, b) => a - b);
  outs.sort((a, b) => a - b);
  return {
    inAtMs: ins[0] ?? null,
    outAtMs: outs.length ? outs[outs.length - 1]! : null,
  };
}

export function fourSlotTimesFromOverride(
  override: AttendanceDayOverrideDoc | null | undefined,
): AttendanceFourSlotTimesMs | null {
  if (!override || override.correctionRequestId === 'admin_reset') return null;
  const hasFour =
    override.effectiveMorningInAtMs != null
    || override.effectiveMorningOutAtMs != null
    || override.effectiveAfternoonInAtMs != null
    || override.effectiveAfternoonOutAtMs != null;
  if (!hasFour) return null;
  return {
    morningInAtMs: override.effectiveMorningInAtMs ?? null,
    morningOutAtMs: override.effectiveMorningOutAtMs ?? null,
    afternoonInAtMs: override.effectiveAfternoonInAtMs ?? null,
    afternoonOutAtMs: override.effectiveAfternoonOutAtMs ?? null,
  };
}

export function resolveFourScanSlotMs(input: {
  dayRow: AttendanceDayEffectiveRow;
  dayPunches: AttendancePunchDoc[];
  monthlyWorkNorm: MonthlyWorkNormPolicyConfig;
}): AttendanceFourSlotTimesMs {
  const overrideFour = fourSlotTimesFromOverride(input.dayRow.override);
  if (overrideFour) return overrideFour;

  const { ins, outs } = buildEffectivePunchLists(input.dayRow, input.dayPunches);
  const bounds = officeShiftMinuteBounds(input.monthlyWorkNorm);
  const slots = assignFourScanSlots(ins, outs, bounds);
  return {
    morningInAtMs: slots.morningInMs,
    morningOutAtMs: slots.morningOutMs,
    afternoonInAtMs: slots.afternoonInMs,
    afternoonOutAtMs: slots.afternoonOutMs,
  };
}

export function fourSlotHmFromMs(slots: AttendanceFourSlotTimesMs): AttendanceFourSlotHm {
  return {
    morningInHm: slots.morningInAtMs != null ? formatBangkokHmFromUtcMs(slots.morningInAtMs) : '',
    morningOutHm: slots.morningOutAtMs != null ? formatBangkokHmFromUtcMs(slots.morningOutAtMs) : '',
    afternoonInHm: slots.afternoonInAtMs != null ? formatBangkokHmFromUtcMs(slots.afternoonInAtMs) : '',
    afternoonOutHm: slots.afternoonOutAtMs != null ? formatBangkokHmFromUtcMs(slots.afternoonOutAtMs) : '',
  };
}

export function formatFourSlotTimesLabelTh(
  slots: AttendanceFourSlotTimesMs,
  prefix = 'ปัจจุบันในระบบ: ',
): string {
  return (
    `${prefix}เข้าเช้า ${hmOrDash(slots.morningInAtMs)} · ออกเที่ยง ${hmOrDash(slots.morningOutAtMs)} · `
    + `เข้าบ่าย ${hmOrDash(slots.afternoonInAtMs)} · ออกเย็น ${hmOrDash(slots.afternoonOutAtMs)}`
  );
}

export function parseFourSlotHmToMs(
  workDateYmd: string,
  hm: AttendanceFourSlotHm,
): { slots: AttendanceFourSlotTimesMs; error?: string } {
  const parseOne = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return utcMsFromBangkokYmdAndHm(workDateYmd, trimmed);
  };

  const morningInAtMs = parseOne(hm.morningInHm);
  const morningOutAtMs = parseOne(hm.morningOutHm);
  const afternoonInAtMs = parseOne(hm.afternoonInHm);
  const afternoonOutAtMs = parseOne(hm.afternoonOutHm);

  const checks: Array<[string, string, number | null]> = [
    ['เข้าเช้า', hm.morningInHm, morningInAtMs],
    ['ออกเที่ยง', hm.morningOutHm, morningOutAtMs],
    ['เข้าบ่าย', hm.afternoonInHm, afternoonInAtMs],
    ['ออกเย็น', hm.afternoonOutHm, afternoonOutAtMs],
  ];
  for (const [label, raw, ms] of checks) {
    if (raw.trim() && ms == null) {
      return { slots: EMPTY_FOUR_SLOT_MS, error: `${label}: ใช้รูปแบบ HH:mm เช่น 08:30` };
    }
  }

  return {
    slots: { morningInAtMs, morningOutAtMs, afternoonInAtMs, afternoonOutAtMs },
  };
}

export function fourSlotHasAnyTime(slots: AttendanceFourSlotTimesMs): boolean {
  return (
    slots.morningInAtMs != null
    || slots.morningOutAtMs != null
    || slots.afternoonInAtMs != null
    || slots.afternoonOutAtMs != null
  );
}

function fourSlotFromCorrectionFields(
  morningIn: number | null | undefined,
  morningOut: number | null | undefined,
  afternoonIn: number | null | undefined,
  afternoonOut: number | null | undefined,
  legacyIn: number | null | undefined,
  legacyOut: number | null | undefined,
): AttendanceFourSlotTimesMs {
  const hasFour =
    morningIn != null
    || morningOut != null
    || afternoonIn != null
    || afternoonOut != null;
  if (hasFour) {
    return {
      morningInAtMs: morningIn ?? null,
      morningOutAtMs: morningOut ?? null,
      afternoonInAtMs: afternoonIn ?? null,
      afternoonOutAtMs: afternoonOut ?? null,
    };
  }
  return {
    morningInAtMs: legacyIn ?? null,
    morningOutAtMs: null,
    afternoonInAtMs: null,
    afternoonOutAtMs: legacyOut ?? null,
  };
}

export function previousFourSlotTimesFromCorrectionRequest(
  row: AttendanceCorrectionRequestDoc,
): AttendanceFourSlotTimesMs {
  return fourSlotFromCorrectionFields(
    row.previousMorningInAtMs,
    row.previousMorningOutAtMs,
    row.previousAfternoonInAtMs,
    row.previousAfternoonOutAtMs,
    row.previousInAtMs,
    row.previousOutAtMs,
  );
}

export function proposedFourSlotTimesFromCorrectionRequest(
  row: AttendanceCorrectionRequestDoc,
): AttendanceFourSlotTimesMs {
  return fourSlotFromCorrectionFields(
    row.proposedMorningInAtMs,
    row.proposedMorningOutAtMs,
    row.proposedAfternoonInAtMs,
    row.proposedAfternoonOutAtMs,
    row.proposedInAtMs,
    row.proposedOutAtMs,
  );
}
