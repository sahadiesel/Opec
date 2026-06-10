import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type OfficePayrollLinePrintRow = {
  staffName: string;
  department: string;
  positionTitle: string;
  baseSalaryLabel: string;
  grossLabel: string;
  deductionsLabel: string;
  netLabel: string;
};

export type OfficePayrollMonthLinePrintRow = OfficePayrollLinePrintRow & {
  sourceRunNos: string;
};

const PRINT_ROW_LIMIT = 500;

export function buildOfficePayrollLinesListPrintHtml(params: {
  runNo: string;
  payrollMonthLabel: string;
  runStatus: string;
  rows: OfficePayrollLinePrintRow[];
  staffCountLabel: string;
  grossTotalLabel: string;
  deductionsTotalLabel: string;
  netTotalLabel: string;
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const {
    runNo,
    payrollMonthLabel,
    runStatus,
    rows,
    staffCountLabel,
    grossTotalLabel,
    deductionsTotalLabel,
    netTotalLabel,
    generatedAt,
    printedBy,
    truncated,
  } = params;

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="5" class="opl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td>${escapeHtmlDoc(r.staffName)}<br /><span class="opl-sub">${escapeHtmlDoc(r.department)} · ${escapeHtmlDoc(r.positionTitle)}</span></td>
              <td class="opl-num">${escapeHtmlDoc(r.baseSalaryLabel)}</td>
              <td class="opl-num">${escapeHtmlDoc(r.grossLabel)}</td>
              <td class="opl-num opl-deduct">${escapeHtmlDoc(r.deductionsLabel)}</td>
              <td class="opl-num opl-net">${escapeHtmlDoc(r.netLabel)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="opl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ</p>`
    : '';

  return `
<style>
  .opl-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .opl-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .opl-meta { font-size: 9pt; color: #555; margin-bottom: 8px; }
  .opl-scope { font-weight: 700; margin-bottom: 6px; font-size: 9pt; }
  .opl-totals {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
    font-size: 9pt;
  }
  .opl-total-box { border: 1px solid #ccc; padding: 6px 10px; border-radius: 4px; min-width: 0; }
  .opl-total-box strong { display: block; font-size: 11pt; margin-top: 2px; }
  .opl-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .opl-table th, .opl-table td { border: 1px solid #ccc; padding: 5px 8px; vertical-align: top; }
  .opl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .opl-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .opl-deduct { color: #b91c1c; }
  .opl-net { color: #15803d; }
  .opl-sub { font-size: 8pt; color: #666; }
  .opl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .opl-foot { margin-top: 6px; font-size: 8pt; color: #666; }
</style>
<div class="sd-list-report opl-wrap">
  <h1 class="opl-title">รายการจ่ายเงินพนักงานบริษัท (Internal Settlement)</h1>
  <p class="opl-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="opl-scope">
    งวด ${escapeHtmlDoc(runNo)} · ${escapeHtmlDoc(payrollMonthLabel)} · ${escapeHtmlDoc(runStatus)} — ${rows.length} รายการ
  </p>
  <div class="opl-totals">
    <div class="opl-total-box">จำนวนคน<strong>${escapeHtmlDoc(staffCountLabel)}</strong></div>
    <div class="opl-total-box">Gross<strong>${escapeHtmlDoc(grossTotalLabel)}</strong></div>
    <div class="opl-total-box">หักรวม<strong>${escapeHtmlDoc(deductionsTotalLabel)}</strong></div>
    <div class="opl-total-box">สุทธิ<strong>${escapeHtmlDoc(netTotalLabel)}</strong></div>
  </div>
  <table class="opl-table">
    <thead>
      <tr>
        <th>พนักงาน & ตำแหน่ง</th>
        <th class="opl-num">ฐานเงินเดือน</th>
        <th class="opl-num">ยอดรวม (Gross)</th>
        <th class="opl-num">รายการหัก</th>
        <th class="opl-num">สุทธิ (Net)</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="opl-foot">OPEC OpsFlow — รายการเงินเดือนพนักงานออฟฟิศ (เฉพาะงวดนี้)</p>
</div>`;
}

export function capOfficePayrollLinePrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}

export function buildOfficePayrollMonthConsolidationListPrintHtml(params: {
  payrollMonth: string;
  payrollMonthLabel: string;
  scopeTitle: string;
  filterLines: string[];
  rows: OfficePayrollMonthLinePrintRow[];
  staffCountLabel: string;
  runCountLabel: string;
  grossTotalLabel: string;
  deductionsTotalLabel: string;
  netTotalLabel: string;
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const {
    payrollMonth,
    payrollMonthLabel,
    scopeTitle,
    filterLines,
    rows,
    staffCountLabel,
    runCountLabel,
    grossTotalLabel,
    deductionsTotalLabel,
    netTotalLabel,
    generatedAt,
    printedBy,
    truncated,
  } = params;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="opl-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="6" class="opl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td class="opl-mono">${escapeHtmlDoc(r.sourceRunNos)}</td>
              <td>${escapeHtmlDoc(r.staffName)}<br /><span class="opl-sub">${escapeHtmlDoc(r.department)} · ${escapeHtmlDoc(r.positionTitle)}</span></td>
              <td class="opl-num">${escapeHtmlDoc(r.baseSalaryLabel)}</td>
              <td class="opl-num">${escapeHtmlDoc(r.grossLabel)}</td>
              <td class="opl-num opl-deduct">${escapeHtmlDoc(r.deductionsLabel)}</td>
              <td class="opl-num opl-net">${escapeHtmlDoc(r.netLabel)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="opl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับคำค้นหาเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  .opl-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .opl-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .opl-meta { font-size: 9pt; color: #555; margin-bottom: 8px; }
  .opl-scope { font-weight: 700; margin-bottom: 6px; font-size: 9pt; }
  .opl-filters { margin: 0 0 8px; padding-left: 18px; font-size: 9pt; color: #333; }
  .opl-totals {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
    font-size: 9pt;
  }
  .opl-total-box { border: 1px solid #ccc; padding: 6px 10px; border-radius: 4px; min-width: 0; }
  .opl-total-box strong { display: block; font-size: 11pt; margin-top: 2px; }
  .opl-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .opl-table th, .opl-table td { border: 1px solid #ccc; padding: 5px 8px; vertical-align: top; }
  .opl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .opl-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .opl-mono { font-family: ui-monospace, monospace; font-size: 8pt; color: #444; max-width: 8rem; word-break: break-word; }
  .opl-deduct { color: #b91c1c; }
  .opl-net { color: #15803d; }
  .opl-sub { font-size: 8pt; color: #666; }
  .opl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .opl-foot { margin-top: 6px; font-size: 8pt; color: #666; }
</style>
<div class="sd-list-report opl-wrap">
  <h1 class="opl-title">มุมมองรวมรายเดือน — รายการจ่ายเงินพนักงานบริษัท</h1>
  <p class="opl-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="opl-scope">${escapeHtmlDoc(scopeTitle)} · ${escapeHtmlDoc(payrollMonthLabel)} (${escapeHtmlDoc(payrollMonth)}) — ${rows.length} รายการ</p>
  ${filterBlock}
  <div class="opl-totals">
    <div class="opl-total-box">จำนวนคน<strong>${escapeHtmlDoc(staffCountLabel)}</strong></div>
    <div class="opl-total-box">งวดที่รวม<strong>${escapeHtmlDoc(runCountLabel)}</strong></div>
    <div class="opl-total-box">Gross<strong>${escapeHtmlDoc(grossTotalLabel)}</strong></div>
    <div class="opl-total-box">หักรวม<strong>${escapeHtmlDoc(deductionsTotalLabel)}</strong></div>
    <div class="opl-total-box">สุทธิ<strong>${escapeHtmlDoc(netTotalLabel)}</strong></div>
  </div>
  <table class="opl-table">
    <thead>
      <tr>
        <th>อ้างอิงงวด</th>
        <th>พนักงาน & ตำแหน่ง</th>
        <th class="opl-num">ฐานเงินเดือน</th>
        <th class="opl-num">ยอดรวม (Gross)</th>
        <th class="opl-num">รายการหัก</th>
        <th class="opl-num">สุทธิ (Net)</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="opl-foot">OPEC OpsFlow — มุมมองรวมรายเดือน (Office Payroll)</p>
</div>`;
}
