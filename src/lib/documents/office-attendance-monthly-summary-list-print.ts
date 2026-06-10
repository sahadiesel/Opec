import { formatPayrollYearMonthThaiBE } from '@/lib/date-thai';
import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';
import type { OfficeLeaveType } from '@/lib/leaves/types';

export type OfficeAttendanceGridDayCell = {
  inLabel: string;
  outLabel: string;
  tone: 'time' | 'leave' | 'absent' | 'off';
};

export type OfficeAttendanceMonthlyStaffPrintRow = {
  staffName: string;
  staffCode: string;
  cellsByYmd: Record<string, OfficeAttendanceGridDayCell>;
};

export type OfficeAttendanceMonthlySummaryPrintFilterSummary = {
  payrollMonth: string;
  searchQuery?: string;
};

const PRINT_STAFF_LIMIT = 100;

export function officeLeaveTypeShortTh(type: OfficeLeaveType): string {
  const map: Record<OfficeLeaveType, string> = {
    SICK: 'ป่วย',
    PERSONAL: 'กิจ',
    VACATION: 'พักร้อน',
  };
  return map[type];
}

export function describeOfficeAttendanceMonthlySummaryPrintFilters(
  f: OfficeAttendanceMonthlySummaryPrintFilterSummary,
): string[] {
  const lines: string[] = [`เดือน: ${formatPayrollYearMonthThaiBE(f.payrollMonth)}`];
  const q = (f.searchQuery ?? '').trim();
  if (q) lines.push(`ค้นหา: ${q}`);
  return lines;
}

function dayOfMonthFromYmd(ymd: string): number {
  return Number(ymd.slice(8, 10));
}

function splitMonthYmDs(ymDs: string[]): { page1: string[]; page2: string[] } {
  return {
    page1: ymDs.filter((ymd) => dayOfMonthFromYmd(ymd) <= 15),
    page2: ymDs.filter((ymd) => dayOfMonthFromYmd(ymd) >= 16),
  };
}

function renderGridCell(c: OfficeAttendanceGridDayCell): string {
  const inHtml = c.inLabel ? escapeHtmlDoc(c.inLabel) : '&nbsp;';
  const outHtml = c.outLabel ? escapeHtmlDoc(c.outLabel) : '&nbsp;';
  return `<td class="oam-grid-cell oam-tone-${c.tone}">
    <div class="oam-in">${inHtml}</div>
    <div class="oam-out">${outHtml}</div>
  </td>`;
}

function renderGridPage(params: {
  staffRows: OfficeAttendanceMonthlyStaffPrintRow[];
  dayYmDs: string[];
  pageLabel: string;
  payrollMonth: string;
}): string {
  const { staffRows, dayYmDs, pageLabel, payrollMonth } = params;
  if (dayYmDs.length === 0) return '';

  const dayHeaders = dayYmDs
    .map((ymd) => `<th class="oam-day-head">${dayOfMonthFromYmd(ymd)}</th>`)
    .join('');

  const bodyRows =
    staffRows.length === 0
      ? `<tr><td colspan="${dayYmDs.length + 1}" class="oam-empty">ไม่มีรายการ</td></tr>`
      : staffRows
          .map((staff) => {
            const dayCells = dayYmDs
              .map((ymd) => renderGridCell(staff.cellsByYmd[ymd] ?? { inLabel: '', outLabel: '', tone: 'off' }))
              .join('');
            return `<tr>
              <td class="oam-name">${escapeHtmlDoc(staff.staffName)}</td>
              ${dayCells}
            </tr>`;
          })
          .join('');

  return `<section class="oam-page">
    <h2 class="oam-page-title">${escapeHtmlDoc(pageLabel)} · ${escapeHtmlDoc(formatPayrollYearMonthThaiBE(payrollMonth))}</h2>
    <p class="oam-page-hint">บรรทัดบน = เข้างาน · บรรทัดล่าง = ออกงาน · ไม่มีเวลา: กิจ/ป่วย/พักร้อน (ใบลาอนุมัติ) · ขาด = วันทำงานที่ผ่านมาแล้วและใช้ฐานสแกน · ว่าง = วันหยุด / ก่อนเริ่มงาน / ยังไม่ถึงวัน / ฐานเงินเดือน</p>
    <table class="oam-grid">
      <thead>
        <tr>
          <th class="oam-name-head">ชื่อ</th>
          ${dayHeaders}
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </section>`;
}

