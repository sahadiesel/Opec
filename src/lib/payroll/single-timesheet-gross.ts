/**
 * คำนวณ gross รายใบ timesheet แบบเดียวกับ generatePayrollBatch (สำหรับแสดงรายวันในหน้า HR)
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  type Firestore,
} from 'firebase/firestore';
import type {
  DailyTimesheet,
  LaborCostContractTerm,
  MainContract,
  PurchaseOrder,
  RateCondition,
} from '@/lib/types';
import {
  calculateDailyLaborCost,
  resolveApplicableCostRateCondition,
} from '@/lib/services/labor-cost-calculator';
import { resolvePayrollLaborCostContractTerm } from '@/lib/services/contract-resolver';
import { computeWorkDayCostFromPackage } from '@/lib/payroll/package-labor-cost';

type GlobalCostMultiplierPolicy = {
  otAfterShift?: number;
  holiday?: number;
  publicHoliday?: number;
  sunday?: number;
  sundayOt?: number;
  standby?: number;
  mobilization?: number;
  demobilization?: number;
  travel?: number;
};

function resolveContractCostPolicy(
  contractId: string,
  contractMap: Map<string, MainContract>,
): GlobalCostMultiplierPolicy | undefined {
  const contract = contractMap.get(contractId);
  if (!contract) return undefined;
  if ((contract.contractType || 'master') === 'supplemental') {
    const sourceId = contract.inheritTermsFromContractId || contract.parentContractId;
    if (sourceId && contractMap.has(sourceId)) {
      return contractMap.get(sourceId)?.rateMultiplierPolicy?.cost;
    }
  }
  return contract.rateMultiplierPolicy?.cost;
}

function resolvePolicyFallbackCost(
  ts: DailyTimesheet,
  baseCost: number,
  policy?: GlobalCostMultiplierPolicy,
): number {
  if (!baseCost || !policy) return 0;

  switch (ts.eventType) {
    case 'standby_day':
      return baseCost * Number(policy.standby ?? 0.5) * Number(ts.standbyUnits ?? 1);
    case 'mobilization_day':
      return baseCost * Number(policy.mobilization ?? 1) * Number(ts.mobUnits ?? 1);
    case 'demobilization_day':
      return baseCost * Number(policy.demobilization ?? 1) * Number(ts.demobUnits ?? 1);
    case 'travel_day':
      return baseCost * Number(policy.travel ?? 1) * Number(ts.travelUnits ?? 1);
    case 'public_holiday_worked':
      return baseCost * Number(policy.publicHoliday ?? 1);
    case 'off_day_worked':
      return baseCost * Number(policy.holiday ?? 1);
    default:
      return 0;
  }
}

export type SingleTimesheetGrossContext = {
  allCostTerms: LaborCostContractTerm[];
  allConditions: RateCondition[];
  contractMap: Map<string, MainContract>;
  poById: Map<string, PurchaseOrder>;
  poLineById: Map<string, Record<string, unknown>>;
};

/** Gross หนึ่งใบ — สอดคล้อง loop ใน PayrollService.generatePayrollBatch */
export function computeSingleTimesheetGrossLikeBatch(
  ts: DailyTimesheet,
  ctx: SingleTimesheetGrossContext,
): number | null {
  const contract = resolvePayrollLaborCostContractTerm(
    ts,
    ctx.allCostTerms,
    ctx.contractMap,
    ctx.poById,
  );

  if (!contract) return null;

  const poLine = (ctx.poLineById.get(ts.poLineId) || {}) as Record<string, unknown>;
  const baseCost = Number(poLine.costBaselineSnapshot || 0);
  const fallbackPolicy = resolveContractCostPolicy(ts.contractId, ctx.contractMap);
  const mainContract = ctx.contractMap.get(ts.contractId);

  const useWorkDayPackage = ts.eventType === 'work_day' && baseCost > 0;

  if (useWorkDayPackage) {
    const statedHours = poLine.normalWorkHoursSnapshot === 12 ? 12 : 8;
    const costOt = poLine.costOtRulesSnapshot as { afterShift?: number } | undefined;
    const otMult =
      Number(costOt?.afterShift) ||
      Number(fallbackPolicy?.otAfterShift) ||
      1.5;
    const pkg = computeWorkDayCostFromPackage({
      timesheet: ts,
      costPackagePerDay: baseCost,
      statedHours,
      otAfterShiftMultiplier: otMult,
      mainContract,
    });
    return pkg.amount;
  }

  const condition = resolveApplicableCostRateCondition(ctx.allConditions, ts, contract);
  if (condition) {
    return calculateDailyLaborCost(ts, condition, 0);
  }

  const fallbackCost = resolvePolicyFallbackCost(ts, baseCost, fallbackPolicy);
  return fallbackCost > 0 ? fallbackCost : null;
}

/** โหลด PO / สัญญา / rate แบบเดียวกับ generate batch สำหรับชุด timesheets ของคนงานคนเดียว */
export async function buildSingleTimesheetGrossContext(
  db: Firestore,
  timesheets: DailyTimesheet[],
): Promise<SingleTimesheetGrossContext | null> {
  if (timesheets.length === 0) return null;

  const [rateConditionsSnap, costTermsSnap] = await Promise.all([
    getDocs(collection(db, 'rate_conditions')),
    getDocs(collection(db, 'labor_cost_contract_terms')),
  ]);
  const allConditions = rateConditionsSnap.docs.map(
    (d) => ({ ...d.data(), id: d.id } as RateCondition),
  );
  const allCostTerms = costTermsSnap.docs.map(
    (d) => ({ ...d.data(), id: d.id } as LaborCostContractTerm),
  );

  const contractMap = new Map<string, MainContract>();
  const contractIds = Array.from(new Set(timesheets.map((ts) => ts.contractId).filter(Boolean)));
  await Promise.all(
    contractIds.map(async (contractId) => {
      const contractSnap = await getDoc(doc(db, 'main_contracts', contractId));
      if (contractSnap.exists()) {
        contractMap.set(contractId, { ...(contractSnap.data() as MainContract), id: contractSnap.id });
      }
    }),
  );
  const inheritIds = Array.from(
    new Set(
      Array.from(contractMap.values())
        .filter((c) => (c.contractType || 'master') === 'supplemental')
        .map((c) => c.inheritTermsFromContractId || c.parentContractId)
        .filter(Boolean),
    ),
  ) as string[];
  await Promise.all(
    inheritIds.map(async (contractId) => {
      if (contractMap.has(contractId)) return;
      const contractSnap = await getDoc(doc(db, 'main_contracts', contractId));
      if (contractSnap.exists()) {
        contractMap.set(contractId, { ...(contractSnap.data() as MainContract), id: contractSnap.id });
      }
    }),
  );

  const poLineById = new Map<string, Record<string, unknown>>();
  const poIds = Array.from(new Set(timesheets.map((ts) => ts.purchaseOrderId).filter(Boolean)));
  const poById = new Map<string, PurchaseOrder>();
  await Promise.all(
    poIds.map(async (poId) => {
      const [linesSnap, poSnap] = await Promise.all([
        getDocs(collection(db, 'purchase_orders', poId, 'po_lines')),
        getDoc(doc(db, 'purchase_orders', poId)),
      ]);
      linesSnap.docs.forEach((lineDoc) => poLineById.set(lineDoc.id, lineDoc.data() as Record<string, unknown>));
      if (poSnap.exists()) {
        poById.set(poId, { id: poSnap.id, ...(poSnap.data() as object) } as PurchaseOrder);
      }
    }),
  );

  return { allConditions, allCostTerms, contractMap, poById, poLineById };
}
