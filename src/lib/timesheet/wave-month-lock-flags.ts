import type {
  DailyTimesheet,
  PoMonthTimesheetReview,
  WaveMonthTimesheetReview,
  WorkerMonthTimesheetClosure,
} from '@/lib/types';
import { isPoMonthFullGridLock } from '@/lib/timesheet/po-month-review-status';
import { isWorkerMonthClosureGridLocked } from '@/lib/timesheet/worker-month-closure';
import { ymdInRanges } from '@/lib/timesheet/ymd-ranges';

export function isWaveMonthReviewLocked(r: WaveMonthTimesheetReview | undefined): boolean {
  return (
    r?.status === 'entry_locked' ||
    r?.status === 'pending_manager_review' ||
    r?.status === 'approved'
  );
}

export function isMonthTimesheetRowLocked(
  poReview: PoMonthTimesheetReview | undefined,
  waveReview: WaveMonthTimesheetReview | undefined,
  workerClosure: WorkerMonthTimesheetClosure | undefined,
  ymd?: string,
): boolean {
  if (workerClosure) {
    if (
      workerClosure.status === 'deferred' ||
      workerClosure.status === 'open' ||
      workerClosure.status === 'rejected'
    ) {
      return false;
    }
    if (!isWorkerMonthClosureGridLocked(workerClosure.status)) return false;
    const ranges = workerClosure.closedDateRanges;
    if (ranges && ranges.length > 0) {
      if (!ymd) return false;
      return ymdInRanges(ymd, ranges);
    }
    return true;
  }
  if (isPoMonthFullGridLock(poReview)) return true;
  return isWaveMonthReviewLocked(waveReview);
}

export function isTimesheetPayrollLocked(ts: DailyTimesheet | undefined): boolean {
  return ts?.status === 'LOCKED';
}

export function canCorrectTimesheetOtDirect(ts: DailyTimesheet | undefined): boolean {
  return !!ts?.id && ts.status !== 'LOCKED';
}
