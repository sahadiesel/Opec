import { bangkokYmdFromUtcMs } from '@/lib/attendance/bangkok-calendar';
import type { AttendanceDayOverrideDoc, AttendancePunchDoc } from '@/lib/attendance/types';

export type AttendanceDayEffectiveRow = {
  ymd: string;
  rawFirstIn: (AttendancePunchDoc & { id?: string }) | null;
  rawLastOut: (AttendancePunchDoc & { id?: string }) | null;
  effectiveInMs: number | null;
  effectiveOutMs: number | null;
  override: AttendanceDayOverrideDoc | null;
};

/** Latest override per calendar day wins (by `appliedAt`). */
export function latestOverrideByYmd(overrides: AttendanceDayOverrideDoc[]): Map<string, AttendanceDayOverrideDoc> {
  const m = new Map<string, AttendanceDayOverrideDoc>();
  for (const o of overrides) {
    const cur = m.get(o.workDateYmd);
    if (!cur || o.appliedAt > cur.appliedAt) m.set(o.workDateYmd, o);
  }
  return m;
}

export function punchesGroupedByBangkokYmd(
  punches: Array<AttendancePunchDoc & { id?: string }>,
): Map<string, Array<AttendancePunchDoc & { id?: string }>> {
  const byDay = new Map<string, Array<AttendancePunchDoc & { id?: string }>>();
  for (const p of punches) {
    const ymd = bangkokYmdFromUtcMs(p.punchedAt);
    if (!ymd) continue;
    const arr = byDay.get(ymd) ?? [];
    arr.push(p);
    byDay.set(ymd, arr);
  }
  for (const [, arr] of byDay) {
    arr.sort((a, b) => a.punchedAt - b.punchedAt);
  }
  return byDay;
}

export function buildAttendanceDayRows(
  ymDs: string[],
  punches: Array<AttendancePunchDoc & { id?: string }>,
  overrides: AttendanceDayOverrideDoc[],
): AttendanceDayEffectiveRow[] {
  const byDay = punchesGroupedByBangkokYmd(punches);
  const ovMap = latestOverrideByYmd(overrides);

  return ymDs.map((ymd) => {
    const dayList = byDay.get(ymd) ?? [];
    const ins = dayList.filter((p) => p.direction === 'IN');
    const outs = dayList.filter((p) => p.direction === 'OUT');
    const rawFirstIn = ins.length ? ins.reduce((a, b) => (a.punchedAt <= b.punchedAt ? a : b)) : null;
    const rawLastOut = outs.length ? outs.reduce((a, b) => (a.punchedAt >= b.punchedAt ? a : b)) : null;
    const ov = ovMap.get(ymd) ?? null;
    if (ov) {
      return {
        ymd,
        rawFirstIn,
        rawLastOut,
        effectiveInMs: ov.effectiveInAtMs,
        effectiveOutMs: ov.effectiveOutAtMs,
        override: ov,
      };
    }
    return {
      ymd,
      rawFirstIn,
      rawLastOut,
      effectiveInMs: rawFirstIn?.punchedAt ?? null,
      effectiveOutMs: rawLastOut?.punchedAt ?? null,
      override: null,
    };
  });
}

export function countDaysWithEffectiveRecord(rows: AttendanceDayEffectiveRow[]): number {
  return rows.filter((r) => r.effectiveInMs != null || r.effectiveOutMs != null).length;
}
