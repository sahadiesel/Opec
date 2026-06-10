import { formatPayrollYearMonthThaiBE } from '@/lib/date-thai';
import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type AccountsPayableListPrintRow = {
  vendorName: string;
  documentNo: string;
  billDate: string;
  dueDate: string;
  debitLabel: string;
  creditLabel: string;
  outstandingLabel: string;
  status: string;
};

export type AccountsPayableListPrintFilterSummary = {
  searchTerm: string;
  monthYyyyMm: string;
};

const PRINT_ROW_LIMIT = 500;

export function describeAccountsPayableListPrintFilters(f: AccountsPayableListPrintFilterSummary): string[] {
  const lines: string[] = [];
  if (f.monthYyyyMm.trim()) {
    lines.push(`เดือนเอกสาร: ${formatPayrollYearMonthThaiBE(f.monthYyyyMm)}`);
  }
  if (f.searchTerm.trim()) {
    lines.push(`ค้นหา: "${f.searchTerm.trim()}"`);
  }
  return lines;
}

export function buildAccountsPayableListPrintHtml(params: {
  rows: AccountsPayableListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const { rows, scopeTitle, filterLines, generatedAt, printedBy, truncated } = params;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="apl-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="apl-muted">ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล</p>';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="8" class="apl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td>${escapeHtmlDoc(r.vendorName)}</td>
              <td class="apl-mono">${escapeHtmlDoc(r.documentNo)}</td>
              <td>${escapeHtmlDoc(r.billDate)}</td>
              <td>${escapeHtmlDoc(r.dueDate)}</td>
              <td class="apl-num">${escapeHtmlDoc(r.debitLabel)}</td>
              <td class="apl-num">${escapeHtmlDoc(r.creditLabel)}</td>
              <td class="apl-num">${escapeHtmlDoc(r.outstandingLabel)}</td>
              <td>${escapeHtmlDoc(r.status)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="apl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองหรือพิมพ์ทั้งหมดเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  .apl-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .apl-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .apl-meta { font-size: 9pt; color: #555; margin-bottom: 12px; }
  .apl-scope { font-weight: 700; margin-bottom: 6px; }
  .apl-filters { margin: 0 0 12px; padding-left: 18px; font-size: 9pt; color: #333; }
  .apl-muted { font-size: 9pt; color: #666; margin: 0 0 12px; }
  .apl-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .apl-table th, .apl-table td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }
  .apl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .apl-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .apl-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; }
  .apl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .apl-foot { margin-top: 10px; font-size: 8pt; color: #666; }
</style>
<div class="apl-wrap">
  <h1 class="apl-title">รายการเจ้าหนี้การค้า (Accounts Payable)</h1>
  <p class="apl-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="apl-scope">${escapeHtmlDoc(scopeTitle)} — ${rows.length} รายการ</p>
  ${filterBlock}
  <table class="apl-table">
    <thead>
      <tr>
        <th>คู่ค้า</th>
        <th>เอกสารอ้างอิง</th>
        <th>วันที่เอกสาร</th>
        <th>ครบกำหนด</th>
        <th class="apl-num">ยอดหนี้</th>
        <th class="apl-num">จ่ายแล้ว</th>
        <th class="apl-num">คงเหลือ</th>
        <th>สถานะ</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="apl-foot">OPEC OpsFlow — รายการเจ้าหนี้การค้า (ข้อมูลจากระบบ)</p>
</div>`;
}

export function capAccountsPayableListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
