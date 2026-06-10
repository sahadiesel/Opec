import type { ReadinessStatus, Worker } from '@/lib/types';

/** พร้อมให้มอบหมาย/ส่งตัว — ผ่านเกณฑ์ readiness และไม่ถูก HR ปิดสวิตช์ */
export function isWorkerDispatchReady(w: Pick<Worker, 'readinessStatus' | 'readinessManualHold'>): boolean {
  return w.readinessStatus === 'READY' && w.readinessManualHold !== true;
}

/**
 * ลิงก์โปรไฟล์ลูกจ้างจากสถานะ readiness — เปิดแท็บที่เกี่ยวข้อง (ใบเซอร์ / แพทย์ / สารเสพติด / เอกสาร)
 */
export function workerProfileHrefForReadiness(workerId: string, readinessStatus: ReadinessStatus): string {
  const base = `/workers/${workerId}`;
  switch (readinessStatus) {
    case 'MISSING_CERTIFICATE':
    case 'DOCUMENT_EXPIRED':
    case 'INCOMPLETE':
      return `${base}?tab=credentials`;
    case 'MEDICAL_EXPIRED':
      return `${base}?tab=medical`;
    case 'DRUG_TEST_EXPIRED':
      return `${base}?tab=drug`;
    default:
      return base;
  }
}

/**
 * คิวแดชบอร์ด: operations_officer อยู่โหมด viewer แต่ต้องเข้าแก้ compliance หน้างานได้
 * — HR queue: เฉพาะทะเบียนลูกจ้าง (ไม่เปิด payroll / correction แทน HR)
 * — Ops queue: รวม mobilization สำหรับความพร้อมก่อนส่งตัว
 */
export function operationsOfficerMayOpenQueuedDashboardLink(
  link: string,
  scope: 'hr_worker_compliance' | 'ops_field'
): boolean {
  if (link.startsWith('/workers/')) return true;
  if (scope === 'ops_field' && link.startsWith('/mobilization/')) return true;
  return false;
}
