/**
 * เฟส 1: backfill ต้นทุนแรงจาก `main_contracts/{id}/position_rates` → `positions.defaultLaborCost*`
 * + audit ราย `workers` (ไม่แตะ laborCostUsePositionDefault / custom ถ้ามี)
 */
import type { Position, PositionRate } from '@/lib/types';

export type Phase1BackfillForPosition = {
  positionId: string;
  fromRateId: string;
  defaultLaborCostOnshore: number;
  defaultLaborCostOffshore: number;
  /** ถ้า true: อัปเดตเฉพาะ `defaultLaborCostOffshore` ไม่เขียน onshore */
  offshoreOnly?: boolean;
};

/**
 * จาก `costBaseline` ราย rate เดิม (ในสัญญา) แยก onshore / offshore
 * — รุ่นแรก: สองฝ่ายเท่ากันจนกว่าจะตั้งแยกในหน้า Position
 */
export function defaultLaborFromCostBaseline(costBaseline: number | undefined): {
  onshore: number;
  offshore: number;
} | null {
  const c = costBaseline != null ? Number(costBaseline) : NaN;
  if (!Number.isFinite(c) || c <= 0) return null;
  return { onshore: c, offshore: c };
}

/** ใช้ cost เดิมฝั่งสัญญาเป็นฐาน **offshore** อย่างเดียว (onshore ไม่เขียน) */
export function defaultLaborFromCostBaselineOffshoreOnly(costBaseline: number | undefined): { offshore: number } | null {
  const c = costBaseline != null ? Number(costBaseline) : NaN;
  if (!Number.isFinite(c) || c <= 0) return null;
  return { offshore: c };
}

export function planBackfillsForRates(
  rates: Array<PositionRate & { id: string }>,
  opts: { onlyActive: boolean; offshoreOnly?: boolean },
): { planned: Phase1BackfillForPosition[]; skipped: Array<{ positionId: string; reason: string }> } {
  const planned: Phase1BackfillForPosition[] = [];
  const skipped: Array<{ positionId: string; reason: string }> = [];
  const offshoreOnly = opts.offshoreOnly === true;
  for (const r of rates) {
    if (opts.onlyActive && r.active === false) {
      skipped.push({ positionId: r.positionId, reason: 'rate_inactive' });
      continue;
    }
    if (offshoreOnly) {
      const o = defaultLaborFromCostBaselineOffshoreOnly(r.costBaseline);
      if (!o) {
        skipped.push({ positionId: r.positionId, reason: 'no_cost_baseline' });
        continue;
      }
      planned.push({
        positionId: r.positionId,
        fromRateId: r.id,
        defaultLaborCostOnshore: 0,
        defaultLaborCostOffshore: o.offshore,
        offshoreOnly: true,
      });
      continue;
    }
    const pair = defaultLaborFromCostBaseline(r.costBaseline);
    if (!pair) {
      skipped.push({ positionId: r.positionId, reason: 'no_cost_baseline' });
      continue;
    }
    planned.push({
      positionId: r.positionId,
      fromRateId: r.id,
      defaultLaborCostOnshore: pair.onshore,
      defaultLaborCostOffshore: pair.offshore,
    });
  }
  return { planned, skipped };
}

/**
 * ว่าควร apply backfill ลง doc Position นี้หรือไม่
 */
export function shouldApplyToPosition(
  p: Position | { defaultLaborCostOnshore?: number; defaultLaborCostOffshore?: number },
  force: boolean,
): boolean {
  if (force) return true;
  const a = p.defaultLaborCostOnshore;
  const b = p.defaultLaborCostOffshore;
  return a == null && b == null;
}

/**
 * โหมดย้ายเฉพาะ offshore: ใส่ได้ถ้า offshore ยังว่าง (หรือ force)
 */
export function shouldApplyToPositionOffshoreOnly(
  p: Position | { defaultLaborCostOffshore?: number },
  force: boolean,
): boolean {
  if (force) return true;
  return p.defaultLaborCostOffshore == null;
}

/**
 * อัปเดต flag migration ราย worker — รันครั้งเดียว ยกเว้น `force` กับ stamp เดิม
 */
export function shouldStampWorkerMigration(
  w: { laborCostMigratedFromMainContractId?: string; laborCostMigratedAt?: number },
  contractId: string,
  force: boolean,
): boolean {
  if (force) return true;
  if (w.laborCostMigratedFromMainContractId === contractId && w.laborCostMigratedAt != null) return false;
  return true;
}
