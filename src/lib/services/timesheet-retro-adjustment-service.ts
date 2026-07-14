'use client';

import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  deleteField,
  type Firestore,
} from 'firebase/firestore';
import type { DailyTimesheet, PriorPeriodAllowanceItem, TimesheetRetroAdjustment, User } from '@/lib/types';
import {
  computeRetroAdjustmentPayFromFirestore,
  retroHoursDeltaFromAdjustment,
  RetroRateMatrixMissingError,
} from '@/lib/payroll/retro-adjustment-pay';
import { sanitizeFirestorePayload } from '@/lib/utils';
import { writeAuditLog } from './audit-service';
import { canAccess, canEdit } from '@/lib/permissions';

const COLLECTION = 'timesheet_retro_adjustments';

function canManageRetro(user: User): boolean {
  return canEdit(user, 'timesheets') || canAccess(user, 'timesheets', 'edit');
}

export async function createTimesheetRetroAdjustment(
  db: Firestore,
  user: User,
  input: {
    sourceTimesheet: DailyTimesheet;
    sourceYearMonth: string;
    applyPayrollYearMonth: string;
    addedOt15Hours?: number;
    addedOt20Hours?: number;
    addedOt30Hours?: number;
    addedStandbyHours?: number;
    addedM1Trips?: number;
    addedD1Trips?: number;
    reason: string;
  },
): Promise<string> {
  if (!canManageRetro(user)) throw new Error('ไม่มีสิทธิ์บันทึกแก้ไขย้อนหลัง timesheet');

  const ot15 = Math.max(0, Number(input.addedOt15Hours) || 0);
  const ot20 = Math.max(0, Number(input.addedOt20Hours) || 0);
  const ot30 = Math.max(0, Number(input.addedOt30Hours) || 0);
  const standby = Math.max(0, Number(input.addedStandbyHours) || 0);
  const m1Trips = Math.max(0, Number(input.addedM1Trips) || 0);
  const d1Trips = Math.max(0, Number(input.addedD1Trips) || 0);
  const reason = String(input.reason || '').trim();
  if (!reason) throw new Error('กรุณาระบุเหตุผลการแก้ไข');
  if (ot15 + ot20 + ot30 + standby + m1Trips + d1Trips <= 0) {
    throw new Error('กรุณาระบุชม. OT / standby / M1 / D1 ที่เพิ่มอย่างน้อย 1 ค่า');
  }
  if (!/^\d{4}-\d{2}$/.test(input.sourceYearMonth) || !/^\d{4}-\d{2}$/.test(input.applyPayrollYearMonth)) {
    throw new Error('รูปแบบงวด YYYY-MM ไม่ถูกต้อง');
  }

  const ts = input.sourceTimesheet;
  const now = Date.now();
  const delta = retroHoursDeltaFromAdjustment({
    addedOt15Hours: ot15,
    addedOt20Hours: ot20,
    addedOt30Hours: ot30,
    addedStandbyHours: standby,
    addedM1Trips: m1Trips,
    addedD1Trips: d1Trips,
  });
  let computedPayAmountBaht = 0;
  const payResult = await computeRetroAdjustmentPayFromFirestore(db, ts, delta);
  if (!payResult.ok && payResult.missingRates.length > 0) {
    throw new RetroRateMatrixMissingError(payResult.missingRates, payResult.contractId, payResult.positionId);
  }
  computedPayAmountBaht = payResult.amountBaht;
  if (computedPayAmountBaht <= 0 && ot15 + ot20 + ot30 + standby + m1Trips + d1Trips > 0) {
    throw new Error('คำนวณยอดไม่ได้ — ตรวจสอบอัตราในตารางสัญญา (ฝั่งต้นทุน Cost)');
  }

  const payload = sanitizeFirestorePayload({
    sourceTimesheetId: ts.id,
    workerId: ts.workerId,
    workerNameSnapshot: ts.workerNameSnapshot || ts.workerId,
    assignmentId: ts.assignmentId,
    purchaseOrderId: ts.purchaseOrderId,
    waveId: ts.waveId,
    workDateYmd: String(ts.date || '').slice(0, 10),
    sourceYearMonth: input.sourceYearMonth,
    applyPayrollYearMonth: input.applyPayrollYearMonth,
    ...(ot15 > 0 ? { addedOt15Hours: ot15 } : {}),
    ...(ot20 > 0 ? { addedOt20Hours: ot20 } : {}),
    ...(ot30 > 0 ? { addedOt30Hours: ot30 } : {}),
    ...(standby > 0 ? { addedStandbyHours: standby } : {}),
    ...(m1Trips > 0 ? { addedM1Trips: m1Trips } : {}),
    ...(d1Trips > 0 ? { addedD1Trips: d1Trips } : {}),
    reason,
    ...(computedPayAmountBaht > 0 ? { computedPayAmountBaht, computedPaySnapshotAt: now } : {}),
    status: 'approved' as const,
    requestedByUserId: user.id,
    requestedByName: user.displayName || user.email || user.id,
    requestedAt: now,
    updatedAt: now,
  });

  const ref = await addDoc(collection(db, COLLECTION), payload);
  await writeAuditLog(db, user, {
    actionType: 'CREATE',
    entityType: 'TimesheetRetroAdjustment',
    entityId: ref.id,
    timesheetId: ts.id,
    sourceModule: 'operations',
    afterSummary: `Retro adjustment ${ts.date}: +OT15=${ot15} +SB=${standby} +M1=${m1Trips} +D1=${d1Trips} → pay in ${input.applyPayrollYearMonth}`,
  });
  return ref.id;
}

