import { collection, getDocs, query, where, type Firestore } from 'firebase/firestore';
import type {
  Assignment,
  DailyTimesheet,
  DeploymentStatus,
  MobLocationPhase,
  MobFinishUndoSnapshot,
} from '@/lib/types';
import { buildMobCycleDocId } from '@/lib/ops/mob-cycle-ids';

/** Firestore ไม่รับ undefined ใน nested map — เก็บเฉพาะฟิลด์ที่มีค่า */
function compactMobFinishUndoSnapshot(snapshot: MobFinishUndoSnapshot): MobFinishUndoSnapshot {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== undefined) out[key] = value;
  }
  return out as MobFinishUndoSnapshot;
}

export function buildMobFinishUndoSnapshot(asgn: Assignment): MobFinishUndoSnapshot {
  return compactMobFinishUndoSnapshot({
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
    poActiveAutoWorkSuspended: asgn.poActiveAutoWorkSuspended === true ? true : undefined,
    poActiveStandbyAutoStartYmd: asgn.poActiveStandbyAutoStartYmd,
    poActiveStandbyAutoEndYmd: asgn.poActiveStandbyAutoEndYmd,
  });
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

/** กรณี snapshot ไม่มี (จบงานก่อน deploy) — หา mobWorkingStartDate จาก daily_timesheets ที่มีอยู่ */
export async function inferMobWorkingStartDateFromTimesheets(
  db: Firestore,
  assignmentId: string,
): Promise<string | undefined> {
  const snap = await getDocs(
    query(collection(db, 'daily_timesheets'), where('assignmentId', '==', assignmentId)),
  );
  let minWork: string | undefined;
  for (const d of snap.docs) {
    const t = d.data() as DailyTimesheet;
    if (t.eventType !== 'work_day') continue;
    const ymd = (t.date || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    if (!minWork || ymd < minWork) minWork = ymd;
  }
  return minWork;
}

/** กรณี snapshot ไม่มี — หา mobStandbyDate จาก daily_timesheets (SB/M1 ก่อนวันเริ่มงาน) */
export async function inferMobStandbyDateFromTimesheets(
  db: Firestore,
  assignmentId: string,
  mobWorkingStartDate?: string,
): Promise<string | undefined> {
  const snap = await getDocs(
    query(collection(db, 'daily_timesheets'), where('assignmentId', '==', assignmentId)),
  );
  let minSb: string | undefined;
  const workStart = (mobWorkingStartDate || '').trim().slice(0, 10);
  for (const d of snap.docs) {
    const t = d.data() as DailyTimesheet;
    if (t.eventType !== 'standby_day' && t.eventType !== 'mobilization_day') continue;
    const ymd = (t.date || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(workStart) && ymd >= workStart) continue;
    if (!minSb || ymd < minSb) minSb = ymd;
  }
  return minSb;
}

/** คืนค่าวัน mobilization จากใบงานเมื่อ snapshot ไม่ครบ */
export async function inferMobDatesFromTimesheets(
  db: Firestore,
  assignmentId: string,
): Promise<{ mobWorkingStartDate?: string; mobStandbyDate?: string }> {
  const mobWorkingStartDate = await inferMobWorkingStartDateFromTimesheets(db, assignmentId);
  const mobStandbyDate = await inferMobStandbyDateFromTimesheets(db, assignmentId, mobWorkingStartDate);
  return { mobWorkingStartDate, mobStandbyDate };
}

/** Re-export — นิยามอยู่ที่ `@/lib/constants/timesheet-ui` */
export {
  isPoDailyBoardPriorCycleWorkDateWhileAwaitingRemob,
} from '@/lib/constants/timesheet-ui';
