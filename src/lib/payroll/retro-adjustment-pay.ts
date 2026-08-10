import { collection, doc, getDoc, getDocs, query, where, type Firestore } from 'firebase/firestore';
import type { DailyTimesheet, JobMode, PositionRate, PositionRateMatrixCategory, Worker } from '@/lib/types';
import { resolveMatrixCostRate } from '@/lib/commercial/position-rate-matrix';
import {
  deriveOtHourlyRatesFromDailyPackage,
  PACKAGE_OT_TIER_MULT,
  type StatedPackageHours,
} from '@/lib/commercial/package-hourly-rate';
import { isPayrollCostStandbyPackageEvent } from '@/lib/payroll/package-labor-cost';
import {
  loadPayrollPoContractIdMap,
  loadPayrollPoWorkModeMap,
  resolveEffectivePayrollContractId,
  resolveEffectivePayrollJobMode,
  workerCustomLaborRateForMode,
} from '@/lib/payroll/timesheet-labor-base-cost';
import type { LaborCostWorkMode } from '@/lib/payroll/labor-cost-model';

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
  /** worker_custom = ยึดฐานจากทะเบียนลูกจ้าง (สูตรแพ็ก 8+4 OT) · matrix = ตารางสัญญา */
  rateSource?: 'worker_custom' | 'contract_matrix';
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

function statedHoursForMode(rate: PositionRate | null | undefined, workMode: JobMode): StatedPackageHours {
  if (workMode === 'ONSHORE') {
    return rate?.normalWorkHoursOnshore === 12 ? 12 : 8;
  }
  return rate?.normalWorkHoursOffshore === 8 ? 8 : 12;
}

function laborModeFromJobMode(workMode: JobMode): LaborCostWorkMode {
  return workMode === 'ONSHORE' ? 'onshore' : 'offshore';
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

/**
 * คำนวณยอดตกเบิกจากฐานรายวันของทะเบียนลูกจ้าง
 * ออฟชอร์ 12 ชม. = 8 ปกติ + 4 OT → OT1.5/ชม. = (D/14)×1.5
 */
export function computeRetroAdjustmentPayFromWorkerDailyPackage(
  ts: DailyTimesheet,
  delta: RetroHoursDelta,
  dailyPackageBaht: number,
  workMode: JobMode,
  opts?: {
    statedHours?: StatedPackageHours;
    otAfterShiftMultiplier?: number;
    standbyDayMultiplier?: number;
    contractId?: string;
  },
): RetroPayComputeResult {
  const positionId = (ts.positionId || '').trim();
  const contractId = (opts?.contractId || '').trim();
  const isOffshore = workMode !== 'ONSHORE';
  const stated: StatedPackageHours = opts?.statedHours ?? (isOffshore ? 12 : 8);
  const otMult = opts?.otAfterShiftMultiplier ?? PACKAGE_OT_TIER_MULT.OT_1_5;
  const sbDayMult = opts?.standbyDayMultiplier ?? 0.5;
  const pkg = Math.max(0, Number(dailyPackageBaht) || 0);

  if (pkg <= 0) {
    return {
      amountBaht: 0,
      ok: false,
      missingRates: [],
      contractId,
      positionId,
      rateSource: 'worker_custom',
    };
  }

  const rates = deriveOtHourlyRatesFromDailyPackage(pkg, stated, otMult);
  let amount = 0;

  const ot15 = Math.max(0, Number(delta.addedOt15Hours) || 0);
  const ot20 = Math.max(0, Number(delta.addedOt20Hours) || 0);
  const ot30 = Math.max(0, Number(delta.addedOt30Hours) || 0);
  const sb = Math.max(0, Number(delta.addedStandbyHours) || 0);
  const m1Trips = Math.max(0, Number(delta.addedM1Trips) || 0);
  const d1Trips = Math.max(0, Number(delta.addedD1Trips) || 0);

  if (ts.eventType === 'work_day') {
    amount += ot15 * rates.ot15Hourly;
    amount += ot20 * rates.ot20Hourly;
    amount += ot30 * rates.ot30Hourly;
  }

  if (m1Trips > 0) amount += m1Trips * pkg * sbDayMult;
  if (d1Trips > 0) amount += d1Trips * pkg * sbDayMult;

  if (isPayrollCostStandbyPackageEvent(ts.eventType) && sb > 0) {
    amount += pkg * (sb / stated) * sbDayMult;
  }

  const amountBaht = roundMoney(amount);
  return {
    amountBaht,
    ok: amountBaht > 0 || ot15 + ot20 + ot30 + sb + m1Trips + d1Trips <= 0,
    missingRates: [],
    contractId,
    positionId,
    rateSource: 'worker_custom',
  };
}

/** คำนวณยอดจ่ายเพิ่มจากตารางอัตรา (ฝั่งต้นทุน Cost) — เมื่อใช้ตารางสัญญา */
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
      amount += dayRate * (sb / hrs);
    }
  }

  const amountBaht = roundMoney(amount);
  return {
    amountBaht,
    ok: missing.length === 0,
    missingRates: missing,
    contractId,
    positionId,
    rateSource: 'contract_matrix',
  };
}

async function loadPositionRateForContract(
  db: Firestore,
  contractId: string,
  positionId: string,
): Promise<PositionRate | null> {
  const cid = contractId.trim();
  const pid = positionId.trim();
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
  const poWorkModeByPoId = await loadPayrollPoWorkModeMap(db, [base.purchaseOrderId].filter(Boolean));
  const workMode = resolveEffectivePayrollJobMode(base, poWorkModeByPoId);

  let contractLabel: string | undefined;
  if (contractId) {
    try {
      const cSnap = await getDoc(doc(db, 'main_contracts', contractId));
      if (cSnap.exists()) {
        const c = cSnap.data() as { contractNumber?: string };
        contractLabel = c.contractNumber;
      }
    } catch {
      contractLabel = undefined;
    }
  }

  /** ถ้าระบุฐานเองในทะเบียนลูกจ้าง → ยึดสูตรแพ็ก (ออฟชอร์ 8+4 OT) ไม่ใช้ OFF OT/hr ในสัญญา */
  const workerId = String(base.workerId || '').trim();
  if (workerId) {
    try {
      const wSnap = await getDoc(doc(db, 'workers', workerId));
      if (wSnap.exists()) {
        const worker = { id: wSnap.id, ...(wSnap.data() as object) } as Worker;
        if (worker.laborCostUsePositionDefault === false) {
          const customDaily = workerCustomLaborRateForMode(worker, laborModeFromJobMode(workMode));
          if (customDaily > 0) {
            const positionRate = contractId
              ? await loadPositionRateForContract(db, contractId, positionId)
              : null;
            const stated = statedHoursForMode(positionRate, workMode);
            const result = computeRetroAdjustmentPayFromWorkerDailyPackage(
              base,
              delta,
              customDaily,
              workMode,
              { statedHours: stated, contractId },
            );
            return { ...result, contractLabel };
          }
        }
      }
    } catch {
      /* fall through to matrix */
    }
  }

  if (!contractId) {
    return {
      amountBaht: 0,
      ok: false,
      missingRates: [],
      contractId: '',
      positionId,
      contractLabel,
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
      contractLabel,
    };
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
