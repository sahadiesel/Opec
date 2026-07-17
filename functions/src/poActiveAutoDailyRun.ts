import {
  FieldPath,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { DailyTimesheetSchema } from './dailyTimesheetSchema';
import {
  buildPoActiveAutoDailyRowPayload,
  buildPoActiveAutoStandbyRowPayload,
  computePoActiveAutoDailyRange,
  isAssignmentEligibleForPoActiveAutoDaily,
  poActiveDailyTimesheetDocId,
  resolvePoActiveAutoDailySyncKind,
  normalizePoActiveBundleId,
  poTimesheetScopeId,
  resolvePoActiveBundleKeyForPo,
  thailandTodayYmd,
  type AssignmentLike,
  type DailyTimesheetLike,
  type POLineLike,
  type PurchaseOrderLike,
} from './poActiveAutoDailyPure';

export const PO_ACTIVE_AUTO_DAILY_FN_ACTOR = 'cloudfn:poActiveAutoDailySchedule';

export type SyncTotals = {
  scanned: number;
  eligible: number;
  created: number;
  updated: number;
  skipped: number;
  outOfRange: number;
  errors: number;
};

type LaborCostContractTerm = {
  id: string;
  effectiveDate: string;
  endDate: string;
};

type WorkerLike = { firstName?: string; lastName?: string };

function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (out[k as keyof T] === undefined) delete out[k as keyof T];
  }
  return out;
}

function isTimesheetFinanciallyImmutable(status: string | undefined): boolean {
  return ['CLIENT_APPROVED', 'VERIFIED_PAPER', 'LOCKED'].includes(status || '');
}

function pickLaborCostTermIdForDate(terms: LaborCostContractTerm[], date: string): string | undefined {
  const hit = terms.find((t) => t.effectiveDate <= date && t.endDate >= date);
  if (hit) return hit.id;
  return terms[0]?.id;
}

async function loadLaborCostTermsForPo(db: Firestore, purchaseOrderId: string): Promise<LaborCostContractTerm[]> {
  const snap = await db
    .collection('labor_cost_contract_terms')
    .where('relatedPurchaseOrderId', '==', purchaseOrderId)
    .where('status', '==', 'ACTIVE')
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as LaborCostContractTerm));
}

