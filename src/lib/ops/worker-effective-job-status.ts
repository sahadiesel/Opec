import type { Assignment, Worker, WorkerStatus } from '@/lib/types';
import { TERMINAL_ASSIGNMENT_DEPLOYMENT_STATUSES } from '@/lib/worker-delete-eligibility';
import { assignmentReleasedFromPoLineQuota } from '@/lib/ops/po-fulfillment-read-model';

/** Mobilization ที่ยังถือว่าผูกคนอยู่ในงาน (ไม่รวมถอนตัว / ปิดรายการ) */
export function isMobilizationOpenForJobStatus(a: Assignment): boolean {
  if (assignmentReleasedFromPoLineQuota(a)) return false;
  return !TERMINAL_ASSIGNMENT_DEPLOYMENT_STATUSES.includes(a.deploymentStatus);
}

/**
 * สถานะงานที่ควรแสดง: ยึด mobilization ที่เปิดอยู่เป็นหลักเมื่อเอกสารคนงานค้างเป็น AVAILABLE
 * ไม่ลดสถานะ (AVAILABLE←ASSIGNED) — ใช้เฉพาะแสดงผล + self-heal แบบอัปเกรดเท่านั้น
 */
export function effectiveWorkerJobStatus(worker: Worker, mobilizations: Assignment[] | null | undefined): WorkerStatus {
  const frozen: WorkerStatus[] = ['BLACKLISTED', 'INACTIVE', 'ON_LEAVE'];
  if (frozen.includes(worker.workerStatus)) return worker.workerStatus;

  const list = mobilizations ?? [];
  const open = list.filter((m) => m.workerId === worker.id && isMobilizationOpenForJobStatus(m));
  if (open.length === 0) return worker.workerStatus;

  const onSite = open.some((m) => m.deploymentStatus === 'ACTIVE');
  if (onSite) return 'ON_SITE';
  return 'ASSIGNED';
}
