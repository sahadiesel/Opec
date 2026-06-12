import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type SocialSecurityPayrollListPrintRow = {
  section: string;
  wageStatus: string;
  ssoStatus: string;
  employerStatus: string;
  batchLabel: string;
  earnerName: string;
  earnerId: string;
  paymentDate: string;
  paidLabel: string;
  ssoLabel: string;
  employerLabel: string;
};

const PRINT_ROW_LIMIT = 500;

export function buildSocialSecurityPayrollListPrintHtml(params: {
  rows: SocialSecurityPayrollListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  grandTotalLabel: string;
  workerTotalLabel: string;
  officeTotalLabel: string;
  executiveTotalLabel: string;
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const {
    rows,
    scopeTitle,
    filterLines,
    grandTotalLabel,
    workerTotalLabel,
    officeTotalLabel,
    executiveTotalLabel,
    generatedAt,
    printedBy,
    truncated,
  } = params;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="ssl-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="ssl-muted">ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล</p>';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="10" class="ssl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td>${escapeHtmlDoc(r.section)}</td>
              <td>${escapeHtmlDoc(r.wageStatus)}</td>
              <td class="ssl-num">${escapeHtmlDoc(r.paidLabel)}</td>
              <td class="ssl-num">${escapeHtmlDoc(r.ssoLabel)}</td>
              <td>${escapeHtmlDoc(r.ssoStatus)}</td>
              <td class="ssl-num">${escapeHtmlDoc(r.employerLabel)}</td>
              <td>${escapeHtmlDoc(r.employerStatus)}</td>
              <td class="ssl-mono">${escapeHtmlDoc(r.batchLabel)}</td>
              <td>${escapeHtmlDoc(r.earnerName)}<br /><span class="ssl-sub">${escapeHtmlDoc(r.earnerId)}</span></td>
              <td>${escapeHtmlDoc(r.paymentDate)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="ssl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  .ssl-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .ssl-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .ssl-meta { font-size: 9pt; color: #555; margin-bottom: 8px; }
  .ssl-scope { font-weight: 700; margin-bottom: 6px; }
  .ssl-totals {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
    font-size: 9pt;
  }
  .ssl-total-box { border: 1px solid #ccc; padding: 6px 10px; border-radius: 4px; min-width: 0; }
  .ssl-total-box strong { display: block; font-size: 11pt; margin-top: 2px; }
  .ssl-filters { margin: 0 0 8px; padding-left: 18px; font-size: 9pt; color: #333; }
  .ssl-muted { font-size: 9pt; color: #666; margin: 0 0 8px; }
  .ssl-table { width: 100%; border-collapse: collapse; font-size: 9pt; table-layout: fixed; }
  .ssl-table th, .ssl-table td { border: 1px solid #ccc; padding: 5px 6px; vertical-align: top; word-wrap: break-word; }
  .ssl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .ssl-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .ssl-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; }
  .ssl-sub { font-size: 8pt; color: #666; font-family: ui-monospace, monospace; }
  .ssl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .ssl-foot { margin-top: 6px; font-size: 8pt; color: #666; }
  @media print {
    .ssl-totals { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  }
  @media (max-width: 640px) {
    .ssl-totals { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
<div class="sd-list-report ssl-wrap">
  <h1 class="ssl-title">รายการจ่ายประกันสังคม (รายเงินสมทบลูกจ้าง)</h1>
  <p class="ssl-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="ssl-scope">${escapeHtmlDoc(scopeTitle)} — ${rows.length} รายการ</p>
  ${filterBlock}
  <div class="ssl-totals">
    <div class="ssl-total-box">รวมทั้ง 3 หมวด<strong>${escapeHtmlDoc(grandTotalLabel)}</strong></div>
    <div class="ssl-total-box">ลูกจ้าง<strong>${escapeHtmlDoc(workerTotalLabel)}</strong></div>
    <div class="ssl-total-box">ออฟฟิศ<strong>${escapeHtmlDoc(officeTotalLabel)}</strong></div>
    <div class="ssl-total-box">ผู้บริหาร<strong>${escapeHtmlDoc(executiveTotalLabel)}</strong></div>
  </div>
  <table class="ssl-table">
    <thead>
      <tr>
        <th>ประเภท</th>
        <th>สถานะจ่ายค่าจ้าง</th>
        <th class="ssl-num">ยอดจ่าย</th>
        <th class="ssl-num">ยอด ปส.</th>
        <th>สถานะ ปส.</th>
        <th class="ssl-num">ยอดสมทบ</th>
        <th>สถานะสมทบ</th>
        <th>ชุดจ่าย / งวด</th>
        <th>ผู้มีเงินได้</th>
        <th>วันที่จ่าย</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="ssl-foot">OPEC OpsFlow — ประกันสังคม (ลูกจ้าง + ออฟฟิศ + ผู้บริหาร)</p>
</div>`;
}

export function capSocialSecurityPayrollListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
