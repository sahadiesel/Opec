import type { DailyTimesheet, Worker } from '@/lib/types';
import { normalHoursCountedAsWork, standbyHoursCountedForWaveMonth } from '@/lib/timesheet/wave-month-utils';

/** สรุปชม.สะสมต่อคน — นิยามเดียวกับคอลัมน์รวมชม. / รวมชม. Standby ในตาราง timesheet รายเดือน */
export type WorkerAccumulatedHours = {
  workHours: number;
  standbyHours: number;
  firstWorkedAt: number | null;
  lastWorkedAt: number | null;
};

export function emptyWorkerAccumulatedHours(): WorkerAccumulatedHours {
  return { workHours: 0, standbyHours: 0, firstWorkedAt: null, lastWorkedAt: null };
}

export function accumulateWorkerHoursFromTimesheets(
  sheets: readonly DailyTimesheet[] | null | undefined,
): Map<string, WorkerAccumulatedHours> {
  const bucket = new Map<string, WorkerAccumulatedHours>();
  for (const ts of sheets ?? []) {
    const workerId = (ts.workerId || '').trim();
    if (!workerId) continue;
    const current = bucket.get(workerId) ?? emptyWorkerAccumulatedHours();
    current.workHours += normalHoursCountedAsWork(ts);
    current.standbyHours += standbyHoursCountedForWaveMonth(ts);
    const tsTime = ts.date ? new Date(ts.date).getTime() : NaN;
    if (!Number.isNaN(tsTime)) {
      current.firstWorkedAt = current.firstWorkedAt === null ? tsTime : Math.min(current.firstWorkedAt, tsTime);
      current.lastWorkedAt = current.lastWorkedAt === null ? tsTime : Math.max(current.lastWorkedAt, tsTime);
    }
    bucket.set(workerId, current);
  }
  return bucket;
}

export function workerAccumulatedWorkHours(
  worker: Pick<Worker, 'id' | 'totalWorkedHours'>,
  hoursMap: Map<string, WorkerAccumulatedHours>,
): number {
  const agg = hoursMap.get(worker.id);
  if (agg) return agg.workHours;
  return Number(worker.totalWorkedHours || 0);
}

export function workerAccumulatedStandbyHours(
  worker: Pick<Worker, 'id' | 'totalStandbyHours'>,
  hoursMap: Map<string, WorkerAccumulatedHours>,
): number {
  const agg = hoursMap.get(worker.id);
  if (agg) return agg.standbyHours;
  return Number(worker.totalStandbyHours || 0);
}
