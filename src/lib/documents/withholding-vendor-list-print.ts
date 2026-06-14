import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type WithholdingVendorListPrintRow = {
  paymentStatus: string;
  taxStatus: string;
  certificateNo: string;
  vendorName: string;
  vendorTaxId: string;
  paymentDate: string;
  paidLabel: string;
  withholdingLabel: string;
  billRef: string;
  poRef: string;
};

const PRINT_ROW_LIMIT = 500;
const NO_FILTER_NOTE = 'ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล';

const WVL_PRINT_STYLES = `
  @page { size: A4 landscape; margin: 5mm 6mm; }
  .wvl-wrap {
    font-family: Sarabun, sans-serif;
    font-size: 10pt;
    color: #111;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
  }
  .wvl-head-row {
    display: table;
    width: 100%;
    table-layout: fixed;
    margin-bottom: 6px;
  }
  .wvl-head-row > * {
    display: table-cell;
    vertical-align: baseline;
  }
  .wvl-head-left { width: 58%; padding-right: 10px; }
  .wvl-head-right {
    width: 42%;
    margin: 0;
    font-size: 9pt;
    color: #555;
    text-align: right;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .wvl-title { font-size: 16pt; font-weight: 800; margin: 0; color: #0f3d5c; }
  .wvl-scope { font-weight: 700; margin: 0; }
  .wvl-totals {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
    font-size: 9pt;
    max-width: 420px;
  }
  .wvl-total-box { border: 1px solid #ccc; padding: 6px 10px; border-radius: 4px; min-width: 0; }
  .wvl-total-box strong { display: block; font-size: 11pt; margin-top: 2px; }
  .wvl-filters { margin: 0 0 8px; padding-left: 18px; font-size: 9pt; color: #333; }
  .wvl-table { width: 100%; max-width: 100%; border-collapse: collapse; font-size: 9pt; table-layout: fixed; }
  .wvl-table th, .wvl-table td {
    border: 1px solid #ccc;
    padding: 5px 6px;
    vertical-align: top;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .wvl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .wvl-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .wvl-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; word-break: break-all; }
  .wvl-vendor { word-break: break-word; overflow-wrap: anywhere; }
  .wvl-date { white-space: nowrap; font-size: 8.5pt; }
  .wvl-sub { font-size: 8pt; color: #666; font-family: ui-monospace, monospace; word-break: break-all; }
  .wvl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .wvl-foot { margin-top: 6px; font-size: 8pt; color: #666; }
  @media print {
    .wvl-wrap { page-break-after: auto; break-after: auto; }
    .wvl-totals { gap: 6px; margin-bottom: 8px; }
    .wvl-table { font-size: 8pt; }
    .wvl-table th, .wvl-table td { padding: 3px 5px; }
    .wvl-foot {
      page-break-before: auto !important;
      break-before: auto !important;
      page-break-after: auto !important;
      break-after: auto !important;
    }
  }
`;

function buildWvlFilterBlock(filterLines: string[]): {
  filterBlock: string;
  periodLine?: string;
  scopeRightNote?: string;
} {
  const periodLine = filterLines.find((l) => l.startsWith('เดือน:'));
  const otherFilterLines = filterLines.filter((l) => !l.startsWith('เดือน:'));
  const filterBlock =
    otherFilterLines.length > 0
      ? `<ul class="wvl-filters">${otherFilterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '';
  const scopeRightNote = !periodLine && filterLines.length === 0 ? NO_FILTER_NOTE : undefined;
  return { filterBlock, periodLine, scopeRightNote };
}

function buildWvlHeader(params: {
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
  <div class="wvl-head-row">
    <h1 class="wvl-title wvl-head-left">รายการหัก ณ ที่จ่าย (คู่ค้า)</h1>
    <p class="wvl-head-right">${printedMeta}</p>
  </div>
  <div class="wvl-head-row">
    <p class="wvl-scope wvl-head-left">${escapeHtmlDoc(params.scopeTitle)} — ${params.rowCount} รายการ</p>
    ${scopeRight ? `<p class="wvl-head-right">${escapeHtmlDoc(scopeRight)}</p>` : '<span class="wvl-head-right" aria-hidden="true"></span>'}
  </div>
  ${params.filterBlock}`;
}

export function buildWithholdingVendorListPrintHtml(params: {
  rows: WithholdingVendorListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  totalWithholdingLabel: string;
  totalPaidLabel: string;
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const {
    rows,
    scopeTitle,
    filterLines,
    totalWithholdingLabel,
    totalPaidLabel,
    generatedAt,
    printedBy,
    truncated,
  } = params;

  const { filterBlock, periodLine, scopeRightNote } = buildWvlFilterBlock(filterLines);

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="8" class="wvl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td>${escapeHtmlDoc(r.paymentStatus)}</td>
              <td>${escapeHtmlDoc(r.taxStatus)}</td>
              <td class="wvl-mono">${escapeHtmlDoc(r.certificateNo)}</td>
              <td class="wvl-vendor">${escapeHtmlDoc(r.vendorName)}${r.vendorTaxId ? `<br /><span class="wvl-sub">${escapeHtmlDoc(r.vendorTaxId)}</span>` : ''}</td>
              <td class="wvl-date">${escapeHtmlDoc(r.paymentDate)}</td>
              <td class="wvl-num">${escapeHtmlDoc(r.paidLabel)}</td>
              <td class="wvl-num">${escapeHtmlDoc(r.withholdingLabel)}</td>
              <td>${escapeHtmlDoc(r.billRef)}${r.poRef ? `<br /><span class="wvl-sub">PO ${escapeHtmlDoc(r.poRef)}</span>` : ''}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="wvl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>${WVL_PRINT_STYLES}</style>
<div class="sd-list-report wvl-wrap">
  ${buildWvlHeader({
    scopeTitle,
    rowCount: rows.length,
    generatedAt,
    printedBy,
    periodLine,
    scopeRightNote,
    filterBlock,
  })}
  <div class="wvl-totals">
    <div class="wvl-total-box">ยอดจ่ายรวม<strong>${escapeHtmlDoc(totalPaidLabel)}</strong></div>
    <div class="wvl-total-box">ยอดหักรวม<strong>${escapeHtmlDoc(totalWithholdingLabel)}</strong></div>
  </div>
  <table class="wvl-table">
    <colgroup>
      <col style="width:11%" />
      <col style="width:11%" />
      <col style="width:12%" />
      <col style="width:21%" />
      <col style="width:12%" />
      <col style="width:11%" />
      <col style="width:11%" />
      <col style="width:11%" />
    </colgroup>
    <thead>
      <tr>
        <th>สถานะจ่ายคู่ค้า</th>
        <th>สถานะจ่ายภาษี</th>
        <th>เลขที่หนังสือ</th>
        <th class="wvl-vendor">คู่ค้า</th>
        <th class="wvl-date">วันที่จ่าย</th>
        <th class="wvl-num">ยอดจ่าย</th>
        <th class="wvl-num">ยอดหัก</th>
        <th>ใบวางบิล / PO</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="wvl-foot">OPEC OpsFlow — หัก ณ ที่จ่ายคู่ค้า (ภงด.53)</p>
</div>`;
}

export function capWithholdingVendorListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
