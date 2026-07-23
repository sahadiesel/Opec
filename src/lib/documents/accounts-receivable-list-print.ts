import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';
import { describeYearMonthScopeFilter } from '@/lib/date/year-month-scope-filter';

export type AccountsReceivableListPrintRow = {
  customerName: string;
  documentNo: string;
  issueDateLabel: string;
  dueDate: string;
  debitLabel: string;
  creditLabel: string;
  outstandingLabel: string;
  status: string;
};

export type AccountsReceivableListPrintFilterSummary = {
  searchTerm: string;
  yearCe: number;
  monthScope: string;
};

const PRINT_ROW_LIMIT = 500;

export function describeAccountsReceivableListPrintFilters(
  f: AccountsReceivableListPrintFilterSummary,
): string[] {
  const lines: string[] = [];
  lines.push(`เดือนเอกสาร: ${describeYearMonthScopeFilter(f.yearCe, f.monthScope)}`);
  if (f.searchTerm.trim()) {
    lines.push(`ค้นหา: "${f.searchTerm.trim()}"`);
  }
  return lines;
}

export function buildAccountsReceivableListPrintHtml(params: {
  rows: AccountsReceivableListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const { rows, scopeTitle, filterLines, generatedAt, printedBy, truncated } = params;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="arl-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="arl-muted">ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล</p>';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="8" class="arl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td>${escapeHtmlDoc(r.customerName)}</td>
              <td class="arl-mono">${escapeHtmlDoc(r.documentNo)}</td>
              <td>${escapeHtmlDoc(r.issueDateLabel)}</td>
              <td>${escapeHtmlDoc(r.dueDate)}</td>
              <td class="arl-num">${escapeHtmlDoc(r.debitLabel)}</td>
              <td class="arl-num">${escapeHtmlDoc(r.creditLabel)}</td>
              <td class="arl-num">${escapeHtmlDoc(r.outstandingLabel)}</td>
              <td>${escapeHtmlDoc(r.status)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="arl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองหรือพิมพ์ทั้งหมดเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  .arl-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .arl-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .arl-meta { font-size: 9pt; color: #555; margin-bottom: 12px; }
  .arl-scope { font-weight: 700; margin-bottom: 6px; }
  .arl-filters { margin: 0 0 12px; padding-left: 18px; font-size: 9pt; color: #333; }
  .arl-muted { font-size: 9pt; color: #666; margin: 0 0 12px; }
  .arl-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .arl-table th, .arl-table td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }
  .arl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .arl-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .arl-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; }
  .arl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .arl-foot { margin-top: 10px; font-size: 8pt; color: #666; }
</style>
<div class="arl-wrap">
  <h1 class="arl-title">รายการลูกหนี้การค้า (Accounts Receivable)</h1>
  <p class="arl-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="arl-scope">${escapeHtmlDoc(scopeTitle)} — ${rows.length} รายการ</p>
  ${filterBlock}
  <table class="arl-table">
    <thead>
      <tr>
        <th>ลูกค้า</th>
        <th>เอกสารอ้างอิง</th>
        <th>วันที่ออก</th>
        <th>ครบกำหนด</th>
        <th class="arl-num">ยอดขาย</th>
        <th class="arl-num">รับแล้ว</th>
        <th class="arl-num">คงเหลือ</th>
        <th>สถานะ</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="arl-foot">OPEC OpsFlow — รายการลูกหนี้การค้า (ข้อมูลจากระบบ)</p>
</div>`;
}

export function capAccountsReceivableListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
