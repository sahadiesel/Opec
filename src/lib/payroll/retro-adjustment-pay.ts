import { collection, doc, getDoc, getDocs, query, where, type Firestore } from 'firebase/firestore';
import type { DailyTimesheet, JobMode, PositionRate, PositionRateMatrixCategory } from '@/lib/types';
import { resolveMatrixCostRate } from '@/lib/commercial/position-rate-matrix';
import { isPayrollCostStandbyPackageEvent } from '@/lib/payroll/package-labor-cost';
import {
  loadPayrollPoContractIdMap,
  loadPayrollPoWorkModeMap,
  resolveEffectivePayrollContractId,
  resolveEffectivePayrollJobMode,
} from '@/lib/payroll/timesheet-labor-base-cost';

export type RetroHoursDelta = {
  addedOt15Hours?: number;
  addedOt20Hours?: number;
  addedOt30Hours?: number;
  addedStandbyHours?: number;
  addedM1Trips?: number;
  addedD1Trips?: number;
};

export type RetroMissingRateInfo = {
  fieldLabel: string;
  category: PositionRateMatrixCategory;
  contractId: string;
  positionId: string;
};

export type RetroPayComputeResult = {
  amountBaht: number;
  ok: boolean;
  missingRates: RetroMissingRateInfo[];
  contractId: string;
  positionId: string;
  contractLabel?: string;
};

export class RetroRateMatrixMissingError extends Error {
  readonly missingRates: RetroMissingRateInfo[];
  readonly contractId: string;
  readonly positionId: string;

  constructor(missing: RetroMissingRateInfo[], contractId: string, positionId: string) {
    const labels = missing.map((m) => m.fieldLabel).join(', ');
    super(`ยังไม่ได้ใส่อัตราในตารางสัญญา: ${labels}`);
    this.name = 'RetroRateMatrixMissingError';
    this.missingRates = missing;
    this.contractId = contractId;
    this.positionId = positionId;
  }
}

function roundMoney(n: number): number {
  return Math.round(Math.max(0, n) * 100) / 100;
}

function statedHoursForMode(rate: PositionRate, workMode: JobMode): number {
  if (workMode === 'ONSHORE') {
    return rate.normalWorkHoursOnshore === 12 ? 12 : 8;
  }
  return rate.normalWorkHoursOffshore === 8 ? 8 : 12;
}

function requireCostRate(
  rate: PositionRate,
  category: PositionRateMatrixCategory,
  fieldLabel: string,
  contractId: string,
  positionId: string,
  missing: RetroMissingRateInfo[],
): number | null {
  const v = resolveMatrixCostRate(rate, category);
  if (v == null || v <= 0) {
    missing.push({ fieldLabel, category, contractId, positionId });
    return null;
  }
  return v;
}

/** คำนวณยอดจ่ายเพิ่มจากตารางอัตรา (ฝั่งต้นทุน Cost) — ไม่ใช้สูตรแพ็ก×1.5 */
export function computeRetroAdjustmentPayFromRateMatrix(
  ts: DailyTimesheet,
  delta: RetroHoursDelta,
  positionRate: PositionRate,
  workMode: JobMode,
  contractId: string,
): RetroPayComputeResult {
  const positionId = (ts.positionId || positionRate.positionId || '').trim();
  const missing: RetroMissingRateInfo[] = [];
  let amount = 0;

  const ot15 = Math.max(0, Number(delta.addedOt15Hours) || 0);
  const ot20 = Math.max(0, Number(delta.addedOt20Hours) || 0);
  const ot30 = Math.max(0, Number(delta.addedOt30Hours) || 0);
  const sb = Math.max(0, Number(delta.addedStandbyHours) || 0);
  const m1Trips = Math.max(0, Number(delta.addedM1Trips) || 0);
  const d1Trips = Math.max(0, Number(delta.addedD1Trips) || 0);
  const isOffshore = workMode !== 'ONSHORE';

  if (ts.eventType === 'work_day') {
    if (isOffshore) {
      if (ot15 > 0) {
        const r = requireCostRate(
          positionRate,
          'offshore_ot_per_hour',
          'OFF OT/hr (ต้นทุน)',
          contractId,
          positionId,
          missing,
        );
        if (r != null) amount += ot15 * r;
      }
      if (ot20 > 0) {
        const r = requireCostRate(
          positionRate,
          'offshore_ot_per_hour',
          'OFF OT/hr (ต้นทุน) — OT2',
          contractId,
          positionId,
          missing,
        );
        if (r != null) amount += ot20 * r;
      }
      if (ot30 > 0) {
        const r = requireCostRate(
          positionRate,
          'offshore_ot_per_hour',
          'OFF OT/hr (ต้นทุน) — OT3',
          contractId,
          positionId,
          missing,
        );
        if (r != null) amount += ot30 * r;
      }
    } else {
      if (ot15 > 0) {
        const r = requireCostRate(
          positionRate,
          'onshore_ot_normal_per_hour',
          'ON OT (ต้นทุน)',
          contractId,
          positionId,
          missing,
        );
        if (r != null) amount += ot15 * r;
      }
      if (ot20 > 0) {
        const r = requireCostRate(
          positionRate,
          'onshore_ot2_per_hour',
          'ON OT2 (ต้นทุน)',
          contractId,
          positionId,
          missing,
        );
        if (r != null) amount += ot20 * r;
      }
      if (ot30 > 0) {
        const r = requireCostRate(
          positionRate,
          'onshore_ot3_per_hour',
          'ON OT3 (ต้นทุน)',
          contractId,
          positionId,
          missing,
        );
        if (r != null) amount += ot30 * r;
      }
    }
  }

  if (m1Trips > 0) {
    const r = requireCostRate(
      positionRate,
      'offshore_m1_per_trip',
      'OFF M1 (ต้นทุน/trip)',
      contractId,
      positionId,
      missing,
    );
    if (r != null) amount += m1Trips * r;
  }

  if (d1Trips > 0) {
    const r = requireCostRate(
      positionRate,
      'offshore_d1_per_trip',
      'OFF D1 (ต้นทุน/trip)',
      contractId,
      positionId,
      missing,
    );
    if (r != null) amount += d1Trips * r;
  }

  if (isPayrollCostStandbyPackageEvent(ts.eventType) && sb > 0) {
    const cat: PositionRateMatrixCategory = isOffshore ? 'offshore_standby_day' : 'onshore_standby_day';
    const label = isOffshore ? 'OFF SB (ต้นทุน/วัน)' : 'ON SB (ต้นทุน/วัน)';
    const dayRate = requireCostRate(positionRate, cat, label, contractId, positionId, missing);
    if (dayRate != null) {
      const hrs = statedHoursForMode(positionRate, workMode);
      amount += sb * (dayRate / hrs);
    }
  }

  return {
    amountBaht: roundMoney(amount),
    ok: missing.length === 0,
    missingRates: missing,
    contractId,
    positionId,
  };
}

