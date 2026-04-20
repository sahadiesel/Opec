import type { DeploymentStatus, WaveStatus } from '@/lib/types';

/**
 * Wave ที่ยังไม่ปิด — ใช้กรองรายการบน Wave Board / สรุปรายเดือน (ไม่รวม COMPLETED/CLOSED)
 */
export const OPEN_WAVE_STATUSES_FOR_TIMESHEET: WaveStatus[] = [
  'PLANNING',
  'READY',
  'RECRUITING',
  'MOBILIZING',
  'DEMOBILIZING',
  'ACTIVE',
];

/**
 * Mobilization statuses included on the Wave timesheet board and in HR manual entry.
 * Keep in sync across /timesheets/wave-board and /timesheets/wave-month.
 */
/** รวมสถานะที่อนุญาตให้ปรากฏใน Wave Board สำหรับลงเวลา — DRAFT ไม่อยู่ในรายการ (ต้องยืนยันมอบหมายก่อน) */
export const WAVE_TIMESHEET_DEPLOYMENT_STATUSES: DeploymentStatus[] = [
  'CONFIRMED',
  'READY_TO_MOB',
  'MOBILIZING',
  'ACTIVE',
];
