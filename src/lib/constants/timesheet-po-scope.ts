/** เก็บใน Assignment.waveId / DailyTimesheet.waveId เมื่อไม่มี Wave — ลงเวลาและ billing อิง PO + assignment */
export const PO_TIMESHEET_SCOPE_PREFIX = 'po_ts_scope_';

export function poTimesheetScopeId(poId: string): string {
  return `${PO_TIMESHEET_SCOPE_PREFIX}${poId}`;
}

export function isPoTimesheetScopeId(waveId: string | undefined | null): boolean {
  return !!waveId && waveId.startsWith(PO_TIMESHEET_SCOPE_PREFIX);
}