async function loadPositionRateForContract(
  db: Firestore,
  contractId: string,
  positionId: string,
): Promise<PositionRate | null> {
  const pid = positionId.trim();
  const cid = contractId.trim();
  if (!cid || !pid) return null;
  const snap = await getDocs(
    query(collection(db, 'main_contracts', cid, 'position_rates'), where('positionId', '==', pid)),
  );
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) } as PositionRate))
    .filter((r) => r.active !== false);
  if (rows.length === 0) return null;
  return rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null;
}

export async function computeRetroAdjustmentPayFromFirestore(
  db: Firestore,
  base: DailyTimesheet,
  delta: RetroHoursDelta,
): Promise<RetroPayComputeResult> {
  const poContractById = await loadPayrollPoContractIdMap(db, [base.purchaseOrderId].filter(Boolean));
  const contractId = resolveEffectivePayrollContractId(base, poContractById);
  const positionId = (base.positionId || '').trim();

  if (!contractId) {
    return {
      amountBaht: 0,
      ok: false,
      missingRates: [],
      contractId: '',
      positionId,
    };
  }

  const positionRate = await loadPositionRateForContract(db, contractId, positionId);
  if (!positionRate) {
    return {
      amountBaht: 0,
      ok: false,
      missingRates: [
        {
          fieldLabel: 'ไม่พบแถวอัตราตำแหน่งในสัญญา',
          category: 'offshore_working_day',
          contractId,
          positionId,
        },
      ],
      contractId,
      positionId,
    };
  }

  const poWorkModeByPoId = await loadPayrollPoWorkModeMap(db, [base.purchaseOrderId].filter(Boolean));
  const workMode = resolveEffectivePayrollJobMode(base, poWorkModeByPoId);

  let contractLabel: string | undefined;
  try {
    const cSnap = await getDoc(doc(db, 'main_contracts', contractId));
    if (cSnap.exists()) {
      const c = cSnap.data() as { contractNumber?: string };
      contractLabel = c.contractNumber;
    }
  } catch {
    contractLabel = undefined;
  }

  const result = computeRetroAdjustmentPayFromRateMatrix(base, delta, positionRate, workMode, contractId);
  return { ...result, contractLabel };
}

/** @deprecated ใช้ computeRetroAdjustmentPayFromFirestore — คง alias ให้ import เก่า */
export async function computeRetroAdjustmentPayBahtFromFirestore(
  db: Firestore,
  base: DailyTimesheet,
  delta: RetroHoursDelta,
): Promise<number> {
  const r = await computeRetroAdjustmentPayFromFirestore(db, base, delta);
  if (!r.ok && r.missingRates.length > 0) {
    throw new RetroRateMatrixMissingError(r.missingRates, r.contractId, r.positionId);
  }
  return r.amountBaht;
}

export function retroHoursDeltaFromAdjustment(input: {
  addedOt15Hours?: number;
  addedOt20Hours?: number;
  addedOt30Hours?: number;
  addedStandbyHours?: number;
  addedM1Trips?: number;
  addedD1Trips?: number;
}): RetroHoursDelta {
  return {
    addedOt15Hours: Math.max(0, Number(input.addedOt15Hours) || 0) || undefined,
    addedOt20Hours: Math.max(0, Number(input.addedOt20Hours) || 0) || undefined,
    addedOt30Hours: Math.max(0, Number(input.addedOt30Hours) || 0) || undefined,
    addedStandbyHours: Math.max(0, Number(input.addedStandbyHours) || 0) || undefined,
    addedM1Trips: Math.max(0, Number(input.addedM1Trips) || 0) || undefined,
    addedD1Trips: Math.max(0, Number(input.addedD1Trips) || 0) || undefined,
  };
}

export function retroContractRatesUrl(contractId: string): string {
  return `/main-contracts/${encodeURIComponent(contractId)}`;
}
