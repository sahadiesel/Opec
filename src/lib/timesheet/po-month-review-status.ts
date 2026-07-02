import type { PoMonthTimesheetReview, WaveMonthTimesheetReviewStatus, WorkerMonthTimesheetClosure } from '@/lib/types';

/** PO+เดือน ถือว่า "ปิดงวดทางเอกสาร" แล้ว (รวมปิดบางส่วน) */
export const PO_MONTH_DOCUMENT_GATED_STATUSES: WaveMonthTimesheetReviewStatus[] = [
  'entry_locked',
  'partially_closed',
  'pending_manager_review',
  'partially_approved',
  'approved',
];

/** ล็อกแก้ไขตารางรายเดือนทั้ง PO (โหมดเต็ม PO — ไม่มี worker closure) */
export const PO_MONTH_FULL_GRID_LOCK_STATUSES: WaveMonthTimesheetReviewStatus[] = [
  'entry_locked',
  'pending_manager_review',
  'approved',
];

export function isPoMonthDocumentGated(
  r: PoMonthTimesheetReview | undefined | null,
): boolean {
  if (!r) return false;
  return PO_MONTH_DOCUMENT_GATED_STATUSES.includes(r.status);
}

export function isPoMonthFullGridLock(
  r: PoMonthTimesheetReview | undefined | null,
): boolean {
  if (!r) return false;
  return PO_MONTH_FULL_GRID_LOCK_STATUSES.includes(r.status);
}

export function poMonthReviewStatusLabelTh(
  s: WaveMonthTimesheetReviewStatus | null | undefined,
): string {
  switch (s) {
    case 'entry_locked':
      return 'ปิดงวด Payroll แล้ว';
    case 'partially_closed':
      return 'ปิดงวดบางส่วน';
    case 'pending_manager_review':
      return 'รอผู้จัดการ';
    case 'partially_approved':
      return 'อนุมัติบางส่วน';
    case 'approved':
      return 'อนุมัติแล้ว';
    case 'rejected':
      return 'ปฏิเสธ';
    default:
      return 'ยังไม่ปิดงวด';
  }
}

/** สรุปสถานะ PO จาก worker closures (เมื่อมีอย่างน้อย 1 รายการ) */
export function aggregatePoMonthReviewStatusFromWorkerClosures(
  closures: WorkerMonthTimesheetClosure[],
): WaveMonthTimesheetReviewStatus | null {
  if (closures.length === 0) return null;

  const statuses = closures.map((c) => c.status);
  const hasPending = statuses.some((s) => s === 'pending_manager_review');
  const hasEntryLocked = statuses.some((s) => s === 'entry_locked');
  const hasRejected = statuses.some((s) => s === 'rejected');
  const actionable = closures.filter((c) => c.status !== 'deferred');
  const allActionableApproved =
    actionable.length > 0 && actionable.every((c) => c.status === 'approved');
  const someApproved = statuses.some((s) => s === 'approved');
  const someOpen = statuses.some((s) => s === 'open' || s === 'deferred');

  if (hasPending) return 'pending_manager_review';
  if (hasRejected && !hasEntryLocked && !hasPending) return 'rejected';
  if (allActionableApproved) {
    return someOpen ? 'partially_approved' : 'approved';
  }
  if (someApproved && (hasEntryLocked || someOpen)) return 'partially_approved';
  if (hasEntryLocked) return 'partially_closed';
  return null;
}
