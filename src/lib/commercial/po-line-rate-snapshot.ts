import {
  collection,
  doc,
  getDocs,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import type { JobMode, POLine, Position, PositionRate, PurchaseOrder } from '@/lib/types';
import {
  buildPoLineSellSnapshots,
  effectiveNormalWorkHoursOffshore,
  effectiveNormalWorkHoursOnshore,
  resolveBillingSellWorkingDayRate,
} from '@/lib/commercial/position-rate-sell';
import { sanitizePositionRateMatrix } from '@/lib/commercial/position-rate-matrix';
import { defaultLaborDailyFromPosition } from '@/lib/payroll/timesheet-labor-base-cost';

export type PoLineRateSnapshotFields = Pick<
  POLine,
  | 'sellRateSnapshot'
  | 'sellRateSnapshotOnshore'
  | 'sellRateSnapshotOffshore'
  | 'costBaselineSnapshot'
  | 'billingUnitSnapshot'
  | 'overtimeRuleSnapshot'
  | 'sellOtRulesSnapshot'
  | 'costOtRulesSnapshot'
  | 'normalWorkHoursSnapshot'
  | 'rateMatrixSnapshot'
>;

/** สร้าง snapshot ราคาบน PO line จากตารางราคาสัญญา + โหมด On/Off ของ PO */
export function buildPoLineRateSnapshotFromContract(
  rate: PositionRate,
  poWorkMode: JobMode,
  position?: Position | null,
): PoLineRateSnapshotFields {
  const sellSnaps = buildPoLineSellSnapshots(rate, poWorkMode);
  const normalWorkHoursSnapshot =
    poWorkMode === 'OFFSHORE'
      ? effectiveNormalWorkHoursOffshore(rate)
      : effectiveNormalWorkHoursOnshore(rate);

  const fields: PoLineRateSnapshotFields = {
    sellRateSnapshot: sellSnaps.sellRateSnapshot,
    costBaselineSnapshot: defaultLaborDailyFromPosition(position) || 0,
    billingUnitSnapshot: rate.billingUnit || 'daily',
    overtimeRuleSnapshot: rate.overtimeRule || '1.5x of Hourly Rate',
    normalWorkHoursSnapshot,
  };

  if (sellSnaps.sellRateSnapshotOnshore != null) {
    fields.sellRateSnapshotOnshore = sellSnaps.sellRateSnapshotOnshore;
  }
  if (sellSnaps.sellRateSnapshotOffshore != null) {
    fields.sellRateSnapshotOffshore = sellSnaps.sellRateSnapshotOffshore;
  }
  if (rate.sellOtRules) fields.sellOtRulesSnapshot = { ...rate.sellOtRules };
  if (rate.costOtRules) fields.costOtRulesSnapshot = { ...rate.costOtRules };

  const rateMatrixSnapshot = sanitizePositionRateMatrix(rate.rateMatrix);
  if (rateMatrixSnapshot) fields.rateMatrixSnapshot = rateMatrixSnapshot;

  return fields;
}

/** ราคาขายที่แสดงบน PO — ตาม poWorkMode และ rate matrix สัญญา */
export function displayPoLineSellRateForWorkMode(
  line: POLine,
  poWorkMode: JobMode,
  contractRate?: PositionRate,
): number {
  return resolveBillingSellWorkingDayRate({
    poLine: line,
    workMode: poWorkMode,
    contractRate,
  });
}

async function loadContractRatesByPosition(
  db: Firestore,
  contractId: string,
): Promise<Map<string, PositionRate>> {
  const snap = await getDocs(collection(db, 'main_contracts', contractId, 'position_rates'));
  const map = new Map<string, PositionRate>();
  for (const d of snap.docs) {
    const rate = { id: d.id, ...(d.data() as object) } as PositionRate;
    if (rate.active === false) continue;
    map.set(rate.positionId, rate);
  }
  return map;
}

/**
 * อัปเดต snapshot ราคาทุกบรรทัด active ใต้ PO จากสัญญา
 * — ใช้เมื่อเปลี่ยน poWorkMode หรือกด sync ราคาใหม่
 */
export async function resyncPoLineRateSnapshotsForPo(
  db: Firestore,
  po: Pick<PurchaseOrder, 'id' | 'contractId' | 'poWorkMode'>,
  positionsById?: Map<string, Position>,
): Promise<{ updated: number; skipped: number }> {
  const contractId = String(po.contractId || '').trim();
  if (!contractId) return { updated: 0, skipped: 0 };

  const poWorkMode = po.poWorkMode ?? 'OFFSHORE';
  const [ratesByPosition, linesSnap] = await Promise.all([
    loadContractRatesByPosition(db, contractId),
    getDocs(collection(db, 'purchase_orders', po.id, 'po_lines')),
  ]);

  let updated = 0;
  let skipped = 0;

  for (const lineDoc of linesSnap.docs) {
    const line = { id: lineDoc.id, ...(lineDoc.data() as object) } as POLine;
    if (line.status !== 'active') {
      skipped += 1;
      continue;
    }
    const rate = ratesByPosition.get(line.positionId);
    if (!rate) {
      skipped += 1;
      continue;
    }
    const position = positionsById?.get(line.positionId);
    const snapshot = buildPoLineRateSnapshotFromContract(rate, poWorkMode, position);
    await updateDoc(
      doc(db, 'purchase_orders', po.id, 'po_lines', lineDoc.id),
      snapshot as Record<string, unknown>,
    );
    updated += 1;
  }

  return { updated, skipped };
}
