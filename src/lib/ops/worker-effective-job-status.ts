import type { Assignment, Worker, WorkerStatus } from '@/lib/types';
import { TERMINAL_ASSIGNMENT_DEPLOYMENT_STATUSES } from '@/lib/worker-delete-eligibility';
import { assignmentReleasedFromPoLineQuota } from '@/lib/ops/po-fulfillment-read-model';
import { isWorkerDispatchReady } from '@/lib/worker-readiness';

/**
 * สถานะที่แสดงในทะเบียน — แยก NOT READY เป็นสองความหมาย:
 * - NOT_READY_TO_WORK: HR ปิดสวิตช์ (ลาออก/พักงาน/เจ็บป่วย/อื่นๆ)
 * - NOT_READY_TO_ASSIGN: เอกสาร/compliance ยังไม่ผ่าน แต่ยังอยู่ในกำลังแรงงาน
 */
export type WorkerRegistryJobStatusDisplay =
  | WorkerStatus
  | 'NOT_READY_TO_WORK'
  | 'NOT_READY_TO_ASSIGN';

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

/**
 * สถานะงานในตารางทะเบียน — ไม่แสดง AVAILABLE เขียวเมื่อ readiness ไม่ผ่านหรือ HR ปิดพร้อม
 * ลำดับความสำคัญ: manual hold → NOT_READY_TO_WORK; docs ไม่ผ่าน → NOT_READY_TO_ASSIGN
 */
export function displayWorkerRegistryJobStatus(
  worker: Worker,
  mobilizations: Assignment[] | null | undefined,
): WorkerRegistryJobStatusDisplay {
  const job = effectiveWorkerJobStatus(worker, mobilizations);
  if (job !== 'AVAILABLE') return job;

  // HR ปิดสวิตช์ = ไม่พร้อมทำงาน (ชนะแม้เอกสารยัง READY หรือไม่ผ่าน)
  if (worker.readinessManualHold === true) {
    return 'NOT_READY_TO_WORK';
  }
  // เอกสาร/compliance ไม่ผ่าน = ไม่พร้อมมอบหมาย (ยังอยู่ในกำลังแรงงาน)
  if (!isWorkerDispatchReady(worker)) {
    return 'NOT_READY_TO_ASSIGN';
  }
  return job;
}

export function workerRegistryJobStatusBadgeProps(status: WorkerRegistryJobStatusDisplay): {
  variant: 'outline' | 'secondary' | 'default' | 'destructive';
  className: string;
  label: string;
} {
  if (status === 'NOT_READY_TO_WORK') {
    return {
      variant: 'outline',
      className: 'text-orange-900 border-orange-400 bg-orange-50 font-semibold',
      label: 'NOT READY TO WORK',
    };
  }
  if (status === 'NOT_READY_TO_ASSIGN') {
    return {
      variant: 'outline',
      className: 'text-amber-800 border-amber-300 bg-amber-50 font-semibold',
      label: 'NOT READY TO ASSIGN',
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

/** Mobilization ที่เปิดอยู่ของคนงาน — ใช้ดึงบริษัท/สัญญา/สถานที่ */
export function resolveWorkerOpenAssignment(
  workerId: string,
  mobilizations: Assignment[] | null | undefined,
  opts?: { activeOnly?: boolean },
): Assignment | null {
  let open = (mobilizations ?? []).filter(
    (m) => m.workerId === workerId && isMobilizationOpenForJobStatus(m),
  );
  if (opts?.activeOnly) {
    open = open.filter((m) => m.deploymentStatus === 'ACTIVE');
  }
  if (open.length === 0) return null;
  return [...open].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] ?? null;
}

/** Mobilization ที่ ACTIVE (ON_SITE) ของคนงาน — ใช้ดึงบริษัท/สถานที่ */
export function resolveWorkerOnSiteAssignment(
  workerId: string,
  mobilizations: Assignment[] | null | undefined,
): Assignment | null {
  return resolveWorkerOpenAssignment(workerId, mobilizations, { activeOnly: true });
}

/** Mobilization ที่มอบหมายแล้วแต่ยังไม่ ACTIVE (ASSIGNED) */
export function resolveWorkerAssignedAssignment(
  workerId: string,
  mobilizations: Assignment[] | null | undefined,
): Assignment | null {
  const open = resolveWorkerOpenAssignment(workerId, mobilizations);
  if (!open || open.deploymentStatus === 'ACTIVE') return null;
  return open;
}

/**
 * ข้อความใต้ badge ON_SITE / ASSIGNED — «บริษัท / สถานที่หรือโครงการ»
 * ASSIGNED มักยังไม่มี workLocation → ใช้ projectName เป็นตัวชี้สัญญา/งาน
 */
export function formatWorkerOnSiteCompanyLocation(
  assignment: Assignment,
  customerNameById: Map<string, string>,
): string {
  const company = (customerNameById.get(assignment.customerId) || '').trim();
  const project = (assignment.projectName || '').trim();
  const loc = (assignment.workLocation || '').trim();
  const detail = loc || project;
  if (company && detail && company !== detail) return `${company} / ${detail}`;
  return company || detail;
}
