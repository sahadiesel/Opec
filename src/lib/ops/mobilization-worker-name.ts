import type { Assignment, Worker } from '@/lib/types';

/** ชื่อที่แสดงใน mobilization / client portal — ให้ตรงกับหน้า Wave (first last หรือ workerCode) */
export function mobilizationWorkerNameFromWorker(worker: Worker | undefined | null): string {
  if (!worker) return '';
  const n = `${worker.firstName || ''} ${worker.lastName || ''}`.trim();
  return n || (worker.workerCode || '').trim();
}

/** ใช้เรียงตารางกระดานลงเวลา / เดือน / Mobilization เมื่อยังโหลด workers ไม่ครบ */
export function assignmentSortKeyFromWorkerAndAssignment(
  a: Pick<Assignment, 'workerId' | 'workerName' | 'assignmentNo' | 'id'>,
  workers: Worker[] | undefined | null,
): string {
  const worker = workers?.find((w) => w.id === a.workerId);
  const fromWorker = mobilizationWorkerNameFromWorker(worker);
  if (fromWorker) return fromWorker;
  const fallback = (a.workerName || '').trim();
  if (fallback) return fallback;
  return (a.assignmentNo || '').trim() || a.workerId || a.id;
}

export function compareAssignmentWorkerNamesTh(
  a: Pick<Assignment, 'workerId' | 'workerName' | 'assignmentNo' | 'id'>,
  b: Pick<Assignment, 'workerId' | 'workerName' | 'assignmentNo' | 'id'>,
  workers: Worker[] | undefined | null,
): number {
  const ka = assignmentSortKeyFromWorkerAndAssignment(a, workers);
  const kb = assignmentSortKeyFromWorkerAndAssignment(b, workers);
  const c = ka.localeCompare(kb, 'th', { sensitivity: 'base', numeric: true });
  if (c !== 0) return c;
  const no = (a.assignmentNo || '').localeCompare(b.assignmentNo || '', 'th', { numeric: true });
  if (no !== 0) return no;
  return a.id.localeCompare(b.id);
}
