import type { MainContract, Position } from '@/lib/types';

export type PositionLaborCostContractRow = NonNullable<Position['laborCostByContract']>[number];

export type PositionLaborDefaults = {
  onshore?: number;
  offshore?: number;
};

function positiveLaborRate(v: unknown): number | undefined {
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** ค่าที่บันทึกบนทะเบียนตำแหน่ง + ทับบนสัญญาหลัก (ไม่รวมฐานมาตรฐานตำแหน่ง) */
export function resolveLaborCostRowRates(
  prev: PositionLaborCostContractRow | undefined,
  baseline: { onshore?: number; offshore?: number } | undefined,
): { onshore?: number; offshore?: number } {
  return {
    onshore: positiveLaborRate(prev?.onshore) ?? positiveLaborRate(baseline?.onshore),
    offshore: positiveLaborRate(prev?.offshore) ?? positiveLaborRate(baseline?.offshore),
  };
}

/**
 * ต้นทุนที่แสดง — ให้ตรงกับหน้าสัญญาหลัก (effectiveLabor*):
 * ทะเบียนตำแหน่ง → ทับบนสัญญา → ฐานมาตรฐานตำแหน่ง
 */
export function resolveEffectiveLaborCostRowRates(
  prev: PositionLaborCostContractRow | undefined,
  baseline: { onshore?: number; offshore?: number } | undefined,
  positionDefaults?: PositionLaborDefaults,
): { onshore?: number; offshore?: number } {
  const stored = resolveLaborCostRowRates(prev, baseline);
  return {
    onshore: stored.onshore ?? positiveLaborRate(positionDefaults?.onshore),
    offshore: stored.offshore ?? positiveLaborRate(positionDefaults?.offshore),
  };
}

export function rowHasExplicitLaborCostRates(
  row: Pick<PositionLaborCostContractRow, 'onshore' | 'offshore'>,
): boolean {
  return positiveLaborRate(row.onshore) != null || positiveLaborRate(row.offshore) != null;
}

/** แสดงแถวเมื่อมีทับ/ทะเบียน หรือมี position_rate บนสัญญานั้น (เหมือนแท็บอัตราในสัญญา) */
export function rowShouldShowOnPositionLaborTable(
  row: Pick<PositionLaborCostContractRow, 'contractId' | 'onshore' | 'offshore'>,
  contractIdsWithPositionRate?: ReadonlySet<string>,
): boolean {
  if (rowHasExplicitLaborCostRates(row)) return true;
  return Boolean(row.contractId && contractIdsWithPositionRate?.has(row.contractId));
}

/** สัญญาที่ยังใช้ตั้งทะเบียนต้นทุนบนตำแหน่งได้ */
export function mainContractsForLaborCostRegistry(contracts: readonly MainContract[]): MainContract[] {
  return contracts.filter((c) => c.status === 'pending' || c.status === 'active' || c.status === 'revised');
}

function buildMergedLaborCostRows(
  existing: PositionLaborCostContractRow[] | undefined,
  allContracts: readonly MainContract[] | undefined,
  positionId: string | undefined,
  positionDefaults?: PositionLaborDefaults,
  contractIdsWithPositionRate?: ReadonlySet<string>,
): PositionLaborCostContractRow[] {
  const pool = mainContractsForLaborCostRegistry(allContracts ?? []);
  const byId = new Map((existing ?? []).map((r) => [r.contractId, r]));
  const sorted = [...pool].sort((a, b) =>
    (a.contractNumber || a.id).localeCompare(b.contractNumber || b.id, 'th'),
  );
  const activeIds = new Set(sorted.map((c) => c.id));
  const pid = (positionId || '').trim();

  const merged: PositionLaborCostContractRow[] = sorted.map((c) => {
    const prev = byId.get(c.id);
    const baseline = pid ? c.laborCostBaselinesByPositionId?.[pid] : undefined;
    const onContractRateTab = Boolean(contractIdsWithPositionRate?.has(c.id));
    const rates = onContractRateTab
      ? resolveEffectiveLaborCostRowRates(prev, baseline, positionDefaults)
      : resolveLaborCostRowRates(prev, baseline);
    return {
      contractId: c.id,
      customerId: c.customerId,
      contractLabel: c.contractNumber || c.title || c.id,
      onshore: rates.onshore,
      offshore: rates.offshore,
    };
  });

  for (const r of existing ?? []) {
    if (r.contractId && !activeIds.has(r.contractId)) {
      const contract = (allContracts ?? []).find((c) => c.id === r.contractId);
      const baseline = pid && contract ? contract.laborCostBaselinesByPositionId?.[pid] : undefined;
      const onContractRateTab = Boolean(contractIdsWithPositionRate?.has(r.contractId));
      const rates = onContractRateTab
        ? resolveEffectiveLaborCostRowRates(r, baseline, positionDefaults)
        : resolveLaborCostRowRates(r, baseline);
      merged.push({
        ...r,
        onshore: rates.onshore,
        offshore: rates.offshore,
      });
    }
  }
  return merged;
}

export type MergeLaborCostRowsOptions = {
  includeEmptyRows?: boolean;
  positionDefaults?: PositionLaborDefaults;
  contractIdsWithPositionRate?: ReadonlySet<string>;
};

/**
 * ผสมแถวสำหรับหน้าตำแหน่ง — แสดงสัญญาที่มี position_rate + ต้นทุนที่ใช้จริง (ตรงหน้าสัญญา)
 * โหมดแก้ไข: `includeEmptyRows` แสดงสัญญาที่ใช้งานได้ทั้งหมดเพื่อกรอกค่า
 */
export function mergeLaborCostRowsWithMainContracts(
  existing: PositionLaborCostContractRow[] | undefined,
  allContracts: readonly MainContract[] | undefined,
  positionId?: string,
  options?: MergeLaborCostRowsOptions,
): PositionLaborCostContractRow[] {
  const merged = buildMergedLaborCostRows(
    existing,
    allContracts,
    positionId,
    options?.positionDefaults,
    options?.contractIdsWithPositionRate,
  );
  if (options?.includeEmptyRows) return merged;
  return merged.filter((row) => rowShouldShowOnPositionLaborTable(row, options?.contractIdsWithPositionRate));
}

/** บันทึกลง Firestore — เก็บเฉพาะทับ/ทะเบียน (ไม่ auto-save ฐานมาตรฐาน) */
export function mergeLaborCostRowsForPersist(
  existing: PositionLaborCostContractRow[] | undefined,
  allContracts: readonly MainContract[] | undefined,
  positionId?: string,
): PositionLaborCostContractRow[] {
  return buildMergedLaborCostRows(existing, allContracts, positionId).filter(rowHasExplicitLaborCostRates);
}

/** ดึง main_contract id จาก path `main_contracts/{id}/position_rates/{rateId}` */
export function mainContractIdFromPositionRatePath(path: string): string | null {
  const parts = path.split('/');
  if (parts[0] !== 'main_contracts' || parts[2] !== 'position_rates' || !parts[1]) return null;
  return parts[1];
}
