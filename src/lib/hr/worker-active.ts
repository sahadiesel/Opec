import type { Worker, WorkerStatus } from '@/lib/types';

/** สถานะลูกจ้างที่ไม่ให้เลือกใน dropdown / picker */
const WORKER_SELECTION_EXCLUDED: WorkerStatus[] = ['INACTIVE', 'BLACKLISTED'];

/** ลูกจ้างที่ยังเลือกในระบบได้ (ไม่รวมพ้นสภาพ / บัญชีดำ) */
export function isActiveWorkerForSelection(worker: Pick<Worker, 'workerStatus'>): boolean {
  return !WORKER_SELECTION_EXCLUDED.includes(worker.workerStatus);
}

export function filterActiveWorkersForSelection<T extends Pick<Worker, 'workerStatus'>>(
  workers: T[] | null | undefined,
): T[] {
  return (workers ?? []).filter(isActiveWorkerForSelection);
}
