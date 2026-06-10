import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';
import {
  OFFICE_LEAVE_STATUS_LABELS,
  OFFICE_LEAVE_TYPE_LABELS,
} from '@/lib/leaves/policy';
import type { OfficeLeaveStatus, OfficeLeaveType } from '@/lib/leaves/types';

export type OfficeLeaveSummaryPrintLeaveBlock = {
  entitlement: number;
  used: number;
  pending: number;
  remaining: number;
};

export type OfficeLeaveSummaryPrintRow = {
  staffName: string;
  department: string;
  under365Days: boolean;
  sick: OfficeLeaveSummaryPrintLeaveBlock;
  personal: OfficeLeaveSummaryPrintLeaveBlock;
  vacation: OfficeLeaveSummaryPrintLeaveBlock;
};

export type OfficeLeaveSummaryPrintFilterSummary = {
  monthFilter: 'ALL' | number;
  monthLabel?: string;
  yearFilter: 'ALL' | number;
  statusFilter: 'ALL' | OfficeLeaveStatus;
  typeFilter: 'ALL' | OfficeLeaveType;
  staffFilter: string;
  staffName?: string;
};

const PRINT_ROW_LIMIT = 500;

const THAI_MONTHS = [
  '',
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

function leaveBlockCells(b: OfficeLeaveSummaryPrintLeaveBlock): string {
  return `<td class="ols-num">${b.entitlement}</td>
    <td class="ols-num">${b.used}</td>
    <td class="ols-num ols-pending">${b.pending}</td>
    <td class="ols-num ols-rem">${b.remaining}</td>`;
}

export function describeOfficeLeaveSummaryPrintFilters(
  f: OfficeLeaveSummaryPrintFilterSummary,
): string[] {
  const lines: string[] = [];
  if (f.yearFilter !== 'ALL') lines.push(`ปี (พ.ศ.): ${f.yearFilter}`);
  if (f.monthFilter !== 'ALL') {
    const label = f.monthLabel ?? THAI_MONTHS[f.monthFilter] ?? String(f.monthFilter);
    lines.push(`เดือน: ${label}`);
  }
  if (f.statusFilter !== 'ALL') {
    lines.push(`สถานะ: ${OFFICE_LEAVE_STATUS_LABELS[f.statusFilter]}`);
  }
  if (f.typeFilter !== 'ALL') {
    lines.push(`ประเภท: ${OFFICE_LEAVE_TYPE_LABELS[f.typeFilter]}`);
  }
  if (f.staffFilter !== 'ALL' && f.staffName) {
    lines.push(`พนักงาน: ${f.staffName}`);
  }
  return lines;
}

export function buildOfficeLeaveSummaryListPrintHtml(params: {
  rows: OfficeLeaveSummaryPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  periodTitle: string;
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const { rows, scopeTitle, filterLines, periodTitle, generatedAt, printedBy, truncated } = params;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="ols-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="ols-muted">ไม่มีตัวกรอง — แสดงทุกพนักงานในชุดข้อมูล</p>';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="13" class="ols-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map((r) => {
            const sub = [
              escapeHtmlDoc(r.department),
              r.under365Days ? '&lt; 365 วัน' : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return `<tr>
              <td>${escapeHtmlDoc(r.staffName)}${sub ? `<br /><span class="ols-sub">${sub}</span>` : ''}</td>
              ${leaveBlockCells(r.sick)}
              ${leaveBlockCells(r.personal)}
              ${leaveBlockCells(r.vacation)}
            </tr>`;
          })
          .join('');

  const truncateNote = truncated
    ? `<p class="ols-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองหรือพิมพ์ทั้งหมดเพื่อแยกชุดข้อมูล</p>`
    : '';

  const typeHeaders = (['SICK', 'PERSONAL', 'VACATION'] as const)
    .map((t) => `<th colspan="4" class="ols-group">${escapeHtmlDoc(OFFICE_LEAVE_TYPE_LABELS[t])}</th>`)
    .join('');

  const subHeaders = (['SICK', 'PERSONAL', 'VACATION'] as const)
    .flatMap((t) => [
      `<th class="ols-subhead">สิทธิ์</th>`,
      `<th class="ols-subhead">ลาแล้ว</th>`,
      `<th class="ols-subhead">รอ</th>`,
      `<th class="ols-subhead">คงเหลือ</th>`,
    ])
    .join('');

  return `
<style>
  @page { size: landscape; margin: 8mm; }
  .ols-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .ols-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .ols-meta { font-size: 9pt; color: #555; margin-bottom: 8px; }
  .ols-scope { font-weight: 700; margin-bottom: 4px; }
  .ols-period { font-size: 9pt; color: #333; margin-bottom: 8px; }
  .ols-filters { margin: 0 0 10px; padding-left: 18px; font-size: 9pt; color: #333; }
  .ols-muted { font-size: 9pt; color: #666; margin: 0 0 10px; }
  .ols-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  .ols-table th, .ols-table td { border: 1px solid #ccc; padding: 4px 5px; vertical-align: top; }
  .ols-table th { background: #f3f4f6; font-weight: 700; text-align: center; }
  .ols-table th.ols-staff { text-align: left; }
  .ols-group { font-size: 9pt; }
  .ols-subhead { font-size: 8pt; font-weight: 600; }
  .ols-num { text-align: center; font-family: ui-monospace, monospace; font-size: 8.5pt; }
  .ols-pending { color: #b45309; }
  .ols-rem { font-weight: 700; }
  .ols-sub { font-size: 8pt; color: #666; }
  .ols-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .ols-foot { margin-top: 8px; font-size: 8pt; color: #666; }
</style>
<div class="sd-list-report ols-wrap">
  <h1 class="ols-title">สรุปวันลา (พนักงานออฟฟิศ)</h1>
  <p class="ols-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="ols-scope">${escapeHtmlDoc(scopeTitle)} — ${rows.length} คน</p>
  <p class="ols-period">ช่วงสรุป: ${escapeHtmlDoc(periodTitle)}</p>
  ${filterBlock}
  <table class="ols-table">
    <thead>
      <tr>
        <th rowspan="2" class="ols-staff">พนักงาน</th>
        ${typeHeaders}
      </tr>
      <tr>${subHeaders}</tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="ols-foot">OPEC OpsFlow — สรุปวันลาพนักงานออฟฟิศ (สิทธิ์/ลาแล้ว/รอ/คงเหลือ)</p>
</div>`;
}

export function capOfficeLeaveSummaryListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