export async function loadTimesheetRetroAdjustmentsForMonth(
  db: Firestore,
  sourceYearMonth: string,
): Promise<TimesheetRetroAdjustment[]> {
  const ym = sourceYearMonth.trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return [];
  const snap = await getDocs(
    query(collection(db, COLLECTION), where('sourceYearMonth', '==', ym)),
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) } as TimesheetRetroAdjustment))
    .filter((r) => r.status !== 'void');
}

/** Retro ในช่วงวันที่ของ assignment — ใช้ trip billing รวม OT แก้ไขย้อนหลัง */
export async function loadRetroAdjustmentsForAssignmentDateRange(
  db: Firestore,
  assignmentId: string,
  startYmd: string,
  endYmd: string,
): Promise<TimesheetRetroAdjustment[]> {
  const aid = assignmentId.trim();
  const start = startYmd.slice(0, 10);
  const end = endYmd.slice(0, 10);
  if (!aid || !start || !end || start > end) return [];
  const snap = await getDocs(
    query(
      collection(db, COLLECTION),
      where('assignmentId', '==', aid),
      where('workDateYmd', '>=', start),
      where('workDateYmd', '<=', end),
    ),
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) } as TimesheetRetroAdjustment))
    .filter((r) => r.status !== 'void');
}

export async function loadPendingRetroForWorkerPayrollMonth(
  db: Firestore,
  workerId: string,
  applyPayrollYearMonth: string,
): Promise<TimesheetRetroAdjustment[]> {
  const ym = applyPayrollYearMonth.trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return [];
  const snap = await getDocs(
    query(
      collection(db, COLLECTION),
      where('workerId', '==', workerId),
      where('applyPayrollYearMonth', '==', ym),
    ),
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) } as TimesheetRetroAdjustment))
    .filter((r) => r.status === 'approved');
}

/** คำนวณ/ดึงยอดบาทสำหรับนำเข้า payroll — ใช้ snapshot หรือคำนวณใหม่ */
export async function resolveRetroAdjustmentPayBaht(
  db: Firestore,
  adjustment: TimesheetRetroAdjustment,
  sourceTimesheet?: DailyTimesheet | null,
): Promise<number> {
  const stored = Number(adjustment.computedPayAmountBaht);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored * 100) / 100;

  let ts = sourceTimesheet ?? null;
  if (!ts) {
    const { getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'daily_timesheets', adjustment.sourceTimesheetId));
    if (snap.exists()) ts = { id: snap.id, ...(snap.data() as object) } as DailyTimesheet;
  }
  if (!ts) return 0;

  const payResult = await computeRetroAdjustmentPayFromFirestore(
    db,
    ts,
    retroHoursDeltaFromAdjustment(adjustment),
  );
  if (payResult.ok) return payResult.amountBaht;
  return 0;
}

