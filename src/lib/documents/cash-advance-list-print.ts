import { formatPayrollYearMonthThaiBE } from '@/lib/date-thai';
import { describeYearMonthScopeFilter } from '@/lib/date/year-month-scope-filter';
import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';
import type { CashAdvanceStatus } from '@/lib/types';

export type CashAdvanceListPrintRow = {
  requestNo: string;
  dateLabel: string;
  subjectName: string;
  subjectTypeLabel: string;
  amountLabel: string;
  originLabel: string;
  statusLabel: string;
};

export type CashAdvanceListPrintFilterSummary = {
  searchQuery?: string;
  yearCe?: number;
  monthScope?: string;
  /** @deprecated ใช้ yearCe + monthScope — ยังรองรับค่าเดิม */
  monthYyyyMm?: string;
};

const PRINT_ROW_LIMIT = 500;

export function cashAdvanceStatusLabelTh(status: CashAdvanceStatus | string): string {
  const map: Record<string, string> = {
    PENDING_SUBJECT_CONFIRMATION: 'รอยืนยันผู้ถือเรื่อง',
    PENDING_PAYROLL_REVIEW: 'รอ Payroll ตรวจ',
    REJECTED_PAYROLL: 'Payroll ปฏิเสธ',
    PENDING_MANAGER_APPROVAL: 'รอผู้จัดการ',
    REJECTED_MANAGER: 'ผู้จัดการปฏิเสธ',
    PENDING_PAYMENT: 'รอจ่าย (บัญชี)',
    PAID_PETTY_CASH: 'จ่ายจาก Petty',
    PAID_OTHER: 'จ่ายแล้ว (อื่น)',
    CANCELLED: 'ยกเลิก',
  };
  return map[status] ?? status;
}

export function describeCashAdvanceListPrintFilters(f: CashAdvanceListPrintFilterSummary): string[] {
  const lines: string[] = [];
  const q = f.searchQuery?.trim();
  if (q) lines.push(`ค้นหา: ${q}`);
  if (f.yearCe != null && f.monthScope) {
    lines.push(`ช่วง: ${describeYearMonthScopeFilter(f.yearCe, f.monthScope)}`);
  } else if (f.monthYyyyMm?.trim() && f.monthYyyyMm !== 'ALL') {
    lines.push(`เดือนสร้างคำขอ: ${formatPayrollYearMonthThaiBE(f.monthYyyyMm)}`);
  }
  return lines;
}

export function buildCashAdvanceListPrintHtml(params: {
  rows: CashAdvanceListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const { rows, scopeTitle, filterLines, generatedAt, printedBy, truncated } = params;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="cal-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="cal-muted">ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล</p>';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="7" class="cal-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td class="cal-mono">${escapeHtmlDoc(r.requestNo)}</td>
              <td>${escapeHtmlDoc(r.dateLabel)}</td>
              <td>${escapeHtmlDoc(r.subjectName)}</td>
              <td>${escapeHtmlDoc(r.subjectTypeLabel)}</td>
              <td class="cal-num">${escapeHtmlDoc(r.amountLabel)}</td>
              <td>${escapeHtmlDoc(r.originLabel)}</td>
              <td>${escapeHtmlDoc(r.statusLabel)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="cal-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองหรือพิมพ์ทั้งหมดเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  .cal-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .cal-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .cal-meta { font-size: 9pt; color: #555; margin-bottom: 8px; }
  .cal-scope { font-weight: 700; margin-bottom: 6px; }
  .cal-filters { margin: 0 0 12px; padding-left: 18px; font-size: 9pt; color: #333; }
  .cal-muted { font-size: 9pt; color: #666; margin: 0 0 12px; }
  .cal-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .cal-table th, .cal-table td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }
  .cal-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .cal-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .cal-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; }
  .cal-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .cal-foot { margin-top: 10px; font-size: 8pt; color: #666; }
</style>
<div class="sd-list-report cal-wrap">
  <h1 class="cal-title">รายการเบิกเงินล่วงหน้า</h1>
  <p class="cal-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="cal-scope">${escapeHtmlDoc(scopeTitle)} — ${rows.length} รายการ</p>
  ${filterBlock}
  <table class="cal-table">
    <thead>
      <tr>
        <th>เลขที่</th>
        <th>วันที่</th>
        <th>ผู้เบิก</th>
        <th>ประเภท</th>
        <th class="cal-num">จำนวนเงิน</th>
        <th>แหล่งสร้าง</th>
        <th>สถานะ</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="cal-foot">OPEC OpsFlow — รายการเบิกเงินล่วงหน้า</p>
</div>`;
}

export function capCashAdvanceListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
