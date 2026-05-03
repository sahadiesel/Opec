/**
 * คำนวณ gross รายใบ timesheet แบบเดียวกับ generatePayrollBatch (สำหรับแสดงรายวันในหน้า HR)
 */
import { collection, doc, getDoc, getDocs, type Firestore } from 'firebase/firestore';
import type { DailyTimesheet, MainContract, Position, PurchaseOrder, Worker } from '@/lib/types';
import { loadWorkersAndPositionsForPayroll } from '@/lib/payroll/timesheet-labor-base-cost';
import { computeRegistryWorkerTimesheetGross } from '@/lib/payroll/registry-worker-timesheet-gross';
import type { WorkerGlobalLaborContext } from '@/lib/payroll/worker-global-labor-policy';
import { fetchWorkerGlobalLaborContextFromFirestore } from '@/lib/payroll/worker-global-labor-policy';

export type SingleTimesheetGrossContext = {
  contractMap: Map<string, MainContract>;
  poLineById: Map<string, Record<string, unknown>>;
  workerById: Map<string, Worker>;
  posById: Map<string, Position>;
  workerGlobalLabor: WorkerGlobalLaborContext;
};

/** Gross หนึ่งใบ — สอดคล้อง loop ใน PayrollService.generatePayrollBatch */
export function computeSingleTimesheetGrossLikeBatch(
  ts: DailyTimesheet,
  ctx: SingleTimesheetGrossContext,
): number | null {
  const poLine = (ctx.poLineById.get(ts.poLineId) || {}) as Record<string, unknown>;
  const wk = ctx.workerById.get(ts.workerId);
  const linePos = ts.positionId ? ctx.posById.get(ts.positionId) : undefined;
  const r = computeRegistryWorkerTimesheetGross(ts, {
    worker: wk,
    linePosition: linePos,
    poLine,
    contractMap: ctx.contractMap,
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
        .filter(Boolean) as string[],
    ),
  );
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
  await Promise.all(
    poIds.map(async (poId) => {
      const linesSnap = await getDocs(collection(db, 'purchase_orders', poId, 'po_lines'));
      linesSnap.docs.forEach((lineDoc) => poLineById.set(lineDoc.id, lineDoc.data() as Record<string, unknown>));
    }),
  );

  const workerGlobalLabor = await fetchWorkerGlobalLaborContextFromFirestore(db);

  return { contractMap, poLineById, workerById, posById, workerGlobalLabor };
}