export async function retroAdjustmentsToPriorPeriodItemsWithPay(
  db: Firestore,
  items: readonly TimesheetRetroAdjustment[],
): Promise<PriorPeriodAllowanceItem[]> {
  const out: PriorPeriodAllowanceItem[] = [];
  for (const r of items) {
    const amount = await resolveRetroAdjustmentPayBaht(db, r);
    out.push({
      sourceYearMonth: r.sourceYearMonth,
      label: formatRetroAdjustmentSummaryLabel(r),
      amount,
    });
  }
  return out;
}

export function retroAdjustmentsToPriorPeriodLabels(
  items: readonly TimesheetRetroAdjustment[],
): PriorPeriodAllowanceItem[] {
  const byMonth = new Map<string, TimesheetRetroAdjustment[]>();
  for (const r of items) {
    const list = byMonth.get(r.sourceYearMonth) ?? [];
    list.push(r);
    byMonth.set(r.sourceYearMonth, list);
  }
  const out: PriorPeriodAllowanceItem[] = [];
  for (const [sourceYearMonth, rows] of byMonth) {
    for (const r of rows) {
      const parts: string[] = [];
      const dt = `(${r.workDateYmd.slice(8, 10)}/${r.workDateYmd.slice(5, 7)})`;
      if ((r.addedOt15Hours || 0) > 0) parts.push(`OT1.5 +${r.addedOt15Hours} ชม. ${dt}`);
      if ((r.addedOt20Hours || 0) > 0) parts.push(`OT2.0 +${r.addedOt20Hours} ชม. ${dt}`);
      if ((r.addedOt30Hours || 0) > 0) parts.push(`OT3.0 +${r.addedOt30Hours} ชม. ${dt}`);
      if ((r.addedStandbyHours || 0) > 0) parts.push(`Standby/M1 +${r.addedStandbyHours} ชม. ${dt}`);
      if ((r.addedM1Trips || 0) > 0) parts.push(`M1 +${r.addedM1Trips} trip ${dt}`);
      if ((r.addedD1Trips || 0) > 0) parts.push(`D1 +${r.addedD1Trips} trip ${dt}`);

      const srcYm = String(r.sourceYearMonth || '').trim();
      const srcBit = /^\d{4}-\d{2}$/.test(srcYm) ? `งวด ${srcYm} · ` : '';
      const label = `[${srcBit}แก้ไขย้อนหลัง] ${parts.join(' · ')} — ${r.reason}`.slice(0, 200);
      out.push({
        sourceYearMonth,
        label,
        amount: 0,
      });
    }
  }
  return out;
}

/** แปลง retro เป็นบรรทัด prior-period สำหรับ payroll — ต้องใส่ amount เองหรือคำนวณจาก gross diff */
export function formatRetroAdjustmentSummaryLabel(r: TimesheetRetroAdjustment): string {
  const parts: string[] = [];
  const dt = `(${r.workDateYmd.slice(8, 10)}/${r.workDateYmd.slice(5, 7)})`;
  
  if ((r.addedOt15Hours || 0) > 0) parts.push(`OT1.5 +${r.addedOt15Hours} ชม. ${dt}`);
  if ((r.addedOt20Hours || 0) > 0) parts.push(`OT2.0 +${r.addedOt20Hours} ชม. ${dt}`);
  if ((r.addedOt30Hours || 0) > 0) parts.push(`OT3.0 +${r.addedOt30Hours} ชม. ${dt}`);
  if ((r.addedStandbyHours || 0) > 0) parts.push(`Standby/M1 +${r.addedStandbyHours} ชม. ${dt}`);
  if ((r.addedM1Trips || 0) > 0) parts.push(`M1 +${r.addedM1Trips} trip ${dt}`);
  if ((r.addedD1Trips || 0) > 0) parts.push(`D1 +${r.addedD1Trips} trip ${dt}`);
  
  const srcYm = String(r.sourceYearMonth || '').trim();
  const srcBit = /^\d{4}-\d{2}$/.test(srcYm) ? `งวด ${srcYm} · ` : '';
  return `[${srcBit}แก้ไขย้อนหลัง] ${parts.join(' · ')} — ${r.reason}`.slice(0, 180);
}

