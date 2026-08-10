import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type WithholdingPayrollListPrintRow = {
  section: string;
  wageStatus: string;
  taxStatus: string;
  batchLabel: string;
  earnerName: string;
  earnerId: string;
  paymentDate: string;
  paidLabel: string;
  amountLabel: string;
};

const PRINT_ROW_LIMIT = 500;

const WPL_PRINT_STYLES = `
  @page { size: A4 landscape; margin: 5mm 6mm; }
  .wpl-wrap {
    font-family: Sarabun, sans-serif;
    font-size: 10pt;
    color: #111;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
  }
  .wpl-head-row {
    display: table;
    width: 100%;
    table-layout: fixed;
    margin-bottom: 6px;
  }
  .wpl-head-row > * {
    display: table-cell;
    vertical-align: baseline;
  }
  .wpl-head-left { width: 58%; padding-right: 10px; }
  .wpl-head-right {
    width: 42%;
    margin: 0;
    font-size: 9pt;
    color: #555;
    text-align: right;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .wpl-title { font-size: 16pt; font-weight: 800; margin: 0; color: #0f3d5c; }
  .wpl-scope { font-weight: 700; margin: 0; }
  .wpl-totals {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
    font-size: 9pt;
  }
  .wpl-totals--single { grid-template-columns: minmax(0, 220px); }
  .wpl-total-box { border: 1px solid #ccc; padding: 6px 10px; border-radius: 4px; min-width: 0; }
  .wpl-total-box strong { display: block; font-size: 11pt; margin-top: 2px; }
  .wpl-filters { margin: 0 0 8px; padding-left: 18px; font-size: 9pt; color: #333; }
  .wpl-muted { font-size: 9pt; color: #666; margin: 0 0 8px; }
  .wpl-table { width: 100%; max-width: 100%; border-collapse: collapse; font-size: 9pt; table-layout: fixed; }
  .wpl-table th, .wpl-table td {
    border: 1px solid #ccc;
    padding: 5px 6px;
    vertical-align: top;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .wpl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .wpl-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .wpl-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; word-break: break-all; }
  .wpl-earner { word-break: break-word; overflow-wrap: anywhere; }
  .wpl-date { white-space: nowrap; font-size: 8.5pt; }
  .wpl-sub { font-size: 8pt; color: #666; font-family: ui-monospace, monospace; word-break: break-all; }
  .wpl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .wpl-foot { margin-top: 6px; font-size: 8pt; color: #666; }
  @media print {
    .wpl-wrap { page-break-after: auto; break-after: auto; }
    .wpl-totals { gap: 6px; margin-bottom: 8px; }
    .wpl-table { font-size: 8pt; }
    .wpl-table th, .wpl-table td { padding: 3px 5px; }
    .wpl-foot {
      page-break-before: auto !important;
      break-before: auto !important;
      page-break-after: auto !important;
      break-after: auto !important;
    }
  }
`;

const NO_FILTER_NOTE = 'ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล';

function buildWplFilterBlock(filterLines: string[]): {
  filterBlock: string;
  periodLine?: string;
  scopeRightNote?: string;
} {
  const periodLine = filterLines.find((l) => l.startsWith('เดือน:'));
  const otherFilterLines = filterLines.filter((l) => !l.startsWith('เดือน:'));
  const filterBlock =
    otherFilterLines.length > 0
      ? `<ul class="wpl-filters">${otherFilterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '';
  const scopeRightNote = !periodLine && filterLines.length === 0 ? NO_FILTER_NOTE : undefined;
  return { filterBlock, periodLine, scopeRightNote };
}

function buildWplHeader(params: {
  title: string;
  scopeTitle: string;
  rowCount: number;
  generatedAt: string;
  printedBy?: string;
  periodLine?: string;
  scopeRightNote?: string;
  filterBlock: string;
}): string {
  const printedMeta = `พิมพ์เมื่อ ${escapeHtmlDoc(params.generatedAt)}${params.printedBy ? ` · โดย ${escapeHtmlDoc(params.printedBy)}` : ''}`;
  const scopeRight = params.periodLine ?? params.scopeRightNote;
  return `
  <div class="wpl-head-row">
    <h1 class="wpl-title wpl-head-left">${escapeHtmlDoc(params.title)}</h1>
    <p class="wpl-head-right">${printedMeta}</p>
  </div>
  <div class="wpl-head-row">
    <p class="wpl-scope wpl-head-left">${escapeHtmlDoc(params.scopeTitle)} — ${params.rowCount} รายการ</p>
    ${scopeRight ? `<p class="wpl-head-right">${escapeHtmlDoc(scopeRight)}</p>` : '<span class="wpl-head-right" aria-hidden="true"></span>'}
  </div>
  ${params.filterBlock}`;
}

export function buildWithholdingPayrollListPrintHtml(params: {
  rows: WithholdingPayrollListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  /** รวมคอลัมน์ยอดจ่าย ตามรายการที่พิมพ์ */
  paidTotalLabel: string;
  /** รวมคอลัมน์ยอดหัก ตามรายการที่พิมพ์ */
  withholdTotalLabel: string;
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const {
    rows,
    scopeTitle,
    filterLines,
    paidTotalLabel,
    withholdTotalLabel,
    generatedAt,
    printedBy,
    truncated,
  } = params;

  const { filterBlock, periodLine, scopeRightNote } = buildWplFilterBlock(filterLines);

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="8" class="wpl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td>${escapeHtmlDoc(r.section)}</td>
              <td>${escapeHtmlDoc(r.wageStatus)}</td>
              <td>${escapeHtmlDoc(r.taxStatus)}</td>
              <td class="wpl-mono">${escapeHtmlDoc(r.batchLabel)}</td>
              <td class="wpl-earner">${escapeHtmlDoc(r.earnerName)}<br /><span class="wpl-sub">${escapeHtmlDoc(r.earnerId)}</span></td>
              <td class="wpl-date">${escapeHtmlDoc(r.paymentDate)}</td>
              <td class="wpl-num">${escapeHtmlDoc(r.paidLabel)}</td>
              <td class="wpl-num">${escapeHtmlDoc(r.amountLabel)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="wpl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>${WPL_PRINT_STYLES}</style>
<div class="sd-list-report wpl-wrap">
  ${buildWplHeader({
    title: 'รายการหัก ณ ที่จ่าย บุคลากร — ภ.ง.ด.1 / ภ.ง.ด.2',
    scopeTitle,
    rowCount: rows.length,
    generatedAt,
    printedBy,
    periodLine,
    scopeRightNote,
    filterBlock,
  })}
  <div class="wpl-totals">
    <div class="wpl-total-box">รวมรายจ่าย<strong>${escapeHtmlDoc(paidTotalLabel)}</strong></div>
    <div class="wpl-total-box">รวมการหัก<strong>${escapeHtmlDoc(withholdTotalLabel)}</strong></div>
  </div>
  <table class="wpl-table">
    <colgroup>
      <col style="width:7%" />
      <col style="width:11%" />
      <col style="width:11%" />
      <col style="width:13%" />
      <col style="width:21%" />
      <col style="width:12%" />
      <col style="width:11%" />
      <col style="width:11%" />
    </colgroup>
    <thead>
      <tr>
        <th>ประเภท</th>
        <th>สถานะจ่ายค่าจ้าง</th>
        <th>สถานะจ่ายภาษี</th>
        <th>ชุดจ่าย / งวด</th>
        <th class="wpl-earner">ผู้มีเงินได้</th>
        <th class="wpl-date">วันที่จ่าย</th>
        <th class="wpl-num">ยอดจ่าย</th>
        <th class="wpl-num">ยอดหัก</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="wpl-foot">OPEC OpsFlow — หัก ณ ที่จ่ายบุคลากร</p>
</div>`;
}

