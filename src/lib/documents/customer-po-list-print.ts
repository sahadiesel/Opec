import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';
import { describeYearMonthScopeFilter } from '@/lib/date/year-month-scope-filter';

export type CustomerPoListPrintRow = {
  poCode: string;
  customerName: string;
  projectLabel: string;
  customerPoLabel: string;
  periodLabel: string;
  creatorLabel: string;
  statusLabel: string;
};

export type CustomerPoListPrintFilterSummary = {
  searchTerm?: string;
  yearCe: number;
  monthScope: string;
};

const PRINT_ROW_LIMIT = 500;

export function describeCustomerPoListPrintFilters(f: CustomerPoListPrintFilterSummary): string[] {
  const lines = [`เดือนเอกสาร: ${describeYearMonthScopeFilter(f.yearCe, f.monthScope)}`];
  const q = (f.searchTerm || '').trim();
  if (q) lines.push(`ค้นหา: ${q}`);
  return lines;
}

function sectionTable(title: string, rows: CustomerPoListPrintRow[]): string {
  const body =
    rows.length === 0
      ? '<tr><td colspan="7" class="cpl-empty">ไม่มีรายการในส่วนนี้</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td class="cpl-mono">${escapeHtmlDoc(r.poCode)}</td>
              <td>${escapeHtmlDoc(r.customerName)}</td>
              <td>${escapeHtmlDoc(r.projectLabel)}${r.customerPoLabel ? `<div class="cpl-sub">${escapeHtmlDoc(r.customerPoLabel)}</div>` : ''}</td>
              <td>${escapeHtmlDoc(r.periodLabel)}</td>
              <td>${escapeHtmlDoc(r.creatorLabel)}</td>
              <td>${escapeHtmlDoc(r.statusLabel)}</td>
            </tr>`,
          )
          .join('');

  return `
  <h2 class="cpl-sec">${escapeHtmlDoc(title)} — ${rows.length} รายการ</h2>
  <table class="cpl-table">
    <thead>
      <tr>
        <th>รหัส PO</th>
        <th>ลูกค้า</th>
        <th>โครงการ</th>
        <th>ระยะเวลา</th>
        <th>ผู้สร้าง</th>
        <th>สถานะ</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

export function buildCustomerPoListPrintHtml(params: {
  contractRows: CustomerPoListPrintRow[];
  quotationRows: CustomerPoListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const { contractRows, quotationRows, scopeTitle, filterLines, generatedAt, printedBy, truncated } = params;
  const total = contractRows.length + quotationRows.length;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="cpl-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="cpl-muted">ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล</p>';

  const truncateNote = truncated
    ? `<p class="cpl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการต่อส่วน — ปรับตัวกรองเดือนเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  .cpl-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .cpl-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .cpl-meta { font-size: 9pt; color: #555; margin-bottom: 12px; }
  .cpl-scope { font-weight: 700; margin-bottom: 6px; }
  .cpl-filters { margin: 0 0 12px; padding-left: 18px; font-size: 9pt; color: #333; }
  .cpl-muted { font-size: 9pt; color: #666; margin: 0 0 12px; }
  .cpl-sec { font-size: 12pt; font-weight: 800; margin: 16px 0 8px; color: #0f3d5c; }
  .cpl-table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 8px; }
  .cpl-table th, .cpl-table td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }
  .cpl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .cpl-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; }
  .cpl-sub { font-size: 8pt; color: #555; margin-top: 2px; }
  .cpl-empty { text-align: center; padding: 18px; color: #666; font-style: italic; }
  .cpl-foot { margin-top: 10px; font-size: 8pt; color: #666; }
</style>
<div class="cpl-wrap">
  <h1 class="cpl-title">รายการใบสั่งซื้อลูกค้า (Customer PO)</h1>
  <p class="cpl-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="cpl-scope">${escapeHtmlDoc(scopeTitle)} — รวม ${total} รายการ</p>
  ${filterBlock}
  ${sectionTable('1. สร้างจากสัญญา', contractRows)}
  ${sectionTable('2. สร้างจากใบเสนอราคา', quotationRows)}
  ${truncateNote}
  <p class="cpl-foot">OPEC OpsFlow — รายการ Customer PO (ข้อมูลจากระบบ)</p>
</div>`;
}

export function capCustomerPoListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