function ymdInRangeInclusive(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

async function isPoActiveBundleAutoDailyDisabled(db: Firestore, bundleId: string): Promise<boolean> {
  const id = normalizePoActiveBundleId(bundleId);
  if (!id || id.startsWith('orphan:')) return false;
  const snap = await db.collection('po_active_bundles').doc(id).get();
  if (!snap.exists) return false;
  return snap.data()?.poActiveAutoDailyDisabled === true;
}

/**
 * เติม daily_timesheets ของวันนี้ (Bangkok) เท่านั้น — ประหยัดอ่าน/เขียนเมื่อรันจาก Scheduler
 */
export async function syncTodayOnlyForMobilization(
  db: Firestore,
  assignment: AssignmentLike,
  totals: SyncTotals,
): Promise<void> {
  let a = assignment;
  const mobRef = db.collection('mobilizations').doc(assignment.id);
  if (
    a.deploymentStatus === 'ACTIVE' &&
    !(typeof a.unassignedAt === 'number' && a.unassignedAt > 0) &&
    !(a.waveId || '').trim() &&
    (a.poId || '').trim()
  ) {
    const wid = poTimesheetScopeId(a.poId!.trim());
    await mobRef.update({ waveId: wid, updatedAt: Date.now() });
    a = { ...a, waveId: wid };
  }

  if (!isAssignmentEligibleForPoActiveAutoDaily(a)) {
    return;
  }

  const poRef = db.collection('purchase_orders').doc(a.poId!);
  const poSnap = await poRef.get();
  if (!poSnap.exists) return;
  const po = { id: poSnap.id, ...(poSnap.data() as object) } as PurchaseOrderLike;

  const bundleIdForSwitch = resolvePoActiveBundleKeyForPo(po);
  if (await isPoActiveBundleAutoDailyDisabled(db, bundleIdForSwitch)) {
    totals.skipped++;
    return;
  }

  totals.eligible++;

  const lineSnap = await poRef.collection('po_lines').doc(a.poLineId!).get();
  if (!lineSnap.exists) return;
  const line = { id: lineSnap.id, ...(lineSnap.data() as object) } as POLineLike;

  const range = computePoActiveAutoDailyRange(a, po);
  if (!range) return;

  const today = thailandTodayYmd();
  if (!ymdInRangeInclusive(today, range.start, range.end)) {
    totals.outOfRange++;
    return;
  }

  const syncKind = resolvePoActiveAutoDailySyncKind(a, today);
  if (!syncKind) {
    totals.skipped++;
    return;
  }

  let workerName = (a.workerName || '').trim();
  if (!workerName) {
    const wSnap = await db.collection('workers').doc(a.workerId!).get();
    if (wSnap.exists) {
      const w = wSnap.data() as WorkerLike;
      workerName = `${w.firstName || ''} ${w.lastName || ''}`.trim();
    }
  }
  if (!workerName) workerName = a.workerId!;

  const bundleId = resolvePoActiveBundleKeyForPo(po);
  const laborTerms = await loadLaborCostTermsForPo(db, po.id);
  const laborCostContractTermId = pickLaborCostTermIdForDate(laborTerms, today);

  const id = poActiveDailyTimesheetDocId(a.workerId!, a.id, today);
  const dRef = db.collection('daily_timesheets').doc(id);
  const existing = await dRef.get();

  const now = Date.now();
  const rowParams = {
    assignment: a,
    po,
    line,
    date: today,
    workerNameSnapshot: workerName,
    poActiveBundleId: bundleId,
    laborCostContractTermId,
  };
  const basePayload =
    syncKind === 'standby_day'
      ? buildPoActiveAutoStandbyRowPayload(rowParams)
      : buildPoActiveAutoDailyRowPayload(rowParams);

  if (existing.exists) {
    const cur = existing.data() as DailyTimesheetLike;
    if (isTimesheetFinanciallyImmutable(cur.status)) {
      totals.skipped++;
      return;
    }
    if (cur.poActiveAutoDaily !== true) {
      totals.skipped++;
      return;
    }
    const curEvent = String(cur.eventType || '');
    if (
      curEvent === 'mobilization_day' ||
      curEvent === 'demobilization_day' ||
      (curEvent !== syncKind && curEvent !== 'work_day' && curEvent !== 'standby_day')
    ) {
      totals.skipped++;
      return;
    }
    await dRef.update(
      omitUndefined({
        ...basePayload,
        updatedAt: now,
        officeEnteredBy: PO_ACTIVE_AUTO_DAILY_FN_ACTOR,
        officeEnteredAt: now,
      }) as DocumentData,
    );
    totals.updated++;
    return;
  }

  const parsed = DailyTimesheetSchema.parse({
    ...basePayload,
    id,
    createdAt: now,
    updatedAt: now,
    officeEnteredBy: PO_ACTIVE_AUTO_DAILY_FN_ACTOR,
    officeEnteredAt: now,
  });
  await dRef.set(omitUndefined({ ...parsed } as Record<string, unknown>) as DocumentData);
  totals.created++;
}

const PAGE = 400;

/**
 * วนทุก mobilization ที่ deploymentStatus === ACTIVE (pagination)
 */
export async function runPoActiveAutoDailyScheduledJob(db: Firestore): Promise<SyncTotals> {
  const totals: SyncTotals = {
    scanned: 0,
    eligible: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    outOfRange: 0,
    errors: 0,
  };

  let last: QueryDocumentSnapshot | undefined;

  for (;;) {
    let q = db
      .collection('mobilizations')
      .where('deploymentStatus', '==', 'ACTIVE')
      .orderBy(FieldPath.documentId())
      .limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const d of snap.docs) {
      totals.scanned++;
      const assignment = { id: d.id, ...(d.data() as object) } as AssignmentLike;
      try {
        await syncTodayOnlyForMobilization(db, assignment, totals);
      } catch (e) {
        totals.errors++;
        logger.warn('[poActiveAutoDailySchedule] skip mobilization', {
          id: d.id,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  return totals;
}
