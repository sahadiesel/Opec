import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type WorkerListPrintRow = {
  workerCode: string;
  fullName: string;
  nationalId: string;
  hoursLabel: string;
  positionLabel: string;
  readinessLabel: string;
  jobStatusLabel: string;
  assignmentDetail: string;
};

export type WorkerListPrintFilterSummary = {
  searchTerm: string;
  positionFilterLabel: string;
  jobStatusFilterLabel: string;
  sortLabel: string;
};

const PRINT_ROW_LIMIT = 500;

export function describeWorkerListPrintFilters(f: WorkerListPrintFilterSummary): string[] {
  const lines: string[] = [];
  if (f.positionFilterLabel && f.positionFilterLabel !== 'ทุกตำแหน่ง') {
    lines.push(`ตำแหน่ง: ${f.positionFilterLabel}`);
  }
  if (f.jobStatusFilterLabel && f.jobStatusFilterLabel !== 'ทุกสถานะงาน') {
    lines.push(`สถานะงาน: ${f.jobStatusFilterLabel}`);
  }
  if (f.searchTerm.trim()) {
    lines.push(`ค้นหา: "${f.searchTerm.trim()}"`);
  }
  if (f.sortLabel.trim()) {
    lines.push(`เรียง: ${f.sortLabel}`);
  }
  return lines;
}

export function buildWorkerListPrintHtml(params: {
  rows: WorkerListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const { rows, scopeTitle, filterLines, generatedAt, printedBy, truncated } = params;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="wl-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="wl-muted">ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล</p>';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="6" class="wl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td class="wl-mono">${escapeHtmlDoc(r.workerCode)}</td>
              <td>${escapeHtmlDoc(r.fullName)}${
                r.nationalId
                  ? `<br /><span class="wl-sub">${escapeHtmlDoc(r.nationalId)}</span>`
                  : ''
              }</td>
              <td class="wl-center">${escapeHtmlDoc(r.hoursLabel)}</td>
              <td class="wl-center">${escapeHtmlDoc(r.positionLabel)}</td>
              <td>${escapeHtmlDoc(r.readinessLabel)}</td>
              <td>${escapeHtmlDoc(r.jobStatusLabel)}${
                r.assignmentDetail
                  ? `<br /><span class="wl-sub">${escapeHtmlDoc(r.assignmentDetail)}</span>`
                  : ''
              }</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="wl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  .wl-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .wl-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .wl-meta { font-size: 9pt; color: #555; margin-bottom: 12px; }
  .wl-scope { font-weight: 700; margin-bottom: 6px; }
  .wl-filters { margin: 0 0 12px; padding-left: 18px; font-size: 9pt; color: #333; }
  .wl-muted { font-size: 9pt; color: #666; margin: 0 0 12px; }
  .wl-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .wl-table th, .wl-table td { border: 1px solid #ccc; padding: 4px 6px; vertical-align: top; }
  .wl-table th { background: #f3f4f6; font-weight: 700; text-align: left; line-height: 1.15; }
  .wl-th-en { display: block; font-size: 7.5pt; font-weight: 600; color: #666; margin-top: 1px; }
  .wl-center { text-align: center; }
  .wl-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; }
  .wl-sub { font-size: 8pt; color: #666; }
  .wl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .wl-foot { margin-top: 10px; font-size: 8pt; color: #666; }
  @media print {
    .wl-table th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
<div class="sd-list-report wl-wrap">
  <h1 class="wl-title">ทะเบียนลูกจ้างหน้างาน (Field Workers)</h1>
  <p class="wl-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="wl-scope">${escapeHtmlDoc(scopeTitle)} — ${rows.length} รายการ</p>
  ${filterBlock}
  <table class="wl-table">
    <thead>
      <tr>
        <th>รหัส<span class="wl-th-en">Code</span></th>
        <th>ชื่อคนงาน<span class="wl-th-en">Worker Name</span></th>
        <th class="wl-center">ชั่วโมงสะสม<span class="wl-th-en">Total Hours</span></th>
        <th class="wl-center">ตำแหน่งหลัก<span class="wl-th-en">Position</span></th>
        <th>ความพร้อม<span class="wl-th-en">Readiness</span></th>
        <th>สถานะงาน<span class="wl-th-en">Job Status</span></th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="wl-foot">OPEC OpsFlow — ทะเบียนลูกจ้างหน้างาน</p>
</div>`;
}

export function capWorkerListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
