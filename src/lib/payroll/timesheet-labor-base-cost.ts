/**
 * ฐานต้นทุนค่าแรงต่อใบ timesheet (เฟส 3) — ลำดับ: รายคน (custom) → ฐานรายสัญญา+ตำแหน่ง → มาตรฐาน Position → costBaselineSnapshot จาก PO
 */
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import type {
  DailyTimesheet,
  MainContract,
  Position,
  Worker,
  LaborCostSourceKind,
  LaborCostWorkMode,
} from '@/lib/types';

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

export function timesheetToLaborWorkMode(ts: DailyTimesheet): LaborCostWorkMode {
  const w = (ts.workMode == null ? 'ONSHORE' : ts.workMode).toString().toLowerCase();
  if (w === 'offshore') return 'offshore';
  return 'onshore';
}

function positionRateForLaborMode(
  pos: Position | null | undefined,
  mode: LaborCostWorkMode,
): number {
  if (!pos) return 0;
  const v = mode === 'onshore' ? pos.defaultLaborCostOnshore : pos.defaultLaborCostOffshore;
  const n = v !== undefined && v !== null ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** ฐานต้นทุนรายวันจาก `MainContract.laborCostBaselinesByPositionId` สำหรับบรรทัด timesheet (ตำแหน่งตาม `timesheet.positionId`) */
export function resolveLaborCostBaselineFromMainContract(
  main: MainContract | null | undefined,
  timesheetPositionId: string,
  mode: LaborCostWorkMode,
): number {
  if (!main?.laborCostBaselinesByPositionId || !timesheetPositionId) return 0;
  const row = main.laborCostBaselinesByPositionId[timesheetPositionId];
  if (!row) return 0;
  const v = mode === 'onshore' ? row.onshore : row.offshore;
  const n = v !== undefined && v !== null ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
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
  const v = mode === 'onshore' ? row.onshore : row.offshore;
  const n = v !== undefined && v !== null ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * ฐานก่อน snapshot PO — ใช้ `linePosition` = ตำแหน่งตามบรรทัด timesheet/งาน ไม่ใช่ `worker.currentPositionId`
 */
function resolvePayrollLaborBaseCore(input: {
  worker: Worker | null | undefined;
  linePosition: Position | null | undefined;
  timesheet: DailyTimesheet;
  mainContract: MainContract | null | undefined;
}): {
  baseCost: number;
  fromPositionModel: boolean;
  resolution: { rate: number; source: LaborCostSourceKind; workMode: LaborCostWorkMode } | null;
} {
  const mode = timesheetToLaborWorkMode(input.timesheet);
  const posId = input.timesheet.positionId;
  const w = input.worker;
  const linePos = input.linePosition;
  const main = input.mainContract;
  const contractB = resolveLaborCostBaselineFromMainContract(main, posId, mode);
  const registryB = resolveLaborCostFromPositionRegistry(linePos, input.timesheet.contractId, mode);

  if (w) {
    const usePos = w.laborCostUsePositionDefault !== false;
    if (!usePos) {
      const c = mode === 'onshore' ? w.laborCostCustomOnshore : w.laborCostCustomOffshore;
      const n = c !== undefined && c !== null ? Number(c) : NaN;
      if (Number.isFinite(n) && n > 0) {
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
      if (contractB > 0) {
        return {
          baseCost: contractB,
          fromPositionModel: true,
          resolution: { rate: contractB, source: 'contract_position_baseline', workMode: mode },
        };
      }
      const pOnly = positionRateForLaborMode(linePos, mode);
      if (pOnly > 0) {
        return {
          baseCost: pOnly,
          fromPositionModel: true,
          resolution: { rate: pOnly, source: 'position_default', workMode: mode },
        };
      }
      return { baseCost: 0, fromPositionModel: true, resolution: null };
    }

    if (registryB > 0) {
      return {
        baseCost: registryB,
        fromPositionModel: true,
        resolution: { rate: registryB, source: 'position_contract_registry', workMode: mode },
      };
    }
    if (contractB > 0) {
      return {
        baseCost: contractB,
        fromPositionModel: true,
        resolution: { rate: contractB, source: 'contract_position_baseline', workMode: mode },
      };
    }
    const p = positionRateForLaborMode(linePos, mode);
    if (p > 0) {
      return {
        baseCost: p,
        fromPositionModel: true,
        resolution: { rate: p, source: 'position_default', workMode: mode },
      };
    }
    return { baseCost: 0, fromPositionModel: true, resolution: null };
  }

  if (registryB > 0) {
    return {
      baseCost: registryB,
      fromPositionModel: true,
      resolution: { rate: registryB, source: 'position_contract_registry', workMode: mode },
    };
  }
  if (contractB > 0) {
    return {
      baseCost: contractB,
      fromPositionModel: true,
      resolution: { rate: contractB, source: 'contract_position_baseline', workMode: mode },
    };
  }
  const p = positionRateForLaborMode(linePos, mode);
  if (p > 0) {
    return {
      baseCost: p,
      fromPositionModel: true,
      resolution: { rate: p, source: 'position_default', workMode: mode },
    };
  }
  return { baseCost: 0, fromPositionModel: true, resolution: null };
}

export function resolveBaseCostForPayrollTimesheet(input: {
  worker: Worker | null | undefined;
  linePosition: Position | null | undefined;
  poLine: Record<string, unknown> | null | undefined;
  timesheet: DailyTimesheet;
  mainContract?: MainContract | null;
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
  });
  if (inner.baseCost > 0) {
    return {
      baseCost: inner.baseCost,
      fromPositionModel: inner.fromPositionModel,
      resolution: inner.resolution,
    };
  }
  const line = input.poLine || {};
  const base = Number(
    (line as { costBaselineSnapshot?: number }).costBaselineSnapshot ?? 0,
  ) || 0;
  return { baseCost: base, fromPositionModel: false, resolution: null };
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