export function capWithholdingPayrollListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}

export type WithholdingExecutivePayrollListPrintRow = {
  wageStatus: string;
  taxStatus: string;
  runLabel: string;
  payrollMonth: string;
  earnerName: string;
  earnerId: string;
  paymentDate: string;
  paidLabel: string;
  amountLabel: string;
};

export function buildWithholdingExecutivePayrollListPrintHtml(params: {
  rows: WithholdingExecutivePayrollListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  totalLabel: string;
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const { rows, scopeTitle, filterLines, totalLabel, generatedAt, printedBy, truncated } = params;

  const { filterBlock, periodLine, scopeRightNote } = buildWplFilterBlock(filterLines);

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="7" class="wpl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td>${escapeHtmlDoc(r.wageStatus)}</td>
              <td>${escapeHtmlDoc(r.taxStatus)}</td>
              <td class="wpl-mono">${escapeHtmlDoc(r.runLabel)}<br /><span class="wpl-sub">${escapeHtmlDoc(r.payrollMonth)}</span></td>
              <td class="wpl-earner">${escapeHtmlDoc(r.earnerName)}<br /><span class="wpl-sub">${escapeHtmlDoc(r.earnerId)}</span></td>
              <td class="wpl-date">${escapeHtmlDoc(r.paymentDate)}</td>
              <td class="wpl-num">${escapeHtmlDoc(r.paidLabel)}</td>
              <td class="wpl-num">${escapeHtmlDoc(r.amountLabel)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="wpl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>${WPL_PRINT_STYLES}</style>
<div class="sd-list-report wpl-wrap">
  ${buildWplHeader({
    title: 'รายการหัก ณ ที่จ่าย (ผู้บริหาร) — ภ.ง.ด.1 / ภ.ง.ด.2',
    scopeTitle,
    rowCount: rows.length,
    generatedAt,
    printedBy,
    periodLine,
    scopeRightNote,
    filterBlock,
  })}
  <div class="wpl-totals wpl-totals--single">
    <div class="wpl-total-box">ยอดหักรวม<strong>${escapeHtmlDoc(totalLabel)}</strong></div>
  </div>
  <table class="wpl-table">
    <colgroup>
      <col style="width:11%" />
      <col style="width:11%" />
      <col style="width:12%" />
      <col style="width:21%" />
      <col style="width:12%" />
      <col style="width:11%" />
      <col style="width:11%" />
    </colgroup>
    <thead>
      <tr>
        <th>สถานะจ่ายเงินเดือน</th>
        <th>สถานะจ่ายภาษี</th>
        <th>งวด</th>
        <th class="wpl-earner">ผู้มีเงินได้</th>
        <th class="wpl-date">วันที่จ่าย</th>
        <th class="wpl-num">ยอดจ่าย</th>
        <th class="wpl-num">ยอดหัก</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="wpl-foot">OPEC OpsFlow — หัก ณ ที่จ่ายผู้บริหาร (Executive payroll)</p>
</div>`;
}
