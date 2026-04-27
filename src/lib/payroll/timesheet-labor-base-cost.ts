/**
 * ฐานต้นทุนค่าแรงต่อใบ timesheet (เฟส 3) — ยึด position + worker ก่อน แล้วค่อย costBaselineSnapshot จาก PO
 */
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import type { DailyTimesheet, Position, Worker, LaborCostSourceKind, LaborCostWorkMode } from '@/lib/types';
import { resolveWorkerLaborBaseRate } from '@/lib/payroll/labor-cost-model';

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

export function resolveBaseCostForPayrollTimesheet(input: {
  worker: Worker | null | undefined;
  position: Position | null | undefined;
  poLine: Record<string, unknown> | null | undefined;
  timesheet: DailyTimesheet;
}): {
  baseCost: number;
  fromPositionModel: boolean;
  resolution: { rate: number; source: LaborCostSourceKind; workMode: LaborCostWorkMode } | null;
} {
  const line = input.poLine || {};
  const mode = timesheetToLaborWorkMode(input.timesheet);
  const w = input.worker;
  if (w) {
    const r = resolveWorkerLaborBaseRate(
      {
        laborCostUsePositionDefault: w.laborCostUsePositionDefault,
        laborCostCustomOnshore: w.laborCostCustomOnshore,
        laborCostCustomOffshore: w.laborCostCustomOffshore,
      },
      input.position ?? undefined,
      mode,
    );
    if (r.rate != null && r.rate > 0) {
      return {
        baseCost: r.rate,
        fromPositionModel: true,
        resolution: { rate: r.rate, source: r.source, workMode: mode },
      };
    }
  }
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
  const pids = new Set(
    Array.from(workerById.values())
      .map((w) => w.currentPositionId)
      .filter((x): x is string => Boolean(x)),
  );
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
