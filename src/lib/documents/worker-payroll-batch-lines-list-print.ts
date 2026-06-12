import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type WorkerPayrollBatchLinePrintRow = {
  workerName: string;
  workerId: string;
  paymentMethod: string;
  exportStatusLabel: string;
  accountingStatusLabel: string;
  grossLabel: string;
  deductionsLabel: string;
  netLabel: string;
};

const PRINT_ROW_LIMIT = 500;

export function buildWorkerPayrollBatchLinesListPrintHtml(params: {
  batchId: string;
  periodLabel: string;
  batchStatusLabel: string;
  rows: WorkerPayrollBatchLinePrintRow[];
  workerCountLabel: string;
  grossTotalLabel: string;
  deductionsTotalLabel: string;
  netTotalLabel: string;
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const {
    batchId,
    periodLabel,
    batchStatusLabel,
    rows,
    workerCountLabel,
    grossTotalLabel,
    deductionsTotalLabel,
    netTotalLabel,
    generatedAt,
    printedBy,
    truncated,
  } = params;

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="7" class="wpbl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td>${escapeHtmlDoc(r.workerName)}<br /><span class="wpbl-sub">${escapeHtmlDoc(r.workerId)}</span></td>
              <td>${escapeHtmlDoc(r.paymentMethod)}</td>
              <td>${escapeHtmlDoc(r.exportStatusLabel)}</td>
              <td>${escapeHtmlDoc(r.accountingStatusLabel)}</td>
              <td class="wpbl-num">${escapeHtmlDoc(r.grossLabel)}</td>
              <td class="wpbl-num">${escapeHtmlDoc(r.deductionsLabel)}</td>
              <td class="wpbl-num">${escapeHtmlDoc(r.netLabel)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="wpbl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — แยกพิมพ์เป็นหลายชุดหากมีคนเกิน</p>`
    : '';

  return `
<style>
  .wpbl-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .wpbl-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .wpbl-meta { font-size: 9pt; color: #555; margin-bottom: 8px; }
  .wpbl-scope { font-weight: 700; margin-bottom: 6px; }
  .wpbl-totals {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
    font-size: 9pt;
  }
  .wpbl-total-box { border: 1px solid #ccc; padding: 6px 10px; border-radius: 4px; min-width: 0; }
  .wpbl-total-box strong { display: block; font-size: 11pt; margin-top: 2px; }
  .wpbl-table { width: 100%; border-collapse: collapse; font-size: 9pt; table-layout: fixed; }
  .wpbl-table th, .wpbl-table td { border: 1px solid #ccc; padding: 5px 6px; vertical-align: top; word-wrap: break-word; }
  .wpbl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .wpbl-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .wpbl-sub { font-size: 8pt; color: #666; font-family: ui-monospace, monospace; }
  .wpbl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .wpbl-foot { margin-top: 6px; font-size: 8pt; color: #666; }
  @media (max-width: 640px) {
    .wpbl-totals { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
<div class="sd-list-report wpbl-wrap">
  <h1 class="wpbl-title">รายการจ่ายลูกจ้าง (Settlement Lines)</h1>
  <p class="wpbl-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="wpbl-scope">
    ชุดจ่าย <span class="wpbl-sub">${escapeHtmlDoc(batchId)}</span> · งวด ${escapeHtmlDoc(periodLabel)} · ${escapeHtmlDoc(batchStatusLabel)} — ${rows.length} รายการ
  </p>
  <div class="wpbl-totals">
    <div class="wpbl-total-box">จำนวนคน<strong>${escapeHtmlDoc(workerCountLabel)}</strong></div>
    <div class="wpbl-total-box">Gross<strong>${escapeHtmlDoc(grossTotalLabel)}</strong></div>
    <div class="wpbl-total-box">หักรวม<strong>${escapeHtmlDoc(deductionsTotalLabel)}</strong></div>
    <div class="wpbl-total-box">สุทธิ<strong>${escapeHtmlDoc(netTotalLabel)}</strong></div>
  </div>
  <table class="wpbl-table">
    <thead>
      <tr>
        <th>ลูกจ้าง</th>
        <th>ช่องทางจ่าย</th>
        <th>Export ธนาคาร</th>
        <th>สถานะบัญชี</th>
        <th class="wpbl-num">Gross</th>
        <th class="wpbl-num">หัก</th>
        <th class="wpbl-num">สุทธิ</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="wpbl-foot">OPEC OpsFlow — รายการงวดจ่ายลูกจ้าง</p>
</div>`;
}

export function capWorkerPayrollBatchLinePrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
