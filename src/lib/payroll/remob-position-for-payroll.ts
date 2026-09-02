/**
 * Remob / เปลี่ยนตำแหน่งกลางเดือน:
 * - ป้ายบน batch มาจาก worker.currentPositionId
 * - ค่าแรงจริงมาจาก daily_timesheets.positionId (คัดลอกจาก assignment ตอนสร้างแถว)
 * หลังจบรอบเก่า (mobLocationEndDate) ถ้าทะเบียนลูกจ้างเปลี่ยนตำแหน่งแล้ว
 * ต้องคิดค่าแรงด้วยตำแหน่งใหม่ — ไม่ใช้ตำแหน่งเดิมบนใบงานค้าง
 *
 * ค่าแรงรอบเก่า (เช่น 1800 ก่อน remob เป็น Fitter Foreman 2600):
 * เก็บใน assignment.laborCostEpochs ตอนกดจบงาน — ไม่พึ่งทะเบียนลูกจ้างที่อาจถูกแก้ทีหลัง
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type {
  Assignment,
  AssignmentLaborCostEpoch,
  DailyTimesheet,
  PriorPeriodAllowanceItem,
  Worker,
} from '@/lib/types';
import { loadAssignmentsForTimesheets } from '@/lib/payroll/filter-timesheets-for-worker-payroll';
import { stripUndefinedForFirestore } from '@/lib/firestore/strip-undefined-for-firestore';

function isTimesheetFinanciallyImmutable(status: string | undefined): boolean {
  return ['CLIENT_APPROVED', 'VERIFIED_PAPER', 'LOCKED'].includes(status || '');
}

/** Firestore ห้าม undefined ใน object ของ array */
function sanitizeLaborCostEpoch(epoch: AssignmentLaborCostEpoch): AssignmentLaborCostEpoch {
  return stripUndefinedForFirestore(epoch);
}

function epochFromInferredOffshore(
  untilYmd: string,
  inferred: number,
  worker: Pick<Worker, 'laborCostCustomOnshore'>,
  positionId: string | undefined,
): AssignmentLaborCostEpoch {
  const on = Number(worker.laborCostCustomOnshore);
  const pos = String(positionId || '').trim();
  return sanitizeLaborCostEpoch({
    untilYmd,
    laborCostOffshore: inferred,
    ...(Number.isFinite(on) && on > 0 ? { laborCostOnshore: on } : {}),
    laborCostUsePositionDefault: false,
    ...(pos ? { positionId: pos } : {}),
    capturedAt: Date.now(),
  });
}

/** ตำแหน่งที่ใช้คิดค่าแรงต่อใบ — วันหลังจบรอบเก่าใช้ตำแหน่งทะเบียนถ้าต่างจากใบงาน */
export function resolveEffectivePayrollPositionId(
  ts: Pick<DailyTimesheet, 'date' | 'positionId' | 'assignmentId'>,
  worker: Pick<Worker, 'currentPositionId'> | null | undefined,
  assignment: Pick<Assignment, 'mobLocationEndDate' | 'mobCycleNumber' | 'positionId'> | null | undefined,
): string {
  const tsPos = String(ts.positionId || '').trim();
  const workerPos = String(worker?.currentPositionId || '').trim();
  const asgnPos = String(assignment?.positionId || '').trim();
  const finish = String(assignment?.mobLocationEndDate || '').slice(0, 10);
  const ymd = String(ts.date || '').slice(0, 10);
  const cycle =
    typeof assignment?.mobCycleNumber === 'number' && Number.isFinite(assignment.mobCycleNumber)
      ? assignment.mobCycleNumber
      : 1;

  if (
    workerPos &&
    cycle > 1 &&
    /^\d{4}-\d{2}-\d{2}$/.test(finish) &&
    /^\d{4}-\d{2}-\d{2}$/.test(ymd) &&
    ymd > finish
  ) {
    return workerPos;
  }

  return tsPos || asgnPos || workerPos || '';
}

/**
 * หา epoch ที่ครอบคลุมวันที่ (เลือก untilYmd เล็กสุดที่ยัง ≥ วันนั้น)
 * — รองรับหลายรอบจบงาน/remob
 */
export function resolveLaborCostEpochForDate(
  assignment: Pick<Assignment, 'laborCostEpochs'> | null | undefined,
  ymd: string,
): AssignmentLaborCostEpoch | null {
  const day = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const epochs = assignment?.laborCostEpochs;
  if (!Array.isArray(epochs) || epochs.length === 0) return null;
  const covering = epochs
    .filter((e) => {
      const u = String(e?.untilYmd || '').slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(u) && day <= u;
    })
    .sort((a, b) => String(a.untilYmd).localeCompare(String(b.untilYmd)));
  return covering[0] ?? null;
}

