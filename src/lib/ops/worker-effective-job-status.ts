import type { Assignment, Worker, WorkerStatus } from '@/lib/types';
import { TERMINAL_ASSIGNMENT_DEPLOYMENT_STATUSES } from '@/lib/worker-delete-eligibility';
import { assignmentReleasedFromPoLineQuota } from '@/lib/ops/po-fulfillment-read-model';
import { isWorkerDispatchReady } from '@/lib/worker-readiness';

/** สถานะที่แสดงในทะเบียน — รวม Not Ready เมื่อว่างงานแต่เอกสาร/HR ยังไม่พร้อมส่งตัว */
export type WorkerRegistryJobStatusDisplay = WorkerStatus | 'NOT_READY';

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

/** สถานะงานในตารางทะเบียน — ไม่แสดง AVAILABLE เขียวเมื่อ readiness ไม่ผ่านหรือ HR ปิดพร้อม */
export function displayWorkerRegistryJobStatus(
  worker: Worker,
  mobilizations: Assignment[] | null | undefined,
): WorkerRegistryJobStatusDisplay {
  const job = effectiveWorkerJobStatus(worker, mobilizations);
  if (job === 'AVAILABLE' && !isWorkerDispatchReady(worker)) {
    return 'NOT_READY';
  }
  return job;
}

export function workerRegistryJobStatusBadgeProps(status: WorkerRegistryJobStatusDisplay): {
  variant: 'outline' | 'secondary' | 'default' | 'destructive';
  className: string;
  label: string;
} {
  if (status === 'NOT_READY') {
    return {
      variant: 'outline',
      className: 'text-orange-700 border-orange-300 bg-orange-50 font-semibold',
      label: 'NOT READY',
    };
  }
  switch (status) {
    case 'AVAILABLE':
      return { variant: 'outline', className: 'text-green-600 border-green-200', label: 'AVAILABLE' };
    case 'ON_SITE':
      return { variant: 'default', className: 'bg-emerald-700 hover:bg-emerald-700 text-white', label: 'ON_SITE' };
    case 'ASSIGNED':
      return {
        variant: 'secondary',
        className: 'bg-amber-100 text-amber-950 border border-amber-200',
        label: 'ASSIGNED',
      };
    case 'ON_LEAVE':
      return { variant: 'outline', className: 'text-blue-700 border-blue-200', label: 'ON_LEAVE' };
    case 'INACTIVE':
      return { variant: 'secondary', className: 'text-muted-foreground', label: 'INACTIVE' };
    case 'BLACKLISTED':
      return { variant: 'destructive', className: '', label: 'BLACKLISTED' };
    default:
      return { variant: 'secondary', className: '', label: String(status) };
  }
}
