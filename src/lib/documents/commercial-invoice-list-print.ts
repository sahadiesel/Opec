import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';
import { describeYearMonthScopeFilter } from '@/lib/date/year-month-scope-filter';

export type CommercialInvoiceListPrintRow = {
  invoiceNo: string;
  customerName: string;
  issueDateLabel: string;
  wavePeriodLabel: string;
  totalLabel: string;
  statusLabel: string;
};

export type CommercialInvoiceListPrintFilterSummary = {
  yearCe: number;
  monthScope: string;
};

const PRINT_ROW_LIMIT = 500;

export function describeCommercialInvoiceListPrintFilters(
  f: CommercialInvoiceListPrintFilterSummary,
): string[] {
  return [`เดือนเอกสาร: ${describeYearMonthScopeFilter(f.yearCe, f.monthScope)}`];
}

export function buildCommercialInvoiceListPrintHtml(params: {
  rows: CommercialInvoiceListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const { rows, scopeTitle, filterLines, generatedAt, printedBy, truncated } = params;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="cil-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="cil-muted">ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล</p>';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="6" class="cil-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td class="cil-mono">${escapeHtmlDoc(r.invoiceNo)}</td>
              <td>${escapeHtmlDoc(r.customerName)}</td>
              <td>${escapeHtmlDoc(r.wavePeriodLabel)}</td>
              <td>${escapeHtmlDoc(r.issueDateLabel)}</td>
              <td class="cil-num">${escapeHtmlDoc(r.totalLabel)}</td>
              <td>${escapeHtmlDoc(r.statusLabel)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="cil-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองเดือนเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  .cil-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .cil-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .cil-meta { font-size: 9pt; color: #555; margin-bottom: 12px; }
  .cil-scope { font-weight: 700; margin-bottom: 6px; }
  .cil-filters { margin: 0 0 12px; padding-left: 18px; font-size: 9pt; color: #333; }
  .cil-muted { font-size: 9pt; color: #666; margin: 0 0 12px; }
  .cil-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .cil-table th, .cil-table td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }
  .cil-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .cil-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .cil-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; }
  .cil-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .cil-foot { margin-top: 10px; font-size: 8pt; color: #666; }
</style>
<div class="cil-wrap">
  <h1 class="cil-title">รายการใบแจ้งหนี้ (เรียกเก็บลูกค้า)</h1>
  <p class="cil-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="cil-scope">${escapeHtmlDoc(scopeTitle)} — ${rows.length} รายการ</p>
  ${filterBlock}
  <table class="cil-table">
    <thead>
      <tr>
        <th>เลขที่</th>
        <th>ลูกค้า</th>
        <th>Wave / งวด</th>
        <th>วันที่เอกสาร</th>
        <th>ยอดรวม</th>
        <th>สถานะ</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="cil-foot">OPEC OpsFlow — รายการใบแจ้งหนี้ (ข้อมูลจากระบบ)</p>
</div>`;
}

export function capCommercialInvoiceListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
