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
/** สถานะที่กำลังอยู่บนไซต์และลงเวลาได้ — DRAFT ที่ยังรอ Mob ครั้งแรกถูกกรองแยกใน timesheet-ui */
export const WAVE_TIMESHEET_DEPLOYMENT_STATUSES: DeploymentStatus[] = [
  'CONFIRMED',
  'READY_TO_MOB',
  'MOBILIZING',
  'ACTIVE',
];
