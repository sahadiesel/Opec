import type { Assignment, DeploymentStatus } from '@/lib/types';

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

export interface OverlapResult {
  hasOverlap: boolean;
  blockingAssignments: Pick<Assignment, 'id' | 'assignmentNo' | 'waveId' | 'projectName' | 'startDate' | 'endDate' | 'deploymentStatus'>[];
}

function datesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Check if a worker already has active (non-closed) assignments
 * that overlap with the proposed date range.
 */
export function checkWorkerAssignmentOverlap(
  allAssignments: Assignment[],
  workerId: string,
  proposedStart: string,
  proposedEnd: string,
  excludeAssignmentId?: string,
): OverlapResult {
  const blocking = allAssignments.filter((a) => {
    if (a.workerId !== workerId) return false;
    if (excludeAssignmentId && a.id === excludeAssignmentId) return false;
    if (!BLOCKING_STATUSES.has(a.deploymentStatus)) return false;
    return datesOverlap(a.startDate, a.endDate, proposedStart, proposedEnd);
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
    if (BLOCKING_STATUSES.has(a.deploymentStatus)) {
      ids.add(a.workerId);
    }
  }
  return ids;
}
