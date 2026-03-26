import type { DeploymentStatus } from '@/lib/types';

/**
 * Mobilization statuses included on the Wave timesheet board and in HR manual entry.
 * Keep in sync across /timesheets/wave-board and /timesheets/daily.
 */
export const WAVE_TIMESHEET_DEPLOYMENT_STATUSES: DeploymentStatus[] = [
  'ACTIVE',
  'READY_TO_MOB',
  'MOBILIZING',
];
