/** เลขที่หนังสือรับรองหัก ณ ที่จ่าย — สั้น อ่านง่าย แยกกลุ่ม ไม่ใช้รหัสงวดแบบ Firestore */

export type WhtDocumentPayeeGroup = 'office' | 'worker' | 'vendor';

function yearMonthOf(issueYmd: string, fallbackYm?: string): string {
  const fromIssue = String(issueYmd || '').slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(fromIssue)) return fromIssue;
  const fb = String(fallbackYm || '').slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(fb)) return fb;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function trailingDigits(raw: string, pad: number): string {
  const m = String(raw || '').match(/(\d+)\s*$/);
  const n = m?.[1] || '0';
  return n.slice(-Math.max(pad, n.length)).padStart(pad, '0');
}

function compactBatchKey(batchId: string): string {
  const alnum = String(batchId || '').replace(/[^a-zA-Z0-9]/g, '');
  return (alnum.slice(-4) || '0000').toUpperCase();
}

/** พนักงานออฟฟิศ / ผู้บริหาร — WHT-OFF-YYYY-MM-O0001-0016 */
export function buildOfficeGroupWhtDocumentNo(input: {
  issueYmd: string;
  payrollRunNo: string;
  staffCode: string;
  executive?: boolean;
}): string {
  const ym = yearMonthOf(input.issueYmd);
  const run = trailingDigits(input.payrollRunNo, 4);
  const staff = trailingDigits(input.staffCode, 4);
  const kind = input.executive ? 'E' : 'O';
  return `WHT-OFF-${ym}-${kind}${run}-${staff}`;
}

/** ลูกจ้างหน้างาน — WHT-WRK-YYYY-MM-N3F2A-0020 */
export function buildWorkerGroupWhtDocumentNo(input: {
  issueYmd: string;
  workerCode: string;
  batchId: string;
  batchType?: string;
  payrollPeriodId?: string;
}): string {
  const ym = yearMonthOf(input.issueYmd, input.payrollPeriodId);
  const worker = trailingDigits(input.workerCode, 4);
  const type = String(input.batchType || '').toUpperCase() === 'SUPPLEMENTAL' ? 'S' : 'N';
  const batch = compactBatchKey(input.batchId);
  return `WHT-WRK-${ym}-${type}${batch}-${worker}`;
}
