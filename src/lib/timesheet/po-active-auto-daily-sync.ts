/**
 * เฟส 4 — ซิงค์ daily_timesheets แบบ work_day ตามช่วง mobilization (Asia/Bangkok)
 * ไม่ทับแถวที่ปิดการเงินแล้ว หรือแถวที่ไม่มี poActiveAutoDaily (แก้มือ)
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import type { Assignment, DailyTimesheet, LaborCostContractTerm, POLine, PurchaseOrder, User, Worker } from '@/lib/types';
import { DailyTimesheetSchema } from '@/lib/validations/timesheet-schemas';
import { assertPayrollPermission } from '@/lib/permissions';
import { resolvePoActiveBundleKeyForPo } from '@/lib/ops/po-active-bundle';
import {
  buildPoActiveAutoDailyRowPayload,
  buildPoActiveAutoStandbyRowPayload,
  computePoActiveAutoDailyRange,
  eachYmdInRange,
  isAssignmentEligibleForPoActiveAutoDaily,
  PO_ACTIVE_STANDBY_STOP_AUTO_DAYS,
  poActiveDailyTimesheetDocId,
  resolvePoActiveAutoDailySyncKind,
} from '@/lib/timesheet/po-active-auto-daily-build';
import { addDaysToYmd, thailandTodayYmd } from '@/lib/ops/mobilization-final-clearance';

export type PoActiveAutoDailySyncOptions = {
  /** เติมเฉพาะ yyyy-mm-dd ปัจจุบันในเขตไทย — ใช้หลังเที่ยงคืนหรือเปิดกระดาน */
  todayOnly?: boolean;
};

function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (out[k as keyof T] === undefined) delete out[k as keyof T];
  }
  return out;
}

export { poActiveDailyTimesheetDocId };

function isTimesheetFinanciallyImmutable(status: string | undefined): boolean {
  return ['CLIENT_APPROVED', 'VERIFIED_PAPER', 'LOCKED'].includes(status || '');
}

async function loadLaborCostTermsForPo(
  db: Firestore,
  purchaseOrderId: string,
): Promise<LaborCostContractTerm[]> {
  const q = query(
    collection(db, 'labor_cost_contract_terms'),
    where('relatedPurchaseOrderId', '==', purchaseOrderId),
    where('status', '==', 'ACTIVE'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as LaborCostContractTerm));
}

function pickLaborCostTermIdForDate(terms: LaborCostContractTerm[], date: string): string | undefined {
  const hit = terms.find((t) => t.effectiveDate <= date && t.endDate >= date);
  if (hit) return hit.id;
  return terms[0]?.id;
}

