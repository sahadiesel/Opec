import type { Worker } from '@/lib/types';

/** ชื่อที่แสดงใน mobilization / client portal — ให้ตรงกับหน้า Wave (first last หรือ workerCode) */
export function mobilizationWorkerNameFromWorker(worker: Worker | undefined | null): string {
  if (!worker) return '';
  const n = `${worker.firstName || ''} ${worker.lastName || ''}`.trim();
  return n || (worker.workerCode || '').trim();
}
