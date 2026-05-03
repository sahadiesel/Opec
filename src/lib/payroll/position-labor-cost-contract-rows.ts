import type { MainContract, Position } from '@/lib/types';

export type PositionLaborCostContractRow = NonNullable<Position['laborCostByContract']>[number];

/** สัญญาที่ยังใช้ตั้งทะเบียนต้นทุนบนตำแหน่งได้ */
export function mainContractsForLaborCostRegistry(contracts: readonly MainContract[]): MainContract[] {
  return contracts.filter((c) => c.status === 'pending' || c.status === 'active' || c.status === 'revised');
}

/**
 * ผสมแถวที่บันทึกไว้กับรายการสัญญาหลักทั้งชุด — แต่ละสัญญามีแถวในตารางเสมอ (ค่าว่างได้)
 * แถวของสัญญาที่ปิดแล้วแต่ยังมีในข้อมูลเก่า จะต่อท้ายเพื่อไม่ให้ค่าหาย
 */
export function mergeLaborCostRowsWithMainContracts(
  existing: PositionLaborCostContractRow[] | undefined,
  allContracts: readonly MainContract[] | undefined,
): PositionLaborCostContractRow[] {
  const pool = mainContractsForLaborCostRegistry(allContracts ?? []);
  const byId = new Map((existing ?? []).map((r) => [r.contractId, r]));
  const sorted = [...pool].sort((a, b) =>
    (a.contractNumber || a.id).localeCompare(b.contractNumber || b.id, 'th'),
  );
  const activeIds = new Set(sorted.map((c) => c.id));
  const merged: PositionLaborCostContractRow[] = sorted.map((c) => {
    const prev = byId.get(c.id);
    return {
      contractId: c.id,
      customerId: c.customerId,
      contractLabel: c.contractNumber || c.title || c.id,
      onshore: prev?.onshore,
      offshore: prev?.offshore,
    };
  });
  for (const r of existing ?? []) {
    if (r.contractId && !activeIds.has(r.contractId)) {
      merged.push({ ...r });
    }
  }
  return merged;
}
