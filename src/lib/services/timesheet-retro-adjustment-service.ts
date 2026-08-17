'use client';

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  deleteField,
  type Firestore,
} from 'firebase/firestore';
import type { DailyTimesheet, PriorPeriodAllowanceItem, RateConditionEventType, TimesheetRetroAdjustment, User } from '@/lib/types';
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
    /** เมื่อเปลี่ยน/ระบุประเภทวัน (เช่น ยังไม่มีใบงานต้นทาง) */
    retroEventType?: RateConditionEventType;
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
  const payTs = input.retroEventType ? { ...ts, eventType: input.retroEventType } : ts;
  const payResult = await computeRetroAdjustmentPayFromFirestore(db, payTs, delta);
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
    ...(input.retroEventType ? { retroEventType: input.retroEventType } : {}),
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

function sumRetroOtHours(r: TimesheetRetroAdjustment): number {
  return (
    Math.max(0, Number(r.addedOt15Hours) || 0) +
    Math.max(0, Number(r.addedOt20Hours) || 0) +
    Math.max(0, Number(r.addedOt30Hours) || 0)
  );
}

/** โหลดรายการแก้ไขย้อนหลังของใบงาน (ไม่รวม void) */
export async function loadTimesheetRetroAdjustmentsForTimesheet(
  db: Firestore,
  sourceTimesheetId: string,
): Promise<TimesheetRetroAdjustment[]> {
  const tid = String(sourceTimesheetId || '').trim();
  if (!tid) return [];
  const snap = await getDocs(
    query(collection(db, COLLECTION), where('sourceTimesheetId', '==', tid)),
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) } as TimesheetRetroAdjustment))
    .filter((r) => r.status !== 'void');
}

/** ยกเลิกรายการแก้ไขย้อนหลังที่ยังรอจ่าย (approved) ของใบงาน */
export async function voidApprovedRetroAdjustmentsForTimesheet(
  db: Firestore,
  user: User,
  sourceTimesheetId: string,
  reason: string,
): Promise<number> {
  if (!canManageRetro(user)) throw new Error('ไม่มีสิทธิ์ยกเลิกแก้ไขย้อนหลัง timesheet');
  const tid = String(sourceTimesheetId || '').trim();
  if (!tid) return 0;
  const note = String(reason || '').trim() || 'แทนที่ด้วยยอด OT ที่ต้องการ';
  const snap = await getDocs(
    query(collection(db, COLLECTION), where('sourceTimesheetId', '==', tid)),
  );
  const now = Date.now();
  let voided = 0;
  for (const d of snap.docs) {
    const row = { id: d.id, ...(d.data() as object) } as TimesheetRetroAdjustment;
    if (row.status !== 'approved') continue;
    await updateDoc(doc(db, COLLECTION, d.id), {
      status: 'void',
      updatedAt: now,
      voidReason: note,
      voidedByUserId: user.id,
      voidedAt: now,
    });
    voided += 1;
    await writeAuditLog(db, user, {
      actionType: 'UPDATE',
      entityType: 'TimesheetRetroAdjustment',
      entityId: d.id,
      timesheetId: tid,
      sourceModule: 'operations',
      afterSummary: `Void approved retro ${row.workDateYmd}: OT=${sumRetroOtHours(row)} — ${note}`,
    });
  }
  return voided;
}

/**
 * ตั้ง OT แก้ไขย้อนหลังแบบยอดรวมที่ต้องการบนตาราง (ไม่บวกทับ)
 * — ยกเลิก approved เดิมของใบงาน แล้วสร้างใหม่เท่าที่ยังขาดจากฐานสลิป + ที่จ่ายแล้ว (applied)
 */
