import { formatPayrollYearMonthThaiBE } from '@/lib/date-thai';
import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type MoneyReceiptListPrintRow = {
  receiptNo: string;
  taxInvoiceNo: string;
  customerName: string;
  receiptDateLabel: string;
  amountLabel: string;
};

export type MoneyReceiptListPrintFilterSummary = {
  searchTerm: string;
  monthYyyyMm: string;
};

const PRINT_ROW_LIMIT = 500;

export function describeMoneyReceiptListPrintFilters(f: MoneyReceiptListPrintFilterSummary): string[] {
  const lines: string[] = [];
  if (f.monthYyyyMm.trim()) {
    lines.push(`เดือนเอกสาร: ${formatPayrollYearMonthThaiBE(f.monthYyyyMm)}`);
  }
  if (f.searchTerm.trim()) {
    lines.push(`ค้นหา: "${f.searchTerm.trim()}"`);
  }
  return lines;
}

export function buildMoneyReceiptListPrintHtml(params: {
  rows: MoneyReceiptListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  totalAmountLabel: string;
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const { rows, scopeTitle, filterLines, totalAmountLabel, generatedAt, printedBy, truncated } = params;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="mrl-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="mrl-muted">ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล</p>';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="5" class="mrl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td class="mrl-mono">${escapeHtmlDoc(r.receiptNo)}</td>
              <td class="mrl-mono">${escapeHtmlDoc(r.taxInvoiceNo)}</td>
              <td>${escapeHtmlDoc(r.customerName)}</td>
              <td>${escapeHtmlDoc(r.receiptDateLabel)}</td>
              <td class="mrl-num">${escapeHtmlDoc(r.amountLabel)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="mrl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองหรือพิมพ์ทั้งหมดเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  .mrl-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .mrl-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .mrl-meta { font-size: 9pt; color: #555; margin-bottom: 8px; }
  .mrl-scope { font-weight: 700; margin-bottom: 4px; }
  .mrl-total { font-size: 9pt; margin-bottom: 10px; }
  .mrl-total strong { font-size: 11pt; }
  .mrl-filters { margin: 0 0 10px; padding-left: 18px; font-size: 9pt; color: #333; }
  .mrl-muted { font-size: 9pt; color: #666; margin: 0 0 10px; }
  .mrl-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .mrl-table th, .mrl-table td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }
  .mrl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .mrl-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .mrl-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; }
  .mrl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .mrl-foot { margin-top: 8px; font-size: 8pt; color: #666; }
</style>
<div class="sd-list-report mrl-wrap">
  <h1 class="mrl-title">รายการใบเสร็จรับเงิน (ลูกค้า)</h1>
  <p class="mrl-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="mrl-scope">${escapeHtmlDoc(scopeTitle)} — ${rows.length} รายการ</p>
  <p class="mrl-total">ยอดรับรวมในชุดที่พิมพ์: <strong>${escapeHtmlDoc(totalAmountLabel)}</strong></p>
  ${filterBlock}
  <table class="mrl-table">
    <thead>
      <tr>
        <th>เลขที่ใบเสร็จ</th>
        <th>อ้างอิงใบกำกับ</th>
        <th>ลูกค้า</th>
        <th>วันที่</th>
        <th class="mrl-num">ยอดรับ</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="mrl-foot">OPEC OpsFlow — ใบเสร็จรับเงิน (ออกหลังยืนยันรับเงินบนใบกำกับภาษี)</p>
</div>`;
}

export function capMoneyReceiptListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
