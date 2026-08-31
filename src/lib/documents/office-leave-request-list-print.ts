import { formatDateThaiBE } from '@/lib/date-thai';
import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';
import {
  OFFICE_LEAVE_STATUS_LABELS,
  OFFICE_LEAVE_TYPE_LABELS,
} from '@/lib/leaves/policy';
import type { OfficeLeaveRequestDoc } from '@/lib/leaves/types';
import { describeOfficeLeaveSummaryPrintFilters } from '@/lib/documents/office-leave-summary-list-print';
import type { OfficeLeaveSummaryPrintFilterSummary } from '@/lib/documents/office-leave-summary-list-print';

export type OfficeLeaveRequestListPrintRow = {
  staffName: string;
  department: string;
  typeLabel: string;
  dateRangeLabel: string;
  daysLabel: string;
  statusLabel: string;
  createdByLabel: string;
  approverLabel: string;
  reasonLabel: string;
};

const PRINT_ROW_LIMIT = 500;

export function officeLeaveDateRangeLabelTh(
  r: Pick<OfficeLeaveRequestDoc, 'startDate' | 'endDate' | 'isHalfDay' | 'halfDaySession'>,
): string {
  const base = formatDateThaiBE(r.startDate);
  if (!r.isHalfDay && r.endDate !== r.startDate) {
    return `${base} – ${formatDateThaiBE(r.endDate)}`;
  }
  if (r.isHalfDay) {
    return `${base} (${r.halfDaySession === 'MORNING' ? 'ครึ่งเช้า' : 'ครึ่งบ่าย'})`;
  }
  return base;
}

export function officeLeaveCreatedByLabelTh(
  r: Pick<OfficeLeaveRequestDoc, 'createdByName' | 'createdByUid'>,
): string {
  return r.createdByName?.trim() || r.createdByUid || '—';
}

export function officeLeaveApproverLabelTh(
  r: Pick<OfficeLeaveRequestDoc, 'status' | 'approvedByName' | 'approvedByUid'>,
): string {
  if (r.status !== 'APPROVED') return '—';
  return r.approvedByName?.trim() || r.approvedByUid || '—';
}

export function mapOfficeLeaveRequestToPrintRow(r: OfficeLeaveRequestDoc): OfficeLeaveRequestListPrintRow {
  const typeLabel = r.isHalfDay
    ? `${OFFICE_LEAVE_TYPE_LABELS[r.leaveType]} (0.5 วัน)`
    : OFFICE_LEAVE_TYPE_LABELS[r.leaveType];
  const reason = [r.reason?.trim(), r.rejectReason?.trim() ? `ไม่อนุมัติ: ${r.rejectReason.trim()}` : '']
    .filter(Boolean)
    .join(' · ');

  return {
    staffName: r.staffNameSnapshot || '—',
    department: r.staffDepartmentSnapshot || '',
    typeLabel,
    dateRangeLabel: officeLeaveDateRangeLabelTh(r),
    daysLabel: String(r.days ?? '—'),
    statusLabel: OFFICE_LEAVE_STATUS_LABELS[r.status],
    createdByLabel: officeLeaveCreatedByLabelTh(r),
    approverLabel: officeLeaveApproverLabelTh(r),
    reasonLabel: reason || '—',
  };
}

export function describeOfficeLeaveRequestListPrintFilters(
  f: OfficeLeaveSummaryPrintFilterSummary,
): string[] {
  return describeOfficeLeaveSummaryPrintFilters(f);
}

export function buildOfficeLeaveRequestListPrintHtml(params: {
  rows: OfficeLeaveRequestListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const { rows, scopeTitle, filterLines, generatedAt, printedBy, truncated } = params;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="olr-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="olr-muted">ไม่มีตัวกรอง — แสดงทุกคำขอในชุดข้อมูล</p>';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="8" class="olr-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td>${escapeHtmlDoc(r.staffName)}${r.department ? `<br /><span class="olr-sub">${escapeHtmlDoc(r.department)}</span>` : ''}</td>
              <td>${escapeHtmlDoc(r.typeLabel)}</td>
              <td class="olr-nowrap">${escapeHtmlDoc(r.dateRangeLabel)}</td>
              <td class="olr-num">${escapeHtmlDoc(r.daysLabel)}</td>
              <td>${escapeHtmlDoc(r.statusLabel)}</td>
              <td>${escapeHtmlDoc(r.createdByLabel)}</td>
              <td>${escapeHtmlDoc(r.approverLabel)}</td>
              <td>${escapeHtmlDoc(r.reasonLabel)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="olr-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองหรือพิมพ์ทั้งหมดเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  @page { size: landscape; margin: 8mm; }
  .olr-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .olr-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .olr-meta { font-size: 9pt; color: #555; margin-bottom: 8px; }
  .olr-scope { font-weight: 700; margin-bottom: 6px; }
  .olr-filters { margin: 0 0 12px; padding-left: 18px; font-size: 9pt; color: #333; }
  .olr-muted { font-size: 9pt; color: #666; margin: 0 0 12px; }
  .olr-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  .olr-table th, .olr-table td { border: 1px solid #ccc; padding: 5px 6px; vertical-align: top; }
  .olr-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .olr-num { text-align: center; font-family: ui-monospace, monospace; white-space: nowrap; }
  .olr-nowrap { white-space: nowrap; }
  .olr-sub { font-size: 8pt; color: #666; }
  .olr-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .olr-foot { margin-top: 8px; font-size: 8pt; color: #666; }
</style>
<div class="sd-list-report olr-wrap">
  <h1 class="olr-title">รายการคำขอลา (พนักงานออฟฟิศ)</h1>
  <p class="olr-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="olr-scope">${escapeHtmlDoc(scopeTitle)} — ${rows.length} รายการ</p>
  ${filterBlock}
  <table class="olr-table">
    <thead>
      <tr>
        <th>พนักงาน</th>
        <th>ประเภท</th>
        <th>วันที่ลา</th>
        <th class="olr-num">วัน</th>
        <th>สถานะ</th>
        <th>ผู้จัดทำใบลา</th>
        <th>ผู้อนุมัติ</th>
        <th>เหตุผล</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="olr-foot">OPEC OpsFlow — รายการคำขอลาพนักงานออฟฟิศ</p>
</div>`;
}

export function capOfficeLeaveRequestListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
