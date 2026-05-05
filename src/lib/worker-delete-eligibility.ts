import type { Assignment, DeploymentStatus, Worker } from '@/lib/types';

/** การมอบหมายที่ถือว่าปิดงานแล้ว — ลบคนงานได้เมื่อไม่มีสถานะอื่นนอกจากสองค่านี้ */
export const TERMINAL_ASSIGNMENT_DEPLOYMENT_STATUSES: DeploymentStatus[] = ['CLOSED', 'DEMOBILIZED'];

export function isAssignmentBlockingDelete(a: Assignment): boolean {
  if (a.unassignedAt != null && Number(a.unassignedAt) > 0) return false;
  return !TERMINAL_ASSIGNMENT_DEPLOYMENT_STATUSES.includes(a.deploymentStatus);
}

/** คนงานต้องว่าง (ไม่ถูกมอบหมาย/ไม่อยู่หน้างาน) */
export function isWorkerEmploymentStatusSafeForDelete(worker: Worker): boolean {
  return worker.workerStatus === 'AVAILABLE';
}

export function filterBlockingAssignmentsForWorker(assignments: Assignment[], workerId: string): Assignment[] {
  return assignments.filter((a) => a.workerId === workerId && isAssignmentBlockingDelete(a));
}

export function formatBlockingAssignmentsMessage(blocking: Assignment[]): string {
  if (blocking.length === 0) return '';
  const labels = blocking.map((a) => `${a.assignmentNo || a.id} (${a.deploymentStatus})`);
  return `มีการมอบหมายงานที่ยังไม่ปิด: ${labels.join(', ')}`;
}
