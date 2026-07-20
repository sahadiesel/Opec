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
    mobStep2Choice: asgn.mobStep2Choice,
    mobStep2BillingCharge: asgn.mobStep2BillingCharge,
    mobStep2PayrollCharge: asgn.mobStep2PayrollCharge,
    mobStandbyRecordedAt: asgn.mobStandbyRecordedAt,
    mobStandbyRecordedByUserId: asgn.mobStandbyRecordedByUserId,
    mobWorkingStartDate: asgn.mobWorkingStartDate,
    mobWorkingStartedAt: asgn.mobWorkingStartedAt,
    mobWorkingStartedByUserId: asgn.mobWorkingStartedByUserId,
    mobReadyToTravelAt: asgn.mobReadyToTravelAt,
    mobReadyToTravelByUserId: asgn.mobReadyToTravelByUserId,
    mobLocationPhase: asgn.mobLocationPhase,
    mobLocationKey: asgn.mobLocationKey,
    workLocation: asgn.workLocation,
    poActiveAutoWorkSuspended: asgn.poActiveAutoWorkSuspended === true ? true : undefined,
    poActiveStandbyAutoStartYmd: asgn.poActiveStandbyAutoStartYmd,
    poActiveStandbyAutoEndYmd: asgn.poActiveStandbyAutoEndYmd,
  });
}

/**
 * เคลียร์ Final clearance + ไซต์เมื่อจบงานกลับ Waiting MOB
 * — ต้องเลือก location และวัน Pre-Mob/Mob ใหม่เหมือนรอบแรก
 * (เก็บ mobLocationEndDate / snapshot ไว้สำหรับประวัติรอบเก่าและยกเลิกจบงาน)
 */
export function buildMobRemobClearanceDeleteFields(deleteFieldSentinel: unknown): Record<string, unknown> {
  const del = deleteFieldSentinel;
  return {
    mobReadyToTravelAt: del,
    mobReadyToTravelByUserId: del,
    mobStandbyDate: del,
    mobStandbyDayEventType: del,
    mobStep2Choice: del,
    mobStep2BillingCharge: del,
    mobStep2PayrollCharge: del,
    mobStandbyRecordedAt: del,
    mobStandbyRecordedByUserId: del,
    mobWorkingStartDate: del,
    mobWorkingStartedAt: del,
    mobWorkingStartedByUserId: del,
    mobLocationKey: del,
    workLocation: del,
    mobLocationPhase: del,
    poActiveAutoWorkSuspended: del,
    poActiveStandbyAutoStartYmd: del,
    poActiveStandbyAutoEndYmd: del,
  };
}

/**
 * DRAFT รอ remob แต่ยังมีค่า Final clearance / ไซต์รอบเก่าค้าง
 * (วัน SB/เริ่มงาน ≤ วันจบไซต์ หรือมี timestamp ขั้น 2–3 ค้าง)
 */
export function assignmentHasStaleFinalClearanceWhileAwaitingRemob(
  a: Pick<
    Assignment,
    | 'deploymentStatus'
    | 'mobLocationEndDate'
    | 'mobStandbyDate'
    | 'mobWorkingStartDate'
    | 'mobReadyToTravelAt'
    | 'mobStandbyRecordedAt'
    | 'mobWorkingStartedAt'
    | 'mobLocationKey'
    | 'workLocation'
    | 'mobStandbyDayEventType'
    | 'mobStep2Choice'
  >,
): boolean {
  if (a.deploymentStatus !== 'DRAFT') return false;
  const end = (a.mobLocationEndDate || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;

  const standby = (a.mobStandbyDate || '').trim().slice(0, 10);
  const work = (a.mobWorkingStartDate || '').trim().slice(0, 10);
  /** เริ่มรอบใหม่แล้ว (วันหลังวันจบ) — ไม่ถือว่าค้าง */
  if (/^\d{4}-\d{2}-\d{2}$/.test(standby) && standby > end) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(work) && work > end) return false;

  if (typeof a.mobReadyToTravelAt === 'number' && a.mobReadyToTravelAt > 0) return true;
  if (typeof a.mobStandbyRecordedAt === 'number' && a.mobStandbyRecordedAt > 0) return true;
  if (typeof a.mobWorkingStartedAt === 'number' && a.mobWorkingStartedAt > 0) return true;
  if (standby) return true;
  if (work) return true;
  if ((a.mobLocationKey || '').trim()) return true;
  if ((a.workLocation || '').trim()) return true;
  if (a.mobStandbyDayEventType || a.mobStep2Choice) return true;
  return false;
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

  const locKey = snapshot?.mobLocationKey;
  out.mobLocationKey = typeof locKey === 'string' && locKey.trim() ? locKey.trim() : del;
  const wl = snapshot?.workLocation;
  out.workLocation = typeof wl === 'string' && wl.trim() ? wl.trim() : del;

  const dayEt = snapshot?.mobStandbyDayEventType;
  out.mobStandbyDayEventType = dayEt === 'standby_day' || dayEt === 'mobilization_day' ? dayEt : del;

  const step2 = snapshot?.mobStep2Choice;
  out.mobStep2Choice = step2 === 'PRE_MOB' || step2 === 'MOB' ? step2 : del;
  out.mobStep2BillingCharge = snapshot?.mobStep2BillingCharge ?? del;
  out.mobStep2PayrollCharge = snapshot?.mobStep2PayrollCharge ?? del;

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