/** ทับค่าแรงทะเบียนด้วย epoch รอบเก่า (ถ้ามี) — ใช้ตอน aggregate payroll */
export function applyLaborCostEpochToWorkerForDate(
  worker: Worker | undefined,
  assignment: Pick<Assignment, 'laborCostEpochs'> | null | undefined,
  ymd: string,
): Worker | undefined {
  if (!worker) return worker;
  const epoch = resolveLaborCostEpochForDate(assignment, ymd);
  if (!epoch) return worker;

  const off = Number(epoch.laborCostOffshore);
  const on = Number(epoch.laborCostOnshore);
  const hasOff = Number.isFinite(off) && off > 0;
  const hasOn = Number.isFinite(on) && on > 0;
  if (!hasOff && !hasOn && epoch.laborCostUsePositionDefault !== true) return worker;

  if (epoch.laborCostUsePositionDefault === true && !hasOff && !hasOn) {
    return {
      ...worker,
      laborCostUsePositionDefault: true,
    };
  }

  return {
    ...worker,
    laborCostUsePositionDefault: false,
    ...(hasOff ? { laborCostCustomOffshore: off } : {}),
    ...(hasOn ? { laborCostCustomOnshore: on } : {}),
  };
}

/** สร้าง epoch จากทะเบียนลูกจ้าง ณ ขณะจบงาน */
export function buildLaborCostEpochFromWorker(
  worker: Pick<
    Worker,
    'laborCostUsePositionDefault' | 'laborCostCustomOffshore' | 'laborCostCustomOnshore' | 'currentPositionId'
  >,
  opts: { untilYmd: string; positionId?: string; capturedAt?: number },
): AssignmentLaborCostEpoch | null {
  const untilYmd = String(opts.untilYmd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(untilYmd)) return null;

  const usePos = worker.laborCostUsePositionDefault !== false;
  const off = Number(worker.laborCostCustomOffshore);
  const on = Number(worker.laborCostCustomOnshore);
  const hasOff = Number.isFinite(off) && off > 0;
  const hasOn = Number.isFinite(on) && on > 0;

  const pos = String(opts.positionId || worker.currentPositionId || '').trim();

  if (usePos && !hasOff && !hasOn) {
    return sanitizeLaborCostEpoch({
      untilYmd,
      laborCostUsePositionDefault: true,
      ...(pos ? { positionId: pos } : {}),
      capturedAt: opts.capturedAt ?? Date.now(),
    });
  }

  if (!hasOff && !hasOn) return null;

  return sanitizeLaborCostEpoch({
    untilYmd,
    laborCostUsePositionDefault: false,
    ...(hasOff ? { laborCostOffshore: off } : {}),
    ...(hasOn ? { laborCostOnshore: on } : {}),
    ...(pos ? { positionId: pos } : {}),
    capturedAt: opts.capturedAt ?? Date.now(),
  });
}

/**
 * อนุมานแพ็ก offshore จากรายการตกเบิก OT1.5
 * เช่น amount=771.43, hours=4 → D = amount×14/(hours×1.5) = 1800
 */
