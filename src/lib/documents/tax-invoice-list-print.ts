import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';
import {
  describeYearMonthScopeFilter,
  isMonthScopeLookback,
  yearCeToBe,
} from '@/lib/date/year-month-scope-filter';

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
  yearCe: number;
  monthScope: string;
};

const PRINT_ROW_LIMIT = 500;

/** ข้อความเดือนในหัวรายงาน เช่น «กรกฎาคม 2569» หรือ «2 เดือนย้อนหลัง (รวมเดือนปัจจุบัน)» */
export function formatTaxInvoiceSalesReportPeriodLabel(yearCe: number, monthScope: string): string {
  if (isMonthScopeLookback(monthScope)) {
    return describeYearMonthScopeFilter(yearCe, monthScope);
  }
  const mi = Number(monthScope);
  if (Number.isFinite(mi) && mi >= 1 && mi <= 12) {
    return new Date(yearCe, mi - 1, 1).toLocaleDateString('th-TH', {
      month: 'long',
      year: 'numeric',
    });
  }
  return `ปี พ.ศ. ${yearCeToBe(yearCe)}`;
}

export function describeTaxInvoiceListPrintFilters(f: TaxInvoiceListPrintFilterSummary): string[] {
  const lines: string[] = [];
  lines.push(`เดือนออกเอกสาร: ${formatTaxInvoiceSalesReportPeriodLabel(f.yearCe, f.monthScope)}`);
  if (f.searchTerm.trim()) {
    lines.push(`ค้นหา: "${f.searchTerm.trim()}"`);
  }
  return lines;
}

export function buildTaxInvoiceListPrintHtml(params: {
  rows: TaxInvoiceListPrintRow[];
  /** คำอธิบายขอบเขต เช่น พิมพ์ตามตัวกรอง / พิมพ์ทั้งหมด */
  scopeTitle: string;
  filterLines: string[];
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
  /** เดือนในหัวข้อรายงาน — ถ้าไม่ส่ง ใช้จาก filterLines หรือ «ทั้งหมด» */
  periodLabel?: string;
}): string {
  const { rows, scopeTitle, filterLines, generatedAt, printedBy, truncated, periodLabel } = params;

  const monthText =
    (periodLabel && periodLabel.trim()) ||
    (() => {
      const fromFilter = filterLines.find((l) => l.startsWith('เดือนออกเอกสาร:'));
      if (fromFilter) return fromFilter.replace(/^เดือนออกเอกสาร:\s*/, '').trim();
      return 'ทั้งหมด';
    })();

  const reportTitle = `รายงานภาษีขาย ประจำ เดือน ${monthText} จำนวน ${rows.length} รายการ`;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="til-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="til-muted">ไม่มีตัวกรองเพิ่มเติม</p>';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="8" class="til-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td class="til-mono">${escapeHtmlDoc(r.taxInvoiceNo)}</td>
              <td class="til-customer">${escapeHtmlDoc(r.customerName)}</td>
              <td class="til-date">${escapeHtmlDoc(r.issueDateLabel)}</td>
              <td class="til-mono">${escapeHtmlDoc(r.receiptNo)}</td>
              <td class="til-num">${escapeHtmlDoc(r.taxableLabel)}</td>
              <td class="til-num">${escapeHtmlDoc(r.vatLabel)}</td>
              <td class="til-num">${escapeHtmlDoc(r.totalLabel)}</td>
              <td class="til-status">${escapeHtmlDoc(r.status)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="til-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองหรือพิมพ์ตามเดือนเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  @page { size: A4 landscape; margin: 8mm 10mm; }
  .til-wrap {
    font-family: Sarabun, sans-serif;
    font-size: 10pt;
    color: #111;
    width: 100%;
    max-width: 100%;
  }
  .til-title {
    font-size: 14pt;
    font-weight: 800;
    margin: 0 0 2px;
    color: #0f3d5c;
    line-height: 1.3;
  }
  .til-meta { font-size: 8.5pt; color: #555; margin: 0 0 6px; }
  .til-scope { font-weight: 700; margin: 0 0 4px; font-size: 9.5pt; }
  .til-filters { margin: 0 0 8px; padding-left: 18px; font-size: 8.5pt; color: #333; }
  .til-muted { font-size: 8.5pt; color: #666; margin: 0 0 8px; }
  .til-table { width: 100%; border-collapse: collapse; font-size: 9pt; table-layout: fixed; }
  .til-table th, .til-table td {
    border: 1px solid #ccc;
    padding: 4px 6px;
    vertical-align: top;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .til-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .til-customer { word-break: break-word; overflow-wrap: anywhere; }
  .til-date {
    white-space: nowrap;
    font-size: 8.5pt;
    padding-left: 3px !important;
    padding-right: 3px !important;
    text-align: center;
  }
  .til-status {
    white-space: nowrap;
    font-size: 8.5pt;
    padding-left: 3px !important;
    padding-right: 3px !important;
    text-align: center;
  }
  .til-table th.til-date,
  .til-table th.til-status { text-align: center; }
  .til-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .til-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; word-break: break-all; }
  .til-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .til-foot { margin-top: 6px; font-size: 8pt; color: #666; }
  @media print {
    .til-wrap { page-break-after: auto; break-after: auto; }
    .til-table { font-size: 8pt; }
    .til-table th, .til-table td { padding: 3px 5px; }
    .til-foot {
      page-break-before: avoid !important;
      break-before: avoid !important;
      page-break-after: auto !important;
      break-after: auto !important;
    }
  }
</style>
<div class="sd-list-report til-wrap">
  <h1 class="til-title">${escapeHtmlDoc(reportTitle)}</h1>
  <p class="til-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="til-scope">${escapeHtmlDoc(scopeTitle)} — ${rows.length} รายการ</p>
  ${filterBlock}
  <table class="til-table">
    <colgroup>
      <col style="width:13%" />
      <col style="width:30%" />
      <col style="width:7%" />
      <col style="width:11%" />
      <col style="width:12%" />
      <col style="width:9%" />
      <col style="width:12%" />
      <col style="width:6%" />
    </colgroup>
    <thead>
      <tr>
        <th>เลขที่ใบกำกับภาษี</th>
        <th>ลูกค้า</th>
        <th class="til-date">วันที่ออก</th>
        <th>เลขที่ใบเสร็จ</th>
        <th class="til-num">ก่อนภาษี</th>
        <th class="til-num">ภาษี</th>
        <th class="til-num">ยอดรวมสุทธิ</th>
        <th class="til-status">สถานะ</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="til-foot">OPEC OpsFlow — รายงานภาษีขาย (ข้อมูลจากระบบ)</p>
</div>`;
}

export function capTaxInvoiceListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
