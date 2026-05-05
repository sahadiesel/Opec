import type { Worker } from '@/lib/types';

/** พร้อมให้มอบหมาย/ส่งตัว — ผ่านเกณฑ์ readiness และไม่ถูก HR ปิดสวิตช์ */
export function isWorkerDispatchReady(w: Pick<Worker, 'readinessStatus' | 'readinessManualHold'>): boolean {
  return w.readinessStatus === 'READY' && w.readinessManualHold !== true;
}