/**
 * คำเตือนบนใบแจ้งหนี้ Trip — แยกจาก payroll รายเดือน
 * (เรียกเก็บลูกค้าด้วยอัตราขาย · จ่ายลูกจ้างใน payroll งวด applyPayrollYearMonth)
 */
export function buildTripCommercialRetroBillingWarnings(
  retros: readonly TimesheetRetroAdjustment[],
): string[] {
  const active = retros.filter((r) => r.status !== 'void');
  if (active.length === 0) return [];

  const bySource = new Map<string, TimesheetRetroAdjustment[]>();
  for (const r of active) {
    const ym = String(r.sourceYearMonth || '').trim() || '?';
    const list = bySource.get(ym) ?? [];
    list.push(r);
    bySource.set(ym, list);
  }

  const out: string[] = [];
  for (const [sourceYm, rows] of bySource) {
    const otH = rows.reduce(
      (s, r) =>
        s +
        Math.max(0, Number(r.addedOt15Hours) || 0) +
        Math.max(0, Number(r.addedOt20Hours) || 0) +
        Math.max(0, Number(r.addedOt30Hours) || 0),
      0,
    );
    const m1Trips = rows.reduce((s, r) => s + Math.max(0, Number(r.addedM1Trips) || 0), 0);
    const payYm =
      rows.map((r) => String(r.applyPayrollYearMonth || '').trim()).find((x) => /^\d{4}-\d{2}$/.test(x)) ||
      '—';
    const detail: string[] = [];
    if (otH > 0) detail.push(`OT +${otH} ชม.`);
    if (m1Trips > 0) detail.push(`M1 +${m1Trips} trip`);
    if (detail.length === 0) detail.push(`${rows.length} รายการ`);

    out.push(
      `Trip billing (เรียกเก็บลูกค้า · อัตราขาย): รวมแก้ไขย้อนหลังงวด ${sourceYm} (${detail.join(', ')}) — ` +
        `การจ่ายลูกจ้างแยกใน payroll งวด ${payYm} (สลิป: «ส่วนเพิ่มจากงวด…») · ไม่ปน payroll รายเดือน`,
    );
  }
  return out;
}

export async function markRetroAdjustmentsApplied(
  db: Firestore,
  user: User,
  adjustmentIds: readonly string[],
  payrollBatchId: string,
  payrollWorkerLineId: string,
): Promise<void> {
  const now = Date.now();
  for (const id of adjustmentIds) {
    await updateDoc(doc(db, COLLECTION, id), {
      status: 'applied',
      appliedAt: now,
      appliedPayrollBatchId: payrollBatchId,
      payrollWorkerLineId,
      updatedAt: now,
    });
  }
  if (adjustmentIds.length > 0) {
    await writeAuditLog(db, user, {
      actionType: 'UPDATE',
      entityType: 'TimesheetRetroAdjustment',
      entityId: adjustmentIds.join(','),
      payrollBatchId,
      sourceModule: 'hr',
      afterSummary: `Marked ${adjustmentIds.length} retro adjustment(s) applied on payroll line`,
    });
  }
}

export async function revertRetroAdjustmentsForPayrollBatch(
  db: Firestore,
  user: User,
  payrollBatchId: string,
): Promise<void> {
  const q = query(
    collection(db, COLLECTION),
    where('appliedPayrollBatchId', '==', payrollBatchId)
  );
  const snap = await getDocs(q);
  if (snap.empty) return;
  
  const now = Date.now();
  for (const docSnap of snap.docs) {
    await updateDoc(doc(db, COLLECTION, docSnap.id), {
      status: 'approved',
      appliedAt: deleteField(),
      appliedPayrollBatchId: deleteField(),
      payrollWorkerLineId: deleteField(),
      updatedAt: now,
    });
  }
  
  await writeAuditLog(db, user, {
    actionType: 'UPDATE',
    entityType: 'TimesheetRetroAdjustment',
    entityId: snap.docs.map(d => d.id).join(','),
    payrollBatchId,
    sourceModule: 'hr',
    afterSummary: `Reverted ${snap.size} retro adjustment(s) to approved because payroll batch was deleted`,
  });
}