export async function syncPoActiveAutoDailyForAssignment(
  db: Firestore,
  assignmentId: string,
  user: User,
  options?: PoActiveAutoDailySyncOptions,
): Promise<{ created: number; updated: number; skipped: number }> {
  assertPayrollPermission(user, 'timesheet', 'edit');

  const mobRef = doc(db, 'mobilizations', assignmentId);
  const mobSnap = await getDoc(mobRef);
  if (!mobSnap.exists()) {
    throw new Error('ไม่พบ mobilization');
  }
  const assignment = { id: mobSnap.id, ...(mobSnap.data() as object) } as Assignment;

  if (!isAssignmentEligibleForPoActiveAutoDaily(assignment)) {
    return { created: 0, updated: 0, skipped: 0 };
  }

  const poSnap = await getDoc(doc(db, 'purchase_orders', assignment.poId));
  if (!poSnap.exists()) throw new Error('ไม่พบ PO');
  const po = { id: poSnap.id, ...(poSnap.data() as object) } as PurchaseOrder;

  const lineSnap = await getDoc(doc(db, 'purchase_orders', assignment.poId, 'po_lines', assignment.poLineId));
  if (!lineSnap.exists()) throw new Error('ไม่พบ PO line');
  const line = { id: lineSnap.id, ...(lineSnap.data() as object) } as POLine;

  const range = computePoActiveAutoDailyRange(assignment, po);
  if (!range) {
    return { created: 0, updated: 0, skipped: 0 };
  }

  const rangeDates = [...eachYmdInRange(range.start, range.end)];
  const todayYmd = thailandTodayYmd();
  const datesToSync = options?.todayOnly ? rangeDates.filter((d) => d === todayYmd) : rangeDates;

  const eligibleDates = datesToSync.filter((d) => resolvePoActiveAutoDailySyncKind(assignment, d) !== null);
  if (eligibleDates.length === 0) {
    return { created: 0, updated: 0, skipped: 0 };
  }

  let workerName = (assignment.workerName || '').trim();
  if (!workerName) {
    const wSnap = await getDoc(doc(db, 'workers', assignment.workerId));
    if (wSnap.exists()) {
      const w = wSnap.data() as Worker;
      workerName = `${w.firstName || ''} ${w.lastName || ''}`.trim();
    }
  }
  if (!workerName) workerName = assignment.workerId;

  const bundleId = resolvePoActiveBundleKeyForPo(po);
  const laborTerms = await loadLaborCostTermsForPo(db, po.id);

  const tsCol = collection(db, 'daily_timesheets');
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let batch = writeBatch(db);
  let batchCount = 0;
  const now = Date.now();

  const flush = async () => {
    if (batchCount === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    batchCount = 0;
  };

  for (const date of eligibleDates) {
    const kind = resolvePoActiveAutoDailySyncKind(assignment, date);
    if (!kind) {
      skipped++;
      continue;
    }

    const id = poActiveDailyTimesheetDocId(assignment.workerId, assignment.id, date);
    const dRef = doc(tsCol, id);
    const existing = await getDoc(dRef);

    const laborCostContractTermId = pickLaborCostTermIdForDate(laborTerms, date);

    const rowParams = {
      assignment,
      po,
      line,
      date,
      workerNameSnapshot: workerName,
      poActiveBundleId: bundleId,
      laborCostContractTermId,
    };
    const basePayload =
      kind === 'standby_day'
        ? buildPoActiveAutoStandbyRowPayload(rowParams)
        : buildPoActiveAutoDailyRowPayload(rowParams);

    if (existing.exists()) {
      const cur = existing.data() as DailyTimesheet;
      if (isTimesheetFinanciallyImmutable(cur.status)) {
        skipped++;
        continue;
      }
      if (cur.poActiveAutoDaily !== true) {
        skipped++;
        continue;
      }
      batch.update(
        dRef,
        omitUndefined({
          ...basePayload,
          updatedAt: now,
          officeEnteredBy: user.displayName,
          officeEnteredAt: now,
        } as Record<string, unknown>) as DocumentData,
      );
      updated++;
    } else {
      const parsed = DailyTimesheetSchema.parse({
        ...basePayload,
        id,
        createdAt: now,
        updatedAt: now,
        officeEnteredBy: user.displayName,
        officeEnteredAt: now,
      });
      batch.set(dRef, omitUndefined({ ...parsed } as Record<string, unknown>) as DocumentData);
      created++;
    }

    batchCount++;
    if (batchCount >= 400) await flush();
  }

  await flush();
  return { created, updated, skipped };
}

/**
 * หยุดแบบ standby — เติม SB อัตโนมัติ N วัน แล้วระงับ work_day จนกว่าจะเริ่มงานใหม่ที่ Mobilization
 */
export async function applyPoActiveStandbyStopWindow(
  db: Firestore,
  assignmentId: string,
  user: User,
  timing: 'today' | 'tomorrow',
): Promise<{ startYmd: string; endYmd: string; rowsWritten: number }> {
  assertPayrollPermission(user, 'timesheet', 'edit');

  const mobRef = doc(db, 'mobilizations', assignmentId);
  const mobSnap = await getDoc(mobRef);
  if (!mobSnap.exists()) throw new Error('ไม่พบ mobilization');
  const assignment = { id: mobSnap.id, ...(mobSnap.data() as object) } as Assignment;

  if (!isAssignmentEligibleForPoActiveAutoDaily(assignment)) {
    throw new Error('เฉพาะรายที่ ACTIVE และผูก PO/Wave ครบเท่านั้น');
  }

  const today = thailandTodayYmd();
  const startYmd = timing === 'today' ? today : addDaysToYmd(today, 1);
  const endYmd = addDaysToYmd(startYmd, PO_ACTIVE_STANDBY_STOP_AUTO_DAYS - 1);

  const floor = ((assignment.mobWorkingStartDate || assignment.startDate || '') as string).trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(floor) && startYmd < floor) {
    throw new Error(`วันเริ่มช่วง SB ต้องไม่ก่อนวันเริ่มทำงาน / มอบหมาย (${floor})`);
  }

  const poSnap = await getDoc(doc(db, 'purchase_orders', assignment.poId));
  if (!poSnap.exists()) throw new Error('ไม่พบ PO');
  const po = { id: poSnap.id, ...(poSnap.data() as object) } as PurchaseOrder;

  const lineSnap = await getDoc(doc(db, 'purchase_orders', assignment.poId, 'po_lines', assignment.poLineId));
  if (!lineSnap.exists()) throw new Error('ไม่พบ PO line');
  const line = { id: lineSnap.id, ...(lineSnap.data() as object) } as POLine;

  const range = computePoActiveAutoDailyRange(assignment, po);
  if (!range) throw new Error('ไม่สามารถคำนวณช่วงลงเวลาอัตโนมัติได้');

  let workerName = (assignment.workerName || '').trim();
  if (!workerName) {
    const wSnap = await getDoc(doc(db, 'workers', assignment.workerId));
    if (wSnap.exists()) {
      const w = wSnap.data() as Worker;
      workerName = `${w.firstName || ''} ${w.lastName || ''}`.trim();
    }
  }
  if (!workerName) workerName = assignment.workerId;

  const bundleId = resolvePoActiveBundleKeyForPo(po);
  const laborTerms = await loadLaborCostTermsForPo(db, po.id);
  const tsCol = collection(db, 'daily_timesheets');
  let rowsWritten = 0;
  let batch = writeBatch(db);
  let batchCount = 0;
  const now = Date.now();

  const flush = async () => {
    if (batchCount === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    batchCount = 0;
  };

  for (const date of eachYmdInRange(startYmd, endYmd)) {
    if (date < range.start || date > range.end) continue;

    const id = poActiveDailyTimesheetDocId(assignment.workerId, assignment.id, date);
    const dRef = doc(tsCol, id);
    const existing = await getDoc(dRef);

    const laborCostContractTermId = pickLaborCostTermIdForDate(laborTerms, date);
    const basePayload = buildPoActiveAutoStandbyRowPayload({
      assignment,
      po,
      line,
      date,
      workerNameSnapshot: workerName,
      poActiveBundleId: bundleId,
      laborCostContractTermId,
    });

    if (existing.exists()) {
      const cur = existing.data() as DailyTimesheet;
      if (isTimesheetFinanciallyImmutable(cur.status)) continue;
      if (cur.poActiveAutoDaily !== true) continue;
      batch.update(
        dRef,
        omitUndefined({
          ...basePayload,
          updatedAt: now,
          officeEnteredBy: user.displayName,
          officeEnteredAt: now,
        } as Record<string, unknown>) as DocumentData,
      );
      rowsWritten++;
    } else {
      const parsed = DailyTimesheetSchema.parse({
        ...basePayload,
        id,
        createdAt: now,
        updatedAt: now,
        officeEnteredBy: user.displayName,
        officeEnteredAt: now,
      });
      batch.set(dRef, omitUndefined({ ...parsed } as Record<string, unknown>) as DocumentData);
      rowsWritten++;
    }

    batchCount++;
    if (batchCount >= 400) await flush();
  }

  await flush();

  if (rowsWritten === 0) {
    throw new Error('ไม่มีวันในช่วง SB ที่อยู่ในช่วงลงเวลาอัตโนมัติ — ตรวจเพดาน PO / วันจบงาน');
  }

  batch.update(mobRef, {
    poActiveAutoWorkSuspended: true,
    poActiveStandbyAutoStartYmd: startYmd,
    poActiveStandbyAutoEndYmd: endYmd,
    updatedAt: now,
    updatedBy: user.id,
  } as DocumentData);
  await batch.commit();

  return { startYmd, endYmd, rowsWritten };
}
