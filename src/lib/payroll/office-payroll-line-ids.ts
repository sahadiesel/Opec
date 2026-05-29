import type { OfficePayrollLine } from '@/lib/types';

/** doc id มาตรฐานใน `office_payroll_runs/{runId}/lines/{lineId}` */
export function standardOfficePayrollLineDocId(staffCode: string, officePayrollRunId: string): string {
  return `OPL-${staffCode}-${officePayrollRunId.substring(0, 5)}`;
}

export function pickOfficePayrollLineForStaff(
  lines: OfficePayrollLine[] | undefined | null,
  staffId: string,
): OfficePayrollLine | null {
  if (!lines?.length) return null;
  return lines.find((l) => l.staffId === staffId) ?? null;
}
