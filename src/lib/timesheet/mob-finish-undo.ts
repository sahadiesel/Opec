import { collection, getDocs, query, where, type Firestore } from 'firebase/firestore';
import type {
  Assignment,
  DailyTimesheet,
  DeploymentStatus,
  MobLocationPhase,
  MobFinishUndoSnapshot,
} from '@/lib/types';
import { buildMobCycleDocId } from '@/lib/ops/mob-cycle-ids';
import { isAssignmentDraftAwaitingFirstMobOnly } from '@/lib/constants/timesheet-ui';

export function buildMobFinishUndoSnapshot(asgn: Assignment): MobFinishUndoSnapshot {
  return {
    deploymentStatus: asgn.deploymentStatus,
    mobilizationStatus: asgn.mobilizationStatus,
    mobCycleNumber: asgn.mobCycleNumber,
    mobCycleId: asgn.mobCycleId,
    mobStandbyDate: asgn.mobStandbyDate,
    mobStandbyDayEventType: asgn.mobStandbyDayEventType,
    mobStandbyRecordedAt: asgn.mobStandbyRecordedAt,
    mobStandbyRecordedByUserId: asgn.mobStandbyRecordedByUserId,
    mobWorkingStartDate: asgn.mobWorkingStartDate,
    mobWorkingStartedAt: asgn.mobWorkingStartedAt,
    mobWorkingStartedByUserId: asgn.mobWorkingStartedByUserId,
    mobReadyToTravelAt: asgn.mobReadyToTravelAt,
    mobReadyToTravelByUserId: asgn.mobReadyToTravelByUserId,
    mobLocationPhase: asgn.mobLocationPhase,
    poActiveAutoWorkSuspended: asgn.poActiveAutoWorkSuspended,
    poActiveStandbyAutoStartYmd: asgn.poActiveStandbyAutoStartYmd,
    poActiveStandbyAutoEndYmd: asgn.poActiveStandbyAutoEndYmd,
  };
}

/** คืนค่า mobilization ก่อนจบงาน — ใช้กับ writeBatch update (ค่า deleteField ใส่จาก caller) */
export function buildMobFinishUndoRestoreFields(
  assignmentId: string,
  snapshot: MobFinishUndoSnapshot | undefined,
  fallbackCycle: number,
  deleteFieldSentinel: unknown,
): Record<string, unknown> {
  const cycle = snapshot?.mobCycleNumber ?? fallbackCycle;
  const del = deleteFieldSentinel;

  const optionalStringKeys = ['mobStandbyDate', 'poActiveStandbyAutoStartYmd', 'poActiveStandbyAutoEndYmd'] as const;
  const optionalNumberKeys = [
    'mobStandbyRecordedAt',
    'mobWorkingStartedAt',
    'mobReadyToTravelAt',
  ] as const;
  const optionalStringIdKeys = [
    'mobStandbyRecordedByUserId',
    'mobWorkingStartedByUserId',
    'mobReadyToTravelByUserId',
  ] as const;

  const out: Record<string, unknown> = {
    deploymentStatus: (snapshot?.deploymentStatus ?? 'ACTIVE') as DeploymentStatus,
    mobilizationStatus: snapshot?.mobilizationStatus ?? 'ACTIVE',
    mobCycleNumber: cycle,
    mobCycleId: snapshot?.mobCycleId ?? buildMobCycleDocId(assignmentId, cycle),
    mobLocationEndDate: del,
    mobLocationEndedAt: del,
    mobLocationEndedByUserId: del,
    mobFinishUndoSnapshot: del,
  };

  for (const key of optionalStringKeys) {
    const v = snapshot?.[key];
    out[key] = typeof v === 'string' && v.trim() ? v.trim() : del;
  }
  for (const key of optionalNumberKeys) {
    const v = snapshot?.[key];
    out[key] = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : del;
  }
  for (const key of optionalStringIdKeys) {
    const v = snapshot?.[key];
    out[key] = typeof v === 'string' && v.trim() ? v.trim() : del;
  }

  const ws = snapshot?.mobWorkingStartDate;
  out.mobWorkingStartDate = typeof ws === 'string' && ws.trim() ? ws.trim().slice(0, 10) : del;

  const phase = snapshot?.mobLocationPhase;
  out.mobLocationPhase = phase ? (phase as MobLocationPhase) : del;

  const dayEt = snapshot?.mobStandbyDayEventType;
  out.mobStandbyDayEventType = dayEt === 'standby_day' || dayEt === 'mobilization_day' ? dayEt : del;

  out.poActiveAutoWorkSuspended =
    snapshot?.poActiveAutoWorkSuspended === true ? true : del;

  return out;
}

const COUNTABLE_TS_EVENT_TYPES = new Set<DailyTimesheet['eventType']>([
  'work_day',
  'standby_day',
  'mobilization_day',
]);

/** กรณี snapshot ไม่มี (จบงานก่อน deploy) — หา mobWorkingStartDate จาก daily_timesheets ที่มีอยู่ */
export async function inferMobWorkingStartDateFromTimesheets(
  db: Firestore,
  assignmentId: string,
): Promise<string | undefined> {
  const snap = await getDocs(
    query(collection(db, 'daily_timesheets'), where('assignmentId', '==', assignmentId)),
  );
  let min: string | undefined;
  for (const d of snap.docs) {
    const t = d.data() as DailyTimesheet;
    if (!COUNTABLE_TS_EVENT_TYPES.has(t.eventType)) continue;
    const ymd = (t.date || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    if (!min || ymd < min) min = ymd;
  }
  return min;
}

/** วันนี้ยังแก้ไขลงเวลารอบก่อนจบงานได้ แม้อยู่ Waiting MOB (DRAFT + mobLocationEndDate) */
export function isPoDailyBoardPriorCycleWorkDateWhileAwaitingRemob(
  asgn: Pick<Assignment, 'deploymentStatus' | 'mobLocationEndDate' | 'mobCycleNumber' | 'unassignedAt'>,
  dateYmd: string,
): boolean {
  if (asgn.deploymentStatus !== 'DRAFT') return false;
  if (!(asgn.mobLocationEndDate || '').trim()) return false;
  if (isAssignmentDraftAwaitingFirstMobOnly(asgn)) return false;
  const mobEnd = (asgn.mobLocationEndDate || '').trim().slice(0, 10);
  const d = dateYmd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mobEnd) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d <= mobEnd;
}