export async function setAbsoluteWorkDayRetroOt(
  db: Firestore,
  user: User,
  input: {
    sourceTimesheet: DailyTimesheet;
    sourceYearMonth: string;
    applyPayrollYearMonth: string;
    /** ชม. OT รวมที่ต้องการให้แสดงบนตาราง (base + retro) */
    targetOtHours: number;
    /** ฐานบนใบงานที่นับเป็นของเดิม (LOCKED = ot บนสลิป; ยังไม่ล็อค = 0 เพราะจะย้ายออกจากใบงาน) */
    baseOtHoursOnSlip: number;
    reason: string;
  },
): Promise<{ createdId: string | null; voidedCount: number; addedOtHours: number }> {
  if (!canManageRetro(user)) throw new Error('ไม่มีสิทธิ์บันทึกแก้ไขย้อนหลัง timesheet');
  const ts = input.sourceTimesheet;
  const target = Math.max(0, Math.min(24, Number(input.targetOtHours) || 0));
  const base = Math.max(0, Number(input.baseOtHoursOnSlip) || 0);
  const reason = String(input.reason || '').trim();
  if (!reason) throw new Error('กรุณาระบุเหตุผลการแก้ไข');

  const existing = await loadTimesheetRetroAdjustmentsForTimesheet(db, ts.id);
  const appliedOt = existing
    .filter((r) => r.status === 'applied')
    .reduce((s, r) => s + sumRetroOtHours(r), 0);
  const approvedRows = existing.filter((r) => r.status === 'approved');

  const neededFromRetro = Math.max(0, target - base);
  const addedOtHours = Math.max(0, neededFromRetro - appliedOt);

  if (addedOtHours <= 0 && approvedRows.length === 0) {
    if (Math.abs(target - (base + appliedOt)) < 0.001) {
      throw new Error('ไม่มีรายการที่ต้องแก้ — OT รวมตรงกับของเดิมแล้ว');
    }
    throw new Error('ไม่มีรายการแก้ไขย้อนหลังรอจ่ายที่ต้องอัปเดต');
  }

  /** สร้างรายการใหม่ก่อน แล้วค่อย void ของเดิม — กันข้อมูลหายถ้าคำนวณยอดไม่ผ่าน */
  let createdId: string | null = null;
  if (addedOtHours > 0) {
    createdId = await createTimesheetRetroAdjustment(db, user, {
      sourceTimesheet: ts,
      sourceYearMonth: input.sourceYearMonth,
      applyPayrollYearMonth: input.applyPayrollYearMonth,
      addedOt15Hours: addedOtHours,
      reason,
    });
  }

  const now = Date.now();
  let voidedCount = 0;
  for (const row of approvedRows) {
    if (createdId && row.id === createdId) continue;
    await updateDoc(doc(db, COLLECTION, row.id), {
      status: 'void',
      updatedAt: now,
      voidReason: reason,
      voidedByUserId: user.id,
      voidedAt: now,
    });
    voidedCount += 1;
    await writeAuditLog(db, user, {
      actionType: 'UPDATE',
      entityType: 'TimesheetRetroAdjustment',
      entityId: row.id,
      timesheetId: ts.id,
      sourceModule: 'operations',
      afterSummary: `Void approved retro ${row.workDateYmd}: OT=${sumRetroOtHours(row)} — replaced by absolute OT ${target}`,
    });
  }

  return { createdId, voidedCount, addedOtHours };
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

/** คำนวณ/ดึงยอดบาทสำหรับนำเข้า payroll — คำนวณจาก rate matrix เสมอ (ไม่เชื่อ snapshot) */
export async function resolveRetroAdjustmentPayBaht(
  db: Firestore,
  adjustment: TimesheetRetroAdjustment,
  sourceTimesheet?: DailyTimesheet | null,
): Promise<number> {
  let ts = sourceTimesheet ?? null;
  if (!ts) {
    const { getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'daily_timesheets', adjustment.sourceTimesheetId));
    if (snap.exists()) ts = { id: snap.id, ...(snap.data() as object) } as DailyTimesheet;
  }
  if (!ts) {
    // fallback: ถ้าไม่มี timesheet ใช้ snapshot เท่าที่มี
    const stored = Number(adjustment.computedPayAmountBaht);
    return Number.isFinite(stored) && stored > 0 ? Math.round(stored * 100) / 100 : 0;
  }

  const payResult = await computeRetroAdjustmentPayFromFirestore(
    db,
    ts,
    retroHoursDeltaFromAdjustment(adjustment),
  );
  if (payResult.ok) return payResult.amountBaht;

  // fallback: ถ้าคำนวณไม่ได้ (missing rate) ใช้ snapshot
  const stored = Number(adjustment.computedPayAmountBaht);
  return Number.isFinite(stored) && stored > 0 ? Math.round(stored * 100) / 100 : 0;
}


export async function retroAdjustmentsToPriorPeriodItemsWithPay(
  db: Firestore,
  items: readonly TimesheetRetroAdjustment[],
): Promise<PriorPeriodAllowanceItem[]> {
  // เรียงตามวันที่ก่อน แล้วค่อยคำนวณแบบ parallel
  const sorted = [...items].sort((a, b) => {
    const ymCmp = (a.sourceYearMonth || '').localeCompare(b.sourceYearMonth || '');
    if (ymCmp !== 0) return ymCmp;
    return (a.workDateYmd || '').localeCompare(b.workDateYmd || '');
  });
  return Promise.all(
    sorted.map(async (r) => {
      const amount = await resolveRetroAdjustmentPayBaht(db, r);
      return {
        sourceYearMonth: r.sourceYearMonth,
        label: formatRetroAdjustmentSummaryLabel(r),
        amount,
      };
    }),
  );
}


export function retroAdjustmentsToPriorPeriodLabels(
  items: readonly TimesheetRetroAdjustment[],
): PriorPeriodAllowanceItem[] {
  const sorted = [...items].sort((a, b) => {
    const ymCmp = (a.sourceYearMonth || '').localeCompare(b.sourceYearMonth || '');
    if (ymCmp !== 0) return ymCmp;
    return (a.workDateYmd || '').localeCompare(b.workDateYmd || '');
  });
  
  const byMonth = new Map<string, TimesheetRetroAdjustment[]>();
  for (const r of sorted) {
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
  const batchSnap = await getDoc(doc(db, 'payroll_batches', payrollBatchId));
  if (batchSnap.exists()) {
    const st = String((batchSnap.data() as { status?: string }).status || '');
    if (['PAID', 'LOCKED', 'FINANCE_PREPARED', 'PAYMENT_EXPORTED'].includes(st)) {
      throw new Error(
        `ชุดจ่าย ${payrollBatchId} สถานะ ${st} — ไม่สามารถคืนสถานะตกเบิกที่จ่ายไปแล้วได้`,
      );
    }
  }

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
