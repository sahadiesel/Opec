import type { DeploymentStatus } from '@/lib/types';

/**
 * Mobilization statuses included on the Wave timesheet board and in HR manual entry.
 * Keep in sync across /timesheets/wave-board and /timesheets/daily.
 */
/** รวมสถานะที่อนุญาตให้ปรากฏใน Wave Board สำหรับลงเวลา — DRAFT ไม่อยู่ในรายการ (ต้องยืนยันมอบหมายก่อน) */
export const WAVE_TIMESHEET_DEPLOYMENT_STATUSES: DeploymentStatus[] = [
  'CONFIRMED',
  'READY_TO_MOB',
  'MOBILIZING',
  'ACTIVE',
];
