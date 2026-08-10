/**
 * ฐานต้นทุนค่าแรงต่อใบ timesheet — **รายวัน / ราย PO / รายสัญญา**
 * (คนเดียวในเดือนเดียวอาจมีหลายสัญญา — แต่ละแถว daily_timesheets ใช้ contractId ของตัวเอง)
 *
 * ลำดับ:
 * รายคน (custom) → ทะเบียนต่อสัญญาบน Position (`laborCostByContract` × contract ของใบงาน)
 * → ทับต่อตำแหน่งบนสัญญาหลัก (`MainContract.laborCostBaselinesByPositionId`)
 * → มาตรฐาน Position (`defaultLaborCost*`) → costBaselineSnapshot จาก PO line ของ PO นั้น
 */
import { collection, doc, getDoc, getDocs, type Firestore } from 'firebase/firestore';
import type {
  DailyTimesheet,
  JobMode,
  MainContract,
  Position,
  PurchaseOrder,
  Worker,
  LaborCostSourceKind,
  LaborCostWorkMode,
} from '@/lib/types';
import {
  parseCanonicalPoActiveBundleRouteKey,
  resolveWorkModeForPoContext,
} from '@/lib/ops/po-active-bundle';

function workerPositionAllowanceDaily(worker: Worker | null | undefined): number {
  if (!worker) return 0;
  const n = Number(worker.positionAllowanceDailyBaht);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * หลังได้ฐานต้นทุนต่อวันจากเส้นทางเดิม (custom → ทะเบียนต่อสัญญา → default ตำแหน่ง → snapshot PO) — บวกค่าตำแหน่งรายคนถ้ามี
 * ต้นทุนฝั่ง OPEC เท่านั้น — ไม่ใช้ราคาขาย · ไม่บวกเมื่อ override รายคน · ค่าว่าง/0 = ไม่บวก
 */
function applyWorkerPositionAllowanceToResolvedBase(input: {
  worker: Worker | null | undefined;
  baseCost: number;
  resolution: { rate: number; source: LaborCostSourceKind; workMode: LaborCostWorkMode } | null;
}): {
  baseCost: number;
  resolution: { rate: number; source: LaborCostSourceKind; workMode: LaborCostWorkMode } | null;
} {
  const add = workerPositionAllowanceDaily(input.worker);
  if (add <= 0 || input.baseCost <= 0) return input;
  if (input.resolution?.source === 'worker_custom') return input;

  if (input.resolution) {
    return {
      baseCost: input.baseCost + add,
      resolution: {
        ...input.resolution,
        rate: input.resolution.rate + add,
      },
    };
  }
  /* ฐานจาก PO snapshot — ยังบวกค่าตำแหน่งได้ */
  return { baseCost: input.baseCost + add, resolution: null };
}

/**
 * ตัวแทน “บาท/วัน” ฝั่ง OPEC สำหรับ PO snapshot / แสดงผล — ไม่อ้าง main_contract/position_rates
 * (onshore ก่อน, ไม่มีค่อย offshore, รุ่น migration กำหนดเท่าหรือกำหนดข้างเดียว)
 */
export function defaultLaborDailyFromPosition(
  p: Position | null | undefined,
): number {
  if (!p) return 0;
  const on = Number(p.defaultLaborCostOnshore) || 0;
  const off = Number(p.defaultLaborCostOffshore) || 0;
  if (on > 0) return on;
  if (off > 0) return off;
  return 0;
}

/** ตำแหน่งหน้างาน (ไม่รวม office) ที่ยังไม่มีฐานต้นทุน OPEC สำหรับใช้ใน defaultLaborDailyFromPosition */
export function isFieldPositionMissingDefaultLabor(p: Position): boolean {
  if (p.active === false) return false;
  if (p.category === 'OFFICE') return false;
  return defaultLaborDailyFromPosition(p) === 0;
}

/** โหมด On/Off สำหรับคิด payroll — PO เป็นหลัก (แก้กรณี daily บันทึก ONSHORE ผิดจาก PO offshore) */
export function resolveEffectivePayrollJobMode(
  ts: Pick<DailyTimesheet, 'workMode' | 'purchaseOrderId' | 'poActiveBundleId'>,
  poWorkModeByPoId?: Map<string, JobMode>,
): JobMode {
  const poId = (ts.purchaseOrderId || '').trim();
  if (poId && poWorkModeByPoId?.has(poId)) {
    return poWorkModeByPoId.get(poId)!;
  }
  const bundleParsed = parseCanonicalPoActiveBundleRouteKey((ts.poActiveBundleId || '').trim());
  if (bundleParsed?.workMode) return bundleParsed.workMode;
  if (ts.workMode === 'ONSHORE' || ts.workMode === 'OFFSHORE') return ts.workMode;
  return 'OFFSHORE';
}

export function buildPoWorkModeMapFromPurchaseOrders(
  pos: Iterable<Pick<PurchaseOrder, 'id' | 'poWorkMode' | 'poActiveBundleId'>>,
): Map<string, JobMode> {
  const map = new Map<string, JobMode>();
  for (const po of pos) {
    if (!po.id) continue;
    map.set(po.id, resolveWorkModeForPoContext(po));
  }
  return map;
}

export async function loadPayrollPoWorkModeMap(
  db: Firestore,
  poIds: string[],
): Promise<Map<string, JobMode>> {
  const map = new Map<string, JobMode>();
  await Promise.all(
    poIds.map(async (poId) => {
      const snap = await getDoc(doc(db, 'purchase_orders', poId));
      if (!snap.exists()) return;
      const po = { id: snap.id, ...(snap.data() as object) } as PurchaseOrder;
      map.set(poId, resolveWorkModeForPoContext(po));
    }),
  );
  return map;
}

export function timesheetToLaborWorkMode(
  ts: Pick<DailyTimesheet, 'workMode' | 'purchaseOrderId' | 'poActiveBundleId'>,
  poWorkModeByPoId?: Map<string, JobMode>,
): LaborCostWorkMode {
  const mode = resolveEffectivePayrollJobMode(ts, poWorkModeByPoId);
  return mode === 'OFFSHORE' ? 'offshore' : 'onshore';
}

function positionLaborRateForMode(
  pos: Position | null | undefined,
  mode: LaborCostWorkMode,
): number {
  if (!pos) return 0;
  const primary = mode === 'onshore' ? pos.defaultLaborCostOnshore : pos.defaultLaborCostOffshore;
  const n = primary !== undefined && primary !== null ? Number(primary) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  const fallback = mode === 'onshore' ? pos.defaultLaborCostOffshore : pos.defaultLaborCostOnshore;
  const f = fallback !== undefined && fallback !== null ? Number(fallback) : NaN;
  return Number.isFinite(f) && f > 0 ? f : 0;
}

/** @deprecated ใช้ positionLaborRateForMode */
function positionRateForLaborMode(
  pos: Position | null | undefined,
  mode: LaborCostWorkMode,
): number {
  return positionLaborRateForMode(pos, mode);
}

/** ทะเบียนต้นทุนต่อสัญญา บน Position — จับคู่ `timesheet.contractId` */
function resolveLaborCostFromPositionRegistry(
  pos: Position | null | undefined,
  contractId: string | undefined,
  mode: LaborCostWorkMode,
): number {
  if (!pos?.laborCostByContract?.length || !(contractId || '').trim()) return 0;
  const row = pos.laborCostByContract.find((r) => r.contractId === contractId);
  if (!row) return 0;
  const primary = mode === 'onshore' ? row.onshore : row.offshore;
  const n = primary !== undefined && primary !== null ? Number(primary) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  const fallback = mode === 'onshore' ? row.offshore : row.onshore;
  const f = fallback !== undefined && fallback !== null ? Number(fallback) : NaN;
  return Number.isFinite(f) && f > 0 ? f : 0;
}

/** ฐานรายวันที่ระบุเองในทะเบียนลูกจ้าง (ไม่ใช้ตารางตำแหน่ง/สัญญา) */
export function workerCustomLaborRateForMode(
  w: Worker,
  mode: LaborCostWorkMode,
): number {
  const primary = mode === 'onshore' ? w.laborCostCustomOnshore : w.laborCostCustomOffshore;
  const n = primary !== undefined && primary !== null ? Number(primary) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  const fallback = mode === 'onshore' ? w.laborCostCustomOffshore : w.laborCostCustomOnshore;
  const f = fallback !== undefined && fallback !== null ? Number(fallback) : NaN;
  return Number.isFinite(f) && f > 0 ? f : 0;
}

/** สัญญาที่ใช้คิดต้นทุนของใบงานนี้ — จาก daily ก่อน แล้ว fallback จาก PO */
export function resolveEffectivePayrollContractId(
  ts: Pick<DailyTimesheet, 'contractId' | 'purchaseOrderId'>,
  poContractById?: Map<string, string>,
): string {
  const direct = (ts.contractId || '').trim();
  if (direct) return direct;
  const poId = (ts.purchaseOrderId || '').trim();
  if (!poId || !poContractById) return '';
  return (poContractById.get(poId) || '').trim();
}

/** รวบ contractId ที่ต้องโหลด main_contracts สำหรับชุด timesheets */
export function collectPayrollContractIds(
  timesheets: Pick<DailyTimesheet, 'contractId' | 'purchaseOrderId'>[],
  poContractById?: Map<string, string>,
): string[] {
  const ids = new Set<string>();
  for (const ts of timesheets) {
    const cid = resolveEffectivePayrollContractId(ts, poContractById);
    if (cid) ids.add(cid);
  }
  return [...ids];
}

/** PO id → contractId (จาก purchase_orders) */
export async function loadPayrollPoContractIdMap(
  db: Firestore,
  poIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all(
    poIds.map(async (poId) => {
      const snap = await getDoc(doc(db, 'purchase_orders', poId));
      if (!snap.exists()) return;
      const cid = String((snap.data() as { contractId?: string }).contractId || '').trim();
      if (cid) map.set(poId, cid);
    }),
  );
  return map;
}

export function buildPoContractIdMapFromPurchaseOrders(
  pos: Iterable<{ id: string; contractId?: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const po of pos) {
    const cid = (po.contractId || '').trim();
    if (cid) map.set(po.id, cid);
  }
  return map;
}

/** ต้นทุนที่ตั้งทับบนสัญญาหลัก (แท็บอัตราตามตำแหน่ง — ฝั่งต้นทุน) */
function resolveLaborCostFromContractPositionBaseline(
  mainContract: MainContract | null | undefined,
  positionId: string | undefined,
  mode: LaborCostWorkMode,
): number {
  const pid = (positionId || '').trim();
  if (!mainContract || !pid) return 0;
  const row = mainContract.laborCostBaselinesByPositionId?.[pid];
  if (!row) return 0;
  const primary = mode === 'onshore' ? row.onshore : row.offshore;
  const n = primary !== undefined && primary !== null ? Number(primary) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  const fallback = mode === 'onshore' ? row.offshore : row.onshore;
  const f = fallback !== undefined && fallback !== null ? Number(fallback) : NaN;
  return Number.isFinite(f) && f > 0 ? f : 0;
}

/**
 * ฐานก่อน snapshot PO — ใช้ `linePosition` = ตำแหน่งตามบรรทัด timesheet/งาน ไม่ใช่ `worker.currentPositionId`
 */
function resolvePayrollLaborBaseCore(input: {
  worker: Worker | null | undefined;
  linePosition: Position | null | undefined;
  timesheet: DailyTimesheet;
  mainContract: MainContract | null | undefined;
  poContractById?: Map<string, string>;
  poWorkModeByPoId?: Map<string, JobMode>;
}): {
  baseCost: number;
  fromPositionModel: boolean;
  resolution: { rate: number; source: LaborCostSourceKind; workMode: LaborCostWorkMode } | null;
} {
  const mode = timesheetToLaborWorkMode(input.timesheet, input.poWorkModeByPoId);
  const w = input.worker;
  const linePos = input.linePosition;
  const positionId = (input.timesheet.positionId || linePos?.id || '').trim();
  const payrollContractId = resolveEffectivePayrollContractId(input.timesheet, input.poContractById);
  const registryB = resolveLaborCostFromPositionRegistry(linePos, payrollContractId, mode);
  const contractBaseline = resolveLaborCostFromContractPositionBaseline(
    input.mainContract,
    positionId,
    mode,
  );

  const contractBaselineResolution = contractBaseline > 0
    ? {
        baseCost: contractBaseline,
        fromPositionModel: true,
        resolution: {
          rate: contractBaseline,
          source: 'contract_position_baseline' as const,
          workMode: mode,
        },
      }
    : null;

  if (w) {
    const usePos = w.laborCostUsePositionDefault !== false;
    if (!usePos) {
      const n = workerCustomLaborRateForMode(w, mode);
      if (n > 0) {
        return {
          baseCost: n,
          fromPositionModel: true,
          resolution: { rate: n, source: 'worker_custom', workMode: mode },
        };
      }
      if (registryB > 0) {
        return {
          baseCost: registryB,
          fromPositionModel: true,
          resolution: { rate: registryB, source: 'position_contract_registry', workMode: mode },
        };
      }
      if (contractBaselineResolution) return contractBaselineResolution;
      return { baseCost: 0, fromPositionModel: true, resolution: null };
    }

    if (registryB > 0) {
      return {
        baseCost: registryB,
        fromPositionModel: true,
        resolution: { rate: registryB, source: 'position_contract_registry', workMode: mode },
      };
    }
    if (contractBaselineResolution) return contractBaselineResolution;
    return { baseCost: 0, fromPositionModel: true, resolution: null };
  }

  if (registryB > 0) {
    return {
      baseCost: registryB,
      fromPositionModel: true,
      resolution: { rate: registryB, source: 'position_contract_registry', workMode: mode },
    };
  }
  if (contractBaselineResolution) return contractBaselineResolution;
  return { baseCost: 0, fromPositionModel: true, resolution: null };
}

export function resolveBaseCostForPayrollTimesheet(input: {
  worker: Worker | null | undefined;
  linePosition: Position | null | undefined;
  poLine: Record<string, unknown> | null | undefined;
  timesheet: DailyTimesheet;
  mainContract?: MainContract | null;
  poContractById?: Map<string, string>;
  poWorkModeByPoId?: Map<string, JobMode>;
}): {
  baseCost: number;
  fromPositionModel: boolean;
  resolution: { rate: number; source: LaborCostSourceKind; workMode: LaborCostWorkMode } | null;
} {
  const inner = resolvePayrollLaborBaseCore({
    worker: input.worker,
    linePosition: input.linePosition,
    timesheet: input.timesheet,
    mainContract: input.mainContract,
    poContractById: input.poContractById,
    poWorkModeByPoId: input.poWorkModeByPoId,
  });
  if (inner.baseCost > 0) {
    const adj = applyWorkerPositionAllowanceToResolvedBase({
      worker: input.worker,
      baseCost: inner.baseCost,
      resolution: inner.resolution,
    });
    return {
      baseCost: adj.baseCost,
      fromPositionModel: inner.fromPositionModel,
      resolution: adj.resolution,
    };
  }
  const line = input.poLine || {};
  const base = Number(
    (line as { costBaselineSnapshot?: number }).costBaselineSnapshot ?? 0,
  ) || 0;
  const adj = applyWorkerPositionAllowanceToResolvedBase({
    worker: input.worker,
    baseCost: base,
    resolution: null,
  });
  return { baseCost: adj.baseCost, fromPositionModel: false, resolution: adj.resolution };
}

export async function loadWorkersAndPositionsForPayroll(
  db: Firestore,
  timesheets: DailyTimesheet[],
): Promise<{ workerById: Map<string, Worker>; posById: Map<string, Position> }> {
  const workerIds = Array.from(new Set(timesheets.map((t) => t.workerId).filter(Boolean)));
  const workerById = new Map<string, Worker>();
  await Promise.all(
    workerIds.map(async (wid) => {
      const s = await getDoc(doc(db, 'workers', wid));
      if (s.exists()) {
        workerById.set(wid, { id: s.id, ...(s.data() as object) } as Worker);
      }
    }),
  );
  const pids = new Set<string>();
  for (const w of workerById.values()) {
    if (w.currentPositionId) pids.add(w.currentPositionId);
  }
  for (const ts of timesheets) {
    if (ts.positionId) pids.add(ts.positionId);
  }
  const posById = new Map<string, Position>();
  await Promise.all(
    [...pids].map(async (pid) => {
      const s = await getDoc(doc(db, 'positions', pid));
      if (s.exists()) {
        posById.set(pid, { id: s.id, ...(s.data() as object) } as Position);
      }
    }),
  );
  return { workerById, posById };
}

export type PayrollPoLineMaps = {
  byLineId: Map<string, Record<string, unknown>>;
  byPoPosition: Map<string, Record<string, unknown>>;
};

/** โหลด PO lines สำหรับ payroll — จับคู่ตาม poLineId และ (poId + positionId) */
export async function loadPayrollPoLineMaps(
  db: Firestore,
  poIds: string[],
): Promise<PayrollPoLineMaps> {
  const byLineId = new Map<string, Record<string, unknown>>();
  const byPoPosition = new Map<string, Record<string, unknown>>();
  await Promise.all(
    poIds.map(async (poId) => {
      const linesSnap = await getDocs(collection(db, 'purchase_orders', poId, 'po_lines'));
      linesSnap.docs.forEach((lineDoc) => {
        const data = lineDoc.data() as Record<string, unknown>;
        byLineId.set(lineDoc.id, data);
        const posId = String(data.positionId || '').trim();
        if (posId) byPoPosition.set(`${poId}::${posId}`, data);
      });
    }),
  );
  return { byLineId, byPoPosition };
}

/** หา PO line สำหรับคิดต้นทุน — รองรับ poLineId ปลอมจาก wave excel (`po-line-{assignmentId}`) */
export function resolvePoLineForPayrollTimesheet(
  ts: Pick<DailyTimesheet, 'poLineId' | 'positionId' | 'purchaseOrderId'>,
  maps: PayrollPoLineMaps,
): Record<string, unknown> {
  const direct = maps.byLineId.get(ts.poLineId);
  const directCost = Number((direct as { costBaselineSnapshot?: number } | undefined)?.costBaselineSnapshot ?? 0);
  if (direct && directCost > 0) return direct;

  const poId = (ts.purchaseOrderId || '').trim();
  const posId = (ts.positionId || '').trim();
  if (poId && posId) {
    const byPos = maps.byPoPosition.get(`${poId}::${posId}`);
    if (byPos) return byPos;
  }

  return direct || {};
}
