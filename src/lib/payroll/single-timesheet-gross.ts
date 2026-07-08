/**
 * คำนวณ gross รายใบ timesheet แบบเดียวกับ generatePayrollBatch (สำหรับแสดงรายวันในหน้า HR)
 */
import { collection, doc, getDoc, getDocs, type Firestore } from 'firebase/firestore';
import type { DailyTimesheet, JobMode, MainContract, Position, Worker } from '@/lib/types';
import {
  loadWorkersAndPositionsForPayroll,
  collectPayrollContractIds,
  loadPayrollPoLineMaps,
  loadPayrollPoContractIdMap,
  loadPayrollPoWorkModeMap,
  buildPoWorkModeMapFromPurchaseOrders,
  resolvePoLineForPayrollTimesheet,
  type PayrollPoLineMaps,
} from '@/lib/payroll/timesheet-labor-base-cost';
import { computeRegistryWorkerTimesheetGross } from '@/lib/payroll/registry-worker-timesheet-gross';
import type { WorkerGlobalLaborContext } from '@/lib/payroll/worker-global-labor-policy';
import { fetchWorkerGlobalLaborContextFromFirestore } from '@/lib/payroll/worker-global-labor-policy';

export type SingleTimesheetGrossContext = {
  contractMap: Map<string, MainContract>;
  poLineMaps: PayrollPoLineMaps;
  poContractById: Map<string, string>;
  poWorkModeByPoId: Map<string, JobMode>;
  workerById: Map<string, Worker>;
  posById: Map<string, Position>;
  workerGlobalLabor: WorkerGlobalLaborContext;
};

/** Gross หนึ่งใบ — สอดคล้อง loop ใน PayrollService.generatePayrollBatch */
export function computeSingleTimesheetGrossLikeBatch(
  ts: DailyTimesheet,
  ctx: SingleTimesheetGrossContext,
): number | null {
  const poLine = resolvePoLineForPayrollTimesheet(ts, ctx.poLineMaps);
  const wk = ctx.workerById.get(ts.workerId);
  const linePos = ts.positionId ? ctx.posById.get(ts.positionId) : undefined;
  const r = computeRegistryWorkerTimesheetGross(ts, {
    worker: wk,
    linePosition: linePos,
    poLine,
    contractMap: ctx.contractMap,
    poContractById: ctx.poContractById,
    poWorkModeByPoId: ctx.poWorkModeByPoId,
    workerGlobalLabor: ctx.workerGlobalLabor,
  });
  return r.gross > 0 ? r.gross : null;
}

/** โหลด PO lines / สัญญา แบบเดียวกับ generate batch สำหรับชุด timesheets ของคนงาน */
export async function buildSingleTimesheetGrossContext(
  db: Firestore,
  timesheets: DailyTimesheet[],
): Promise<SingleTimesheetGrossContext | null> {
  if (timesheets.length === 0) return null;
  const { workerById, posById } = await loadWorkersAndPositionsForPayroll(db, timesheets);

  const poIds = Array.from(new Set(timesheets.map((ts) => ts.purchaseOrderId).filter(Boolean)));
  const [poLineMaps, poContractById, poWorkModeByPoId] = await Promise.all([
    loadPayrollPoLineMaps(db, poIds),
    loadPayrollPoContractIdMap(db, poIds),
    loadPayrollPoWorkModeMap(db, poIds),
  ]);

  const contractMap = new Map<string, MainContract>();
  const contractIds = collectPayrollContractIds(timesheets, poContractById);
  await Promise.all(
    contractIds.map(async (contractId) => {
      const contractSnap = await getDoc(doc(db, 'main_contracts', contractId));
      if (contractSnap.exists()) {
        const contractData = { ...(contractSnap.data() as MainContract), id: contractSnap.id };
        const ratesSnap = await getDocs(collection(db, 'main_contracts', contractId, 'position_rates'));
        contractData.positionRates = ratesSnap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as PositionRate));
        contractMap.set(contractId, contractData);
      }
    }),
  );
  const inheritIds = Array.from(
    new Set(
      Array.from(contractMap.values())
        .filter((c) => (c.contractType || 'master') === 'supplemental')
        .map((c) => c.inheritTermsFromContractId || c.parentContractId)
        .filter(Boolean) as string[],
    ),
  );
  await Promise.all(
    inheritIds.map(async (contractId) => {
      if (contractMap.has(contractId)) return;
      const contractSnap = await getDoc(doc(db, 'main_contracts', contractId));
      if (contractSnap.exists()) {
        const contractData = { ...(contractSnap.data() as MainContract), id: contractSnap.id };
        const ratesSnap = await getDocs(collection(db, 'main_contracts', contractId, 'position_rates'));
        contractData.positionRates = ratesSnap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as PositionRate));
        contractMap.set(contractId, contractData);
      }
    }),
  );

  const workerGlobalLabor = await fetchWorkerGlobalLaborContextFromFirestore(db);

  return { contractMap, poLineMaps, poContractById, poWorkModeByPoId, workerById, posById, workerGlobalLabor };
}
