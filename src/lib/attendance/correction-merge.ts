import { bangkokYmdFromUtcMs } from '@/lib/attendance/bangkok-calendar';
import type { DailyPunchSummary } from '@/lib/attendance/shift-windows';
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
      if (ov.correctionRequestId === 'admin_reset') {
        return {
          ymd,
          rawFirstIn,
          rawLastOut,
          effectiveInMs: null,
          effectiveOutMs: null,
          override: ov,
        };
      }
      return {
        ymd,
        rawFirstIn,
        rawLastOut,
        effectiveInMs: ov.effectiveInAtMs,
        /** OUT จากสแกนหลังแก้ IN ยังนับได้ — ใช้ punch ดิบเมื่อ override ยังไม่กำหนด OUT */
        effectiveOutMs: ov.effectiveOutAtMs ?? rawLastOut?.punchedAt ?? null,
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

function isAdminResetOverride(override: AttendanceDayOverrideDoc | null): boolean {
  return override?.correctionRequestId === 'admin_reset';
}

/** แสดงป้าย "หลังแก้" เมื่อเวลาเข้ามาจาก override ที่อนุมัติแล้ว (ไม่ใช่สแกนดิบ) */
export function attendanceInCorrectedByOverride(row: AttendanceDayEffectiveRow): boolean {
  return (
    !!row.override
    && !isAdminResetOverride(row.override)
    && row.override.effectiveInAtMs != null
  );
}

/** แสดงป้าย "หลังแก้" เมื่อเวลาออกถูกกำหนดใน override (ไม่ใช่ OUT จากสแกนหลังแก้ IN) */
export function attendanceOutCorrectedByOverride(row: AttendanceDayEffectiveRow): boolean {
  return (
    !!row.override
    && !isAdminResetOverride(row.override)
    && row.override.effectiveOutAtMs != null
  );
}

export type EffectiveAttendanceHistoryEntry = {
  atMs: number;
  direction: 'IN' | 'OUT';
  corrected: boolean;
  ymd: string;
};

function collectAttendanceYmds(
  punches: Array<AttendancePunchDoc & { id?: string }>,
  overrides: AttendanceDayOverrideDoc[],
): string[] {
  const ymds = new Set<string>();
  for (const ymd of punchesGroupedByBangkokYmd(punches).keys()) ymds.add(ymd);
  for (const o of overrides) ymds.add(o.workDateYmd);
  return [...ymds].sort();
}

/** รายการเข้า/ออกที่ใช้จริง — แหล่งเดียวกับ HR สรุปรายเดือน และ Kiosk */
export function effectiveAttendanceHistoryEntries(
  punches: Array<AttendancePunchDoc & { id?: string }>,
  overrides: AttendanceDayOverrideDoc[],
): EffectiveAttendanceHistoryEntry[] {
  const ymDs = collectAttendanceYmds(punches, overrides);
  const dayRows = buildAttendanceDayRows(ymDs, punches, overrides);
  const entries: EffectiveAttendanceHistoryEntry[] = [];

  for (const row of dayRows) {
    if (row.effectiveInMs != null) {
      entries.push({
        atMs: row.effectiveInMs,
        direction: 'IN',
        corrected: attendanceInCorrectedByOverride(row),
        ymd: row.ymd,
      });
    }
    if (row.effectiveOutMs != null) {
      entries.push({
        atMs: row.effectiveOutMs,
        direction: 'OUT',
        corrected: attendanceOutCorrectedByOverride(row),
        ymd: row.ymd,
      });
    }
  }

  entries.sort((a, b) => b.atMs - a.atMs);
  return entries;
}

export type EffectiveAttendanceHistoryDayRow = {
  ymd: string;
  inMs: number | null;
  outMs: number | null;
  inCorrected: boolean;
  outCorrected: boolean;
};

/** หนึ่งแถวต่อวัน — ใช้แสดงประวัติใน Profile / แฟ้มพนักงาน */
export function effectiveAttendanceHistoryDayRows(
  punches: Array<AttendancePunchDoc & { id?: string }>,
  overrides: AttendanceDayOverrideDoc[],
): EffectiveAttendanceHistoryDayRow[] {
  const ymDs = collectAttendanceYmds(punches, overrides);
  return buildAttendanceDayRows(ymDs, punches, overrides)
    .filter((row) => row.effectiveInMs != null || row.effectiveOutMs != null)
    .map((row) => ({
      ymd: row.ymd,
      inMs: row.effectiveInMs,
      outMs: row.effectiveOutMs,
      inCorrected: attendanceInCorrectedByOverride(row),
      outCorrected: attendanceOutCorrectedByOverride(row),
    }))
    .sort((a, b) => b.ymd.localeCompare(a.ymd));
}

/** สรุปสถานะวันเดียวสำหรับ Kiosk/มือถือ — รวมเวลาหลังแก้ที่อนุมัติแล้ว */
export function effectiveDailyPunchSummary(
  punches: Array<AttendancePunchDoc & { id?: string }>,
  overrides: AttendanceDayOverrideDoc[],
  workDateYmd: string,
): DailyPunchSummary {
  const row = buildAttendanceDayRows([workDateYmd], punches, overrides)[0];
  return {
    hasIn: row.effectiveInMs != null,
    hasOut: row.effectiveOutMs != null,
    firstInAt: row.effectiveInMs,
    lastOutAt: row.effectiveOutMs,
  };
}
