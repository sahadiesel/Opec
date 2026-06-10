import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type WithholdingPayrollListPrintRow = {
  section: string;
  periodStatus: string;
  batchLabel: string;
  earnerName: string;
  earnerId: string;
  paymentDate: string;
  paidLabel: string;
  amountLabel: string;
};

const PRINT_ROW_LIMIT = 500;

export function buildWithholdingPayrollListPrintHtml(params: {
  rows: WithholdingPayrollListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  grandTotalLabel: string;
  workerTotalLabel: string;
  officeTotalLabel: string;
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const {
    rows,
    scopeTitle,
    filterLines,
    grandTotalLabel,
    workerTotalLabel,
    officeTotalLabel,
    generatedAt,
    printedBy,
    truncated,
  } = params;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="wpl-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="wpl-muted">ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล</p>';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="8" class="wpl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td>${escapeHtmlDoc(r.section)}</td>
              <td>${escapeHtmlDoc(r.periodStatus)}</td>
              <td class="wpl-mono">${escapeHtmlDoc(r.batchLabel)}</td>
              <td>${escapeHtmlDoc(r.earnerName)}<br /><span class="wpl-sub">${escapeHtmlDoc(r.earnerId)}</span></td>
              <td>${escapeHtmlDoc(r.paymentDate)}</td>
              <td class="wpl-num">${escapeHtmlDoc(r.paidLabel)}</td>
              <td class="wpl-num">${escapeHtmlDoc(r.amountLabel)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="wpl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  .wpl-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .wpl-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .wpl-meta { font-size: 9pt; color: #555; margin-bottom: 12px; }
  .wpl-scope { font-weight: 700; margin-bottom: 6px; }
  .wpl-totals { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; font-size: 9pt; }
  .wpl-total-box { border: 1px solid #ccc; padding: 8px 12px; border-radius: 4px; min-width: 140px; }
  .wpl-total-box strong { display: block; font-size: 11pt; margin-top: 2px; }
  .wpl-filters { margin: 0 0 12px; padding-left: 18px; font-size: 9pt; color: #333; }
  .wpl-muted { font-size: 9pt; color: #666; margin: 0 0 12px; }
  .wpl-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .wpl-table th, .wpl-table td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }
  .wpl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .wpl-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .wpl-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; }
  .wpl-sub { font-size: 8pt; color: #666; font-family: ui-monospace, monospace; }
  .wpl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .wpl-foot { margin-top: 10px; font-size: 8pt; color: #666; }
</style>
<div class="wpl-wrap">
  <h1 class="wpl-title">รายการหัก ณ ที่จ่าย (พนักงาน) — ภงด.1</h1>
  <p class="wpl-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="wpl-scope">${escapeHtmlDoc(scopeTitle)} — ${rows.length} รายการ</p>
  ${filterBlock}
  <div class="wpl-totals">
    <div class="wpl-total-box">รวมทั้งหมด<strong>${escapeHtmlDoc(grandTotalLabel)}</strong></div>
    <div class="wpl-total-box">ลูกจ้าง<strong>${escapeHtmlDoc(workerTotalLabel)}</strong></div>
    <div class="wpl-total-box">ออฟฟิศ<strong>${escapeHtmlDoc(officeTotalLabel)}</strong></div>
  </div>
  <table class="wpl-table">
    <thead>
      <tr>
        <th>ประเภท</th>
        <th>สถานะงวด</th>
        <th>ชุดจ่าย / งวด</th>
        <th>ผู้มีเงินได้</th>
        <th>วันที่จ่าย</th>
        <th class="wpl-num">ยอดจ่าย</th>
        <th class="wpl-num">ยอดหัก</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="wpl-foot">OPEC OpsFlow — หัก ณ ที่จ่ายพนักงาน (ลูกจ้าง + ออฟฟิศ)</p>
</div>`;
}

export function capWithholdingPayrollListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
