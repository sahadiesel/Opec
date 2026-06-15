import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type WaveMonthTimesheetGridPrintRow = {
  workerName: string;
  waveCode: string;
  positionLabel: string;
  dayCells: string[];
  workHoursTotal: string;
  standbyHoursTotal: string;
};

export function buildWaveMonthTimesheetGridPrintHtml(params: {
  monthLabel: string;
  monthYm: string;
  bundleLabel: string | null;
  summaryLine: string;
  dayHeaders: string[];
  rows: WaveMonthTimesheetGridPrintRow[];
  generatedAt: string;
  printedBy?: string;
}): string {
  const {
    monthLabel,
    monthYm,
    bundleLabel,
    summaryLine,
    dayHeaders,
    rows,
    generatedAt,
    printedBy,
  } = params;

  const dayHeadCells = dayHeaders
    .map((d) => `<th class="wm-day">${escapeHtmlDoc(d)}</th>`)
    .join('');

  const tableRows =
    rows.length === 0
      ? `<tr><td colspan="${3 + dayHeaders.length}" class="wm-empty">ไม่มีรายการ</td></tr>`
      : rows
          .map((r) => {
            const dayCells = r.dayCells
              .map((c) => `<td class="wm-day wm-cell">${escapeHtmlDoc(c || '-')}</td>`)
              .join('');
            return `<tr>
              <td class="wm-worker">
                <strong>${escapeHtmlDoc(r.workerName)}</strong><br />
                <span class="wm-sub">${escapeHtmlDoc(r.waveCode)}</span><br />
                <span class="wm-sub">${escapeHtmlDoc(r.positionLabel)}</span>
              </td>
              ${dayCells}
              <td class="wm-num">${escapeHtmlDoc(r.workHoursTotal)}</td>
              <td class="wm-num wm-standby">${escapeHtmlDoc(r.standbyHoursTotal)}</td>
            </tr>`;
          })
          .join('');

  return `
<style>
  .wm-wrap { font-family: Sarabun, sans-serif; font-size: 9pt; color: #111; }
  .wm-title { font-size: 15pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .wm-meta { font-size: 8.5pt; color: #555; margin-bottom: 4px; }
  .wm-scope { font-size: 8.5pt; margin-bottom: 8px; line-height: 1.35; }
  .wm-table { width: 100%; border-collapse: collapse; font-size: 7.5pt; table-layout: fixed; }
  .wm-table th, .wm-table td { border: 1px solid #bbb; padding: 2px 3px; vertical-align: middle; }
  .wm-table th { background: #f3f4f6; font-weight: 700; text-align: center; }
  .wm-worker { width: 9.5rem; min-width: 9.5rem; text-align: left; vertical-align: top; }
  .wm-day { width: 1.35rem; min-width: 1.35rem; max-width: 1.35rem; padding: 1px !important; font-family: ui-monospace, monospace; font-size: 7pt; }
  .wm-cell { text-align: center; font-weight: 600; }
  .wm-num { width: 2.6rem; min-width: 2.6rem; text-align: center; font-weight: 700; white-space: nowrap; }
  .wm-standby { color: #0369a1; }
  .wm-sub { font-size: 6.5pt; color: #666; }
  .wm-empty { text-align: center; padding: 20px; color: #666; font-style: italic; }
  .wm-legend { margin-top: 6px; font-size: 7pt; color: #555; line-height: 1.35; }
  .wm-foot { margin-top: 4px; font-size: 7pt; color: #666; }
  @media print {
    @page { size: landscape; margin: 5mm; }
  }
</style>
<div class="sd-list-report wm-wrap">
  <h1 class="wm-title">สรุปลงเวลารายเดือน</h1>
  <p class="wm-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="wm-scope">
    <strong>เดือน:</strong> ${escapeHtmlDoc(monthLabel)} (${escapeHtmlDoc(monthYm)})
    ${bundleLabel ? `<br /><strong>ชุด PO:</strong> ${escapeHtmlDoc(bundleLabel)}` : ''}
    <br />${escapeHtmlDoc(summaryLine)} · ${rows.length} แถว
  </p>
  <table class="wm-table">
    <thead>
      <tr>
        <th class="wm-worker">พนักงาน / ตำแหน่ง</th>
        ${dayHeadCells}
        <th class="wm-num">รวมชม.<br />(ทำงาน)</th>
        <th class="wm-num">รวมชม.<br />(SB)</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  <p class="wm-legend">
    <strong>คีย์:</strong> W=ทำงาน · SB=สแตนด์บาย · T=เดินทาง · M1=Mob · D1=Demob · «-»=ยังไม่มีบันทึก
  </p>
  <p class="wm-foot">OPEC OpsFlow — ตารางสรุปลงเวลารายเดือน</p>
</div>`;
}
