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

  const periodLine = filterLines.find((l) => l.startsWith('งวดเงินเดือน:'));
  const otherFilterLines = filterLines.filter((l) => !l.startsWith('งวดเงินเดือน:'));
  const printedMeta = `พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}`;
  const scopeRightNote =
    !periodLine && filterLines.length === 0 ? 'ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล' : undefined;
  const scopeRight = periodLine ?? scopeRightNote;

  const filterBlock =
    otherFilterLines.length > 0
      ? `<ul class="ssl-filters">${otherFilterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="9" class="ssl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td>${escapeHtmlDoc(r.section)}</td>
              <td>${escapeHtmlDoc(r.wageStatus)}</td>
              <td class="ssl-num">${escapeHtmlDoc(r.paidLabel)}</td>
              <td class="ssl-num">${escapeHtmlDoc(r.ssoLabel)}</td>
              <td class="ssl-num">${escapeHtmlDoc(r.employerLabel)}</td>
              <td>${escapeHtmlDoc(r.employerStatus)}</td>
              <td class="ssl-mono">${escapeHtmlDoc(r.batchLabel)}</td>
              <td class="ssl-earner">${escapeHtmlDoc(r.earnerName)}<br /><span class="ssl-sub">${escapeHtmlDoc(r.earnerId)}</span></td>
              <td class="ssl-date">${escapeHtmlDoc(r.paymentDate)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="ssl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  @page { size: A4 landscape; margin: 5mm 6mm; }
  .ssl-wrap {
    font-family: Sarabun, sans-serif;
    font-size: 10pt;
    color: #111;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
  }
  .ssl-head-row {
    display: table;
    width: 100%;
    table-layout: fixed;
    margin-bottom: 6px;
  }
  .ssl-head-row > * {
    display: table-cell;
    vertical-align: baseline;
  }
  .ssl-head-left { width: 58%; padding-right: 10px; }
  .ssl-head-right {
    width: 42%;
    margin: 0;
    font-size: 9pt;
    color: #555;
    text-align: right;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .ssl-title { font-size: 16pt; font-weight: 800; margin: 0; color: #0f3d5c; }
  .ssl-meta { font-size: 9pt; color: #555; margin-bottom: 8px; }
  .ssl-scope { font-weight: 700; margin: 0; }
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
  .ssl-table { width: 100%; max-width: 100%; border-collapse: collapse; font-size: 9pt; table-layout: fixed; }
  .ssl-table th, .ssl-table td {
    border: 1px solid #ccc;
    padding: 5px 6px;
    vertical-align: top;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .ssl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .ssl-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .ssl-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; word-break: break-all; }
  .ssl-earner { word-break: break-word; overflow-wrap: anywhere; }
  .ssl-date { white-space: nowrap; font-size: 8.5pt; }
  .ssl-sub { font-size: 8pt; color: #666; font-family: ui-monospace, monospace; word-break: break-all; }
  .ssl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .ssl-foot { margin-top: 6px; font-size: 8pt; color: #666; }
  @media print {
    .ssl-wrap { page-break-after: auto; break-after: auto; }
    .ssl-totals { gap: 6px; margin-bottom: 8px; }
    .ssl-table { font-size: 8pt; }
    .ssl-table th, .ssl-table td { padding: 3px 5px; }
    .ssl-foot {
      page-break-before: auto !important;
      break-before: auto !important;
      page-break-after: auto !important;
      break-after: auto !important;
    }
  }
  @media (max-width: 640px) {
    .ssl-totals { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
<div class="sd-list-report ssl-wrap">
  <div class="ssl-head-row">
    <h1 class="ssl-title ssl-head-left">รายการจ่ายประกันสังคม (รายเงินสมทบลูกจ้าง)</h1>
    <p class="ssl-head-right">${printedMeta}</p>
  </div>
  <div class="ssl-head-row">
    <p class="ssl-scope ssl-head-left">${escapeHtmlDoc(scopeTitle)} — ${rows.length} รายการ</p>
    ${scopeRight ? `<p class="ssl-head-right">${escapeHtmlDoc(scopeRight)}</p>` : '<span class="ssl-head-right" aria-hidden="true"></span>'}
  </div>
  ${filterBlock}
  <div class="ssl-totals">
    <div class="ssl-total-box">รวมทั้ง 3 หมวด<strong>${escapeHtmlDoc(grandTotalLabel)}</strong></div>
    <div class="ssl-total-box">ลูกจ้าง<strong>${escapeHtmlDoc(workerTotalLabel)}</strong></div>
    <div class="ssl-total-box">ออฟฟิศ<strong>${escapeHtmlDoc(officeTotalLabel)}</strong></div>
    <div class="ssl-total-box">ผู้บริหาร<strong>${escapeHtmlDoc(executiveTotalLabel)}</strong></div>
  </div>
  <table class="ssl-table">
    <colgroup>
      <col style="width:7%" />
      <col style="width:11%" />
      <col style="width:9%" />
      <col style="width:8%" />
      <col style="width:9%" />
      <col style="width:11%" />
      <col style="width:12%" />
      <col style="width:21%" />
      <col style="width:12%" />
    </colgroup>
    <thead>
      <tr>
        <th>ประเภท</th>
        <th>สถานะจ่ายค่าจ้าง</th>
        <th class="ssl-num">ยอดจ่าย</th>
        <th class="ssl-num">ยอด ปกส.</th>
        <th class="ssl-num">ปกส.+สมทบ</th>
        <th>สถานะ ปกส.+สมทบ</th>
        <th>ชุดจ่าย / งวด</th>
        <th class="ssl-earner">ผู้มีเงินได้</th>
        <th class="ssl-date">วันที่จ่าย</th>
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
