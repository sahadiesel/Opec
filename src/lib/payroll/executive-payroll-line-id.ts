/**
 * Document id ใน `executive_payroll_runs/{runId}/lines`
 * — ต้องตรงกับ {@link applyExecutivePayrollRunLines} เสมอ
 */
export function executivePayrollLineDocumentId(staffCode: string, runId: string): string {
  return `EPL-${staffCode}-${runId.substring(0, 5)}`;
}
