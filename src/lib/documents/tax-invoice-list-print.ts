import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type TaxInvoiceListPrintRow = {
  taxInvoiceNo: string;
  customerName: string;
  issueDateLabel: string;
  receiptNo: string;
  taxableLabel: string;
  vatLabel: string;
  totalLabel: string;
  status: string;
};

export type TaxInvoiceListPrintFilterSummary = {
  searchTerm: string;
  monthYyyyMm: string;
};

const PRINT_ROW_LIMIT = 500;

export function formatTaxInvoiceListMonthLabel(yyyyMm: string): string {
  const parts = yyyyMm.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  if (!y || !m) return yyyyMm;
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}

export function describeTaxInvoiceListPrintFilters(f: TaxInvoiceListPrintFilterSummary): string[] {
  const lines: string[] = [];
  if (f.monthYyyyMm.trim()) {
    lines.push(`เดือนออกเอกสาร: ${formatTaxInvoiceListMonthLabel(f.monthYyyyMm)}`);
  }
  if (f.searchTerm.trim()) {
    lines.push(`ค้นหา: "${f.searchTerm.trim()}"`);
  }
  return lines;
}

export function buildTaxInvoiceListPrintHtml(params: {
  rows: TaxInvoiceListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const { rows, scopeTitle, filterLines, generatedAt, printedBy, truncated } = params;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="til-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="til-muted">ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล</p>';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="8" class="til-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td class="til-mono">${escapeHtmlDoc(r.taxInvoiceNo)}</td>
              <td>${escapeHtmlDoc(r.customerName)}</td>
              <td>${escapeHtmlDoc(r.issueDateLabel)}</td>
              <td class="til-mono">${escapeHtmlDoc(r.receiptNo)}</td>
              <td class="til-num">${escapeHtmlDoc(r.taxableLabel)}</td>
              <td class="til-num">${escapeHtmlDoc(r.vatLabel)}</td>
              <td class="til-num">${escapeHtmlDoc(r.totalLabel)}</td>
              <td>${escapeHtmlDoc(r.status)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="til-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองหรือพิมพ์ตามเดือนเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  .til-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .til-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .til-meta { font-size: 9pt; color: #555; margin-bottom: 12px; }
  .til-scope { font-weight: 700; margin-bottom: 6px; }
  .til-filters { margin: 0 0 12px; padding-left: 18px; font-size: 9pt; color: #333; }
  .til-muted { font-size: 9pt; color: #666; margin: 0 0 12px; }
  .til-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .til-table th, .til-table td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }
  .til-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .til-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .til-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; }
  .til-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .til-foot { margin-top: 10px; font-size: 8pt; color: #666; }
</style>
<div class="til-wrap">
  <h1 class="til-title">รายการใบกำกับภาษี</h1>
  <p class="til-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="til-scope">${escapeHtmlDoc(scopeTitle)} — ${rows.length} รายการ</p>
  ${filterBlock}
  <table class="til-table">
    <thead>
      <tr>
        <th>เลขที่ใบกำกับภาษี</th>
        <th>ลูกค้า</th>
        <th>วันที่ออก</th>
        <th>เลขที่ใบเสร็จ</th>
        <th class="til-num">ก่อนภาษี</th>
        <th class="til-num">ภาษี</th>
        <th class="til-num">ยอดรวมสุทธิ</th>
        <th>สถานะ</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="til-foot">OPEC OpsFlow — รายการใบกำกับภาษี (ข้อมูลจากระบบ)</p>
</div>`;
}

export function capTaxInvoiceListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