export function buildOfficeAttendanceMonthlySummaryListPrintHtml(params: {
  staffRows: OfficeAttendanceMonthlyStaffPrintRow[];
  ymDs: string[];
  scopeTitle: string;
  filterLines: string[];
  payrollMonth: string;
  weeklyRestLabel: string;
  calendarHolidayCount: number;
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const {
    staffRows,
    ymDs,
    scopeTitle,
    filterLines,
    payrollMonth,
    weeklyRestLabel,
    calendarHolidayCount,
    generatedAt,
    printedBy,
    truncated,
  } = params;

  const { page1, page2 } = splitMonthYmDs(ymDs);
  const lastDay = ymDs.length > 0 ? dayOfMonthFromYmd(ymDs[ymDs.length - 1]!) : 31;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="oam-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '';

  const gridPages = [
    renderGridPage({
      staffRows,
      dayYmDs: page1,
      pageLabel: 'วันที่ 1–15',
      payrollMonth,
    }),
    renderGridPage({
      staffRows,
      dayYmDs: page2,
      pageLabel: `วันที่ 16–${lastDay}`,
      payrollMonth,
    }),
  ]
    .filter(Boolean)
    .join('');

  const truncateNote = truncated
    ? `<p class="oam-foot">แสดงสูงสุด ${PRINT_STAFF_LIMIT} คน — ปรับตัวกรองหรือพิมพ์ทั้งหมดเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  @page { size: landscape; margin: 5mm; }
  .oam-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .oam-title { font-size: 14pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .oam-meta { font-size: 8.5pt; color: #555; margin-bottom: 6px; }
  .oam-scope { font-weight: 700; margin-bottom: 4px; font-size: 9pt; }
  .oam-note { font-size: 8pt; color: #444; margin-bottom: 6px; line-height: 1.4; }
  .oam-filters { margin: 0 0 8px; padding-left: 18px; font-size: 8.5pt; color: #333; }
  .oam-page { page-break-after: always; margin-bottom: 4px; }
  .oam-page:last-of-type { page-break-after: auto; }
  .oam-page-title { font-size: 11pt; font-weight: 800; margin: 0 0 2px; color: #0f3d5c; }
  .oam-page-hint { font-size: 7.5pt; color: #666; margin: 0 0 4px; }
  .oam-grid { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8pt; }
  .oam-grid th, .oam-grid td { border: 1px solid #999; padding: 0; vertical-align: middle; }
  .oam-grid th { background: #f3f4f6; font-weight: 700; text-align: center; padding: 3px 2px; }
  .oam-name-head { width: 9.5rem; text-align: left !important; padding-left: 6px !important; }
  .oam-day-head { min-width: 1.75rem; }
  .oam-name { font-size: 8.5pt; font-weight: 600; padding: 4px 6px !important; text-align: left; vertical-align: middle; word-wrap: break-word; }
  .oam-grid-cell { height: 2.6rem; text-align: center; vertical-align: middle; padding: 0 !important; }
  .oam-in, .oam-out { font-family: ui-monospace, monospace; font-size: 7.5pt; line-height: 1.25; padding: 1px 2px; min-height: 1.1rem; }
  .oam-in { border-bottom: 1px solid #ddd; }
  .oam-tone-leave .oam-in { color: #1d4ed8; font-weight: 700; font-family: Sarabun, sans-serif; font-size: 7pt; }
  .oam-tone-absent .oam-in { color: #b91c1c; font-weight: 800; font-family: Sarabun, sans-serif; font-size: 7.5pt; }
  .oam-tone-off .oam-in, .oam-tone-off .oam-out { color: #ccc; }
  .oam-empty { text-align: center; padding: 16px; color: #666; font-style: italic; }
  .oam-foot { margin-top: 6px; font-size: 8pt; color: #666; }
</style>
<div class="sd-list-report oam-wrap">
  <h1 class="oam-title">รายการลงเวลารายเดือน (พนักงานออฟฟิศ)</h1>
  <p class="oam-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="oam-scope">${escapeHtmlDoc(scopeTitle)} — ${staffRows.length} คน · ${escapeHtmlDoc(formatPayrollYearMonthThaiBE(payrollMonth))}</p>
  <p class="oam-note">วันหยุดประจำสัปดาห์ (${escapeHtmlDoc(weeklyRestLabel)}) และวันหยุดในปฏิทิน HR Settings (${calendarHolidayCount} วัน) · ไม่นับขาด: ก่อนวันเริ่มงาน · วันที่ยังไม่ถึง · พนักงานฐานเงินเดือน (ไม่หักจากสแกน) · เวลา Asia/Bangkok</p>
  ${filterBlock}
  ${gridPages}
  ${truncateNote}
  <p class="oam-foot">OPEC OpsFlow — สรุปการลงเวลา Kiosk (QR) รายเดือน</p>
</div>`;
}

export function capOfficeAttendanceMonthlyStaffPrintRows<T>(
  rows: T[],
): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_STAFF_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_STAFF_LIMIT), truncated: true };
}
