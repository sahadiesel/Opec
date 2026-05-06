import type { Assignment, DeploymentStatus, PurchaseOrder } from '@/lib/types';
import { assignmentReleasedFromPoLineQuota } from '@/lib/ops/po-fulfillment-read-model';

/**
 * Statuses where a worker is considered "occupied" and cannot be assigned elsewhere.
 * DEMOBILIZED and CLOSED mean the worker is free.
 */
const BLOCKING_STATUSES: Set<DeploymentStatus> = new Set([
  'DRAFT',
  'READINESS_CHECK',
  'CLIENT_SUBMITTED',
  'CLIENT_APPROVED',
  'CONFIRMED',
  'READY_TO_MOB',
  'MOBILIZING',
  'ACTIVE',
]);

/** เฟส 2 PO workflow: Unassign แล้วว่างสล็อต — สอดคล้องการปล่อยโควต้า (รองรับ Timestamp) */
export function assignmentOccupiesWorkerSlot(a: Assignment): boolean {
  if (assignmentReleasedFromPoLineQuota(a)) return false;
  return BLOCKING_STATUSES.has(a.deploymentStatus);
}

export interface OverlapResult {
  hasOverlap: boolean;
  blockingAssignments: Pick<
    Assignment,
    'id' | 'assignmentNo' | 'waveId' | 'projectName' | 'startDate' | 'endDate' | 'deploymentStatus'
  >[];
}

/**
 * เฟส 2: คนงานมีได้แค่หนึ่ง mobilization ที่ “ยังจับสล็อต” — ไม่ใช้ช่วงวันที่ทับซ้อน
 */
export function checkWorkerAssignmentOverlap(
  allAssignments: Assignment[],
  workerId: string,
  excludeAssignmentId?: string,
): OverlapResult {
  const blocking = allAssignments.filter((a) => {
    if (a.workerId !== workerId) return false;
    if (excludeAssignmentId && a.id === excludeAssignmentId) return false;
    return assignmentOccupiesWorkerSlot(a);
  });

  return {
    hasOverlap: blocking.length > 0,
    blockingAssignments: blocking.map((a) => ({
      id: a.id,
      assignmentNo: a.assignmentNo,
      waveId: a.waveId,
      projectName: a.projectName,
      startDate: a.startDate,
      endDate: a.endDate,
      deploymentStatus: a.deploymentStatus,
    })),
  };
}

/**
 * Returns set of worker IDs that currently have at least one blocking assignment.
 * Used to grey-out / hide workers in the assignment dropdown.
 */
export function getOccupiedWorkerIds(allAssignments: Assignment[]): Set<string> {
  const ids = new Set<string>();
  for (const a of allAssignments) {
    if (assignmentOccupiesWorkerSlot(a)) {
      ids.add(a.workerId);
    }
  }
  return ids;
}

/** ช่วง startDate/endDate (yyyy-mm-dd) เก็บใน mobilization — ผูกกับ PO (เฟส 2) */
export function mobilizationScheduleFromPo(
  po: Pick<PurchaseOrder, 'startDate' | 'endDate'>,
): { startDate: string; endDate: string } {
  const msToYmd = (ms: unknown): string => {
    const n = typeof ms === 'number' && Number.isFinite(ms) ? ms : Date.now();
    return new Date(n).toISOString().slice(0, 10);
  };
  const startDate = msToYmd(po.startDate);
  let endDate = msToYmd(po.endDate);
  if (endDate < startDate) endDate = startDate;
  return { startDate, endDate };
}