export function inferOffshorePackageFromOt15PriorItems(
  items: readonly PriorPeriodAllowanceItem[] | null | undefined,
): number | null {
  if (!items?.length) return null;
  const candidates: number[] = [];
  for (const it of items) {
    const amt = Number(it.amount);
    if (!(Number.isFinite(amt) && amt > 0)) continue;
    const m = String(it.label || '').match(/OT\s*1\.5\s*\+?\s*([\d.]+)\s*ชม/i);
    if (!m) continue;
    const hours = Number(m[1]);
    if (!(Number.isFinite(hours) && hours > 0)) continue;
    const D = (amt * 14) / (hours * 1.5);
    if (Number.isFinite(D) && D >= 500 && D <= 20000) {
      candidates.push(Math.round(D * 100) / 100);
    }
  }
  if (candidates.length === 0) return null;
  const rounded = candidates.map((d) => Math.round(d / 50) * 50);
  const freq = new Map<number, number>();
  for (const d of rounded) freq.set(d, (freq.get(d) || 0) + 1);
  let best = rounded[0]!;
  let bestN = 0;
  for (const [d, n] of freq) {
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

export function mergeLaborCostEpoch(
  existing: readonly AssignmentLaborCostEpoch[] | null | undefined,
  next: AssignmentLaborCostEpoch,
): AssignmentLaborCostEpoch[] {
  const until = String(next.untilYmd || '').slice(0, 10);
  const rest = (existing ?? []).filter((e) => String(e.untilYmd || '').slice(0, 10) !== until);
  return [...rest, next].sort((a, b) => String(a.untilYmd).localeCompare(String(b.untilYmd)));
}

/**
 * ตอนจบงาน — เก็บค่าแรงปัจจุบันลง epoch จนถึงวันจบ
 * (เรียกก่อนเปลี่ยนตำแหน่ง remob / ก่อน HR แก้ทะเบียนเป็นอัตราใหม่)
 */
export async function captureLaborCostEpochOnMobFinish(
  db: Firestore,
  assignment: Pick<Assignment, 'id' | 'workerId' | 'positionId' | 'laborCostEpochs'>,
  finishYmd: string,
  opts?: {
    forceOverwrite?: boolean;
    inferredOffshorePackage?: number | null;
    /** heal ข้อมูลเก่า — ใช้แพ็กที่อนุมานจาก OT ตกเบิกเป็นหลัก */
    preferInferredOffshore?: boolean;
  },
): Promise<{ captured: boolean; epochs: AssignmentLaborCostEpoch[] }> {
  const aid = String(assignment.id || '').trim();
  const wid = String(assignment.workerId || '').trim();
  const until = String(finishYmd || '').slice(0, 10);
  if (!aid || !wid || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    return { captured: false, epochs: assignment.laborCostEpochs ?? [] };
  }

  const already = (assignment.laborCostEpochs ?? []).some(
    (e) => String(e.untilYmd || '').slice(0, 10) === until,
  );
  if (already && !opts?.forceOverwrite) {
    return { captured: false, epochs: assignment.laborCostEpochs ?? [] };
  }

  const workerSnap = await getDoc(doc(db, 'workers', wid));
  if (!workerSnap.exists()) {
    return { captured: false, epochs: assignment.laborCostEpochs ?? [] };
  }
  const worker = workerSnap.data() as Worker;

  const inferred = opts?.inferredOffshorePackage;
  const inferredOk = inferred != null && Number.isFinite(inferred) && inferred > 0;

  let epoch: AssignmentLaborCostEpoch | null = null;
  if (opts?.preferInferredOffshore && inferredOk) {
    epoch = epochFromInferredOffshore(until, Number(inferred), worker, assignment.positionId);
  } else {
    epoch = buildLaborCostEpochFromWorker(worker, {
      untilYmd: until,
      positionId: assignment.positionId,
    });
    if ((!epoch || !(Number(epoch.laborCostOffshore) > 0)) && inferredOk) {
      epoch = epochFromInferredOffshore(until, Number(inferred), worker, assignment.positionId);
    }
  }

  if (!epoch) {
    return { captured: false, epochs: assignment.laborCostEpochs ?? [] };
  }

  const epochs = mergeLaborCostEpoch(assignment.laborCostEpochs, sanitizeLaborCostEpoch(epoch)).map(
    sanitizeLaborCostEpoch,
  );
  await updateDoc(doc(db, 'mobilizations', aid), {
    laborCostEpochs: epochs,
    updatedAt: Date.now(),
  });
  return { captured: true, epochs };
}

/**
 * Heal assignment ที่จบงานแล้วแต่ยังไม่มี epoch (ข้อมูลเก่า)
 * — ใช้ inferred จากรายการตกเบิก OT เท่านั้น (อย่าเขียนจากทะเบียนปัจจุบันที่อาจเป็นอัตราหลัง remob แล้ว)
 */
export async function ensureLaborCostEpochAfterMobFinish(
  db: Firestore,
  assignment: Assignment,
  opts?: { inferredOffshorePackage?: number | null },
): Promise<Assignment> {
  const finish = String(assignment.mobLocationEndDate || '').slice(0, 10);
  const cycle =
    typeof assignment.mobCycleNumber === 'number' && Number.isFinite(assignment.mobCycleNumber)
      ? assignment.mobCycleNumber
      : 1;
  if (cycle <= 1 || !/^\d{4}-\d{2}-\d{2}$/.test(finish)) return assignment;
  if ((assignment.laborCostEpochs ?? []).some((e) => String(e.untilYmd).slice(0, 10) === finish)) {
    return assignment;
  }

  const inferred = opts?.inferredOffshorePackage;
  if (!(inferred != null && Number.isFinite(inferred) && inferred > 0)) {
    return assignment;
  }

  const { captured, epochs } = await captureLaborCostEpochOnMobFinish(db, assignment, finish, {
    inferredOffshorePackage: inferred,
    preferInferredOffshore: true,
  });
  if (!captured) return assignment;
  return { ...assignment, laborCostEpochs: epochs };
}

/** ทับ positionId ในหน่วยความจำก่อนรวมยอด payroll (ไม่เขียน Firestore) */
export function applyRemobWorkerPositionToTimesheetsForPayroll(
  tsList: readonly DailyTimesheet[],
  workerById: Map<string, Worker>,
  assignmentById: Map<string, Assignment>,
): DailyTimesheet[] {
  return tsList.map((ts) => {
    const asgn = assignmentById.get(String(ts.assignmentId || '').trim());
    const wk = workerById.get(String(ts.workerId || '').trim());
    const effective = resolveEffectivePayrollPositionId(ts, wk, asgn);
    if (!effective || effective === String(ts.positionId || '').trim()) return ts;
    return { ...ts, positionId: effective };
  });
}

export async function loadAssignmentsAndApplyRemobPositionForPayroll(
  db: Firestore,
  tsList: readonly DailyTimesheet[],
  workerById: Map<string, Worker>,
): Promise<{ timesheets: DailyTimesheet[]; assignmentById: Map<string, Assignment> }> {
  if (tsList.length === 0) return { timesheets: [], assignmentById: new Map() };
  const assignmentById = await loadAssignmentsForTimesheets(db, tsList);
  return {
    timesheets: applyRemobWorkerPositionToTimesheetsForPayroll(tsList, workerById, assignmentById),
    assignmentById,
  };
}

/**
 * เขียน positionId ใหม่ลงใบงานที่ยังไม่ล็อก — เฉพาะวันหลังจบรอบเก่า
 */
export async function rewriteUnlockedTimesheetsPositionAfterMobFinish(
  db: Firestore,
  assignmentId: string,
  finishYmd: string,
  newPositionId: string,
): Promise<{ updated: number; skipped: number }> {
  const aid = assignmentId.trim();
  const finish = finishYmd.trim().slice(0, 10);
  const posId = newPositionId.trim();
  if (!aid || !posId || !/^\d{4}-\d{2}-\d{2}$/.test(finish)) {
    return { updated: 0, skipped: 0 };
  }

  const snap = await getDocs(
    query(collection(db, 'daily_timesheets'), where('assignmentId', '==', aid), where('date', '>', finish)),
  );
  if (snap.empty) return { updated: 0, skipped: 0 };

  let batch = writeBatch(db);
  let n = 0;
  let updated = 0;
  let skipped = 0;
  const now = Date.now();

  const flush = async () => {
    if (n === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    n = 0;
  };

  for (const d of snap.docs) {
    const cur = d.data() as DailyTimesheet;
    if (isTimesheetFinanciallyImmutable(cur.status)) {
      skipped++;
      continue;
    }
    if (String(cur.positionId || '').trim() === posId) continue;
    batch.update(d.ref, { positionId: posId, updatedAt: now });
    n++;
    updated++;
    if (n >= 400) await flush();
  }
  await flush();
  return { updated, skipped };
}

/**
 * ตอน remob / รอบใหม่ — อัปเดต assignment.positionId ให้ตรงทะเบียนลูกจ้าง
 * และเขียนทับใบงานหลังวันจบที่ยังไม่ล็อก
 */
export async function syncAssignmentPositionFromWorkerOnRemob(
  db: Firestore,
  assignment: Pick<Assignment, 'id' | 'workerId' | 'positionId' | 'mobLocationEndDate'>,
  opts?: { rewriteTimesheetsAfterFinish?: boolean },
): Promise<{ updated: boolean; positionId: string; timesheetsUpdated: number }> {
  const aid = String(assignment.id || '').trim();
  const wid = String(assignment.workerId || '').trim();
  const curPos = String(assignment.positionId || '').trim();
  if (!aid || !wid) {
    return { updated: false, positionId: curPos, timesheetsUpdated: 0 };
  }

  const workerSnap = await getDoc(doc(db, 'workers', wid));
  if (!workerSnap.exists()) {
    return { updated: false, positionId: curPos, timesheetsUpdated: 0 };
  }
  const workerPos = String((workerSnap.data() as Worker).currentPositionId || '').trim();
  if (!workerPos || workerPos === curPos) {
    return { updated: false, positionId: curPos || workerPos, timesheetsUpdated: 0 };
  }

  await updateDoc(doc(db, 'mobilizations', aid), {
    positionId: workerPos,
    updatedAt: Date.now(),
  });

  let timesheetsUpdated = 0;
  const finish = String(assignment.mobLocationEndDate || '').slice(0, 10);
  if (opts?.rewriteTimesheetsAfterFinish !== false && /^\d{4}-\d{2}-\d{2}$/.test(finish)) {
    const r = await rewriteUnlockedTimesheetsPositionAfterMobFinish(db, aid, finish, workerPos);
    timesheetsUpdated = r.updated;
  }

  return { updated: true, positionId: workerPos, timesheetsUpdated };
}
