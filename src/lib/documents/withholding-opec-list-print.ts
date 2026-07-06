import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type WithholdingOpecListPrintRow = {
  issueDateLabel: string;
  taxInvoiceNo: string;
  customerName: string;
  taxableLabel: string;
  vatLabel: string;
  withholdingLabel: string;
  hasAttachmentLabel: string;
};

const PRINT_ROW_LIMIT = 500;
const NO_FILTER_NOTE = 'ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล';

const WOL_PRINT_STYLES = `
  @page { size: A4 landscape; margin: 5mm 6mm; }
  .wol-wrap {
    font-family: Sarabun, sans-serif;
    font-size: 10pt;
    color: #111;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
  }
  .wol-head-row {
    display: table;
    width: 100%;
    table-layout: fixed;
    margin-bottom: 6px;
  }
  .wol-head-row > * {
    display: table-cell;
    vertical-align: baseline;
  }
  .wol-head-left { width: 58%; padding-right: 10px; }
  .wol-head-right {
    width: 42%;
    margin: 0;
    font-size: 9pt;
    color: #555;
    text-align: right;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .wol-title { font-size: 16pt; font-weight: 800; margin: 0; color: #0f3d5c; }
  .wol-scope { font-weight: 700; margin: 0; }
  .wol-totals {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
    font-size: 9pt;
    max-width: 600px;
  }
  .wol-total-box { border: 1px solid #ccc; padding: 6px 10px; border-radius: 4px; min-width: 0; }
  .wol-total-box strong { display: block; font-size: 11pt; margin-top: 2px; }
  .wol-filters { margin: 0 0 8px; padding-left: 18px; font-size: 9pt; color: #333; }
  .wol-table { width: 100%; max-width: 100%; border-collapse: collapse; font-size: 9pt; table-layout: fixed; }
  .wol-table th, .wol-table td {
    border: 1px solid #ccc;
    padding: 5px 6px;
    vertical-align: top;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .wol-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .wol-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .wol-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; word-break: break-all; }
  .wol-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .wol-foot { margin-top: 6px; font-size: 8pt; color: #666; }
  @media print {
    .wol-wrap { page-break-after: auto; break-after: auto; }
    .wol-totals { gap: 6px; margin-bottom: 8px; }
    .wol-table { font-size: 8pt; }
    .wol-table th, .wol-table td { padding: 3px 5px; }
    .wol-foot {
      page-break-before: auto !important;
      break-before: auto !important;
      page-break-after: auto !important;
      break-after: auto !important;
    }
  }
`;

function buildWolFilterBlock(filterLines: string[]): {
  filterBlock: string;
  periodLine?: string;
  scopeRightNote?: string;
} {
  const periodLine = filterLines.find((l) => l.startsWith('เดือน:'));
  const otherFilterLines = filterLines.filter((l) => !l.startsWith('เดือน:'));
  const filterBlock =
    otherFilterLines.length > 0
      ? `<ul class="wol-filters">${otherFilterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '';
  const scopeRightNote = !periodLine && filterLines.length === 0 ? NO_FILTER_NOTE : undefined;
  return { filterBlock, periodLine, scopeRightNote };
}

function buildWolHeader(params: {
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
  <div class="wol-head-row">
    <h1 class="wol-title wol-head-left">รายการหัก ณ ที่จ่าย (OPEC)</h1>
    <p class="wol-head-right">${printedMeta}</p>
  </div>
  <div class="wol-head-row">
    <p class="wol-scope wol-head-left">${escapeHtmlDoc(params.scopeTitle)} — ${params.rowCount} รายการ</p>
    ${scopeRight ? `<p class="wol-head-right">${escapeHtmlDoc(scopeRight)}</p>` : '<span class="wol-head-right" aria-hidden="true"></span>'}
  </div>
  ${params.filterBlock}`;
}

export function buildWithholdingOpecListPrintHtml(params: {
  rows: WithholdingOpecListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  totalTaxableLabel: string;
  totalVatLabel: string;
  totalWithholdingLabel: string;
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const {
    rows,
    scopeTitle,
    filterLines,
    totalTaxableLabel,
    totalVatLabel,
    totalWithholdingLabel,
    generatedAt,
    printedBy,
    truncated,
  } = params;

  const { filterBlock, periodLine, scopeRightNote } = buildWolFilterBlock(filterLines);

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="7" class="wol-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td>${escapeHtmlDoc(r.issueDateLabel)}</td>
              <td class="wol-mono">${escapeHtmlDoc(r.taxInvoiceNo)}</td>
              <td>${escapeHtmlDoc(r.customerName)}</td>
              <td class="wol-num">${escapeHtmlDoc(r.taxableLabel)}</td>
              <td class="wol-num">${escapeHtmlDoc(r.vatLabel)}</td>
              <td class="wol-num">${escapeHtmlDoc(r.withholdingLabel)}</td>
              <td>${escapeHtmlDoc(r.hasAttachmentLabel)}</td>
            </tr>`
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="wol-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>${WOL_PRINT_STYLES}</style>
<div class="sd-list-report wol-wrap">
  ${buildWolHeader({
    scopeTitle,
    rowCount: rows.length,
    generatedAt,
    printedBy,
    periodLine,
    scopeRightNote,
    filterBlock,
  })}
  <div class="wol-totals">
    <div class="wol-total-box">ฐานภาษีรวม<strong>${escapeHtmlDoc(totalTaxableLabel)}</strong></div>
    <div class="wol-total-box">ภาษีมูลค่าเพิ่มรวม<strong>${escapeHtmlDoc(totalVatLabel)}</strong></div>
    <div class="wol-total-box">หัก ณ ที่จ่ายรวม<strong>${escapeHtmlDoc(totalWithholdingLabel)}</strong></div>
  </div>
  <table class="wol-table">
    <colgroup>
      <col style="width:12%" />
      <col style="width:15%" />
      <col style="width:28%" />
      <col style="width:13%" />
      <col style="width:11%" />
      <col style="width:11%" />
      <col style="width:10%" />
    </colgroup>
    <thead>
      <tr>
        <th>วันที่ออก</th>
        <th>เลขที่ใบกำกับภาษี</th>
        <th>ลูกค้า</th>
        <th class="wol-num">ฐานภาษี</th>
        <th class="wol-num">VAT</th>
        <th class="wol-num">หัก ณ ที่จ่าย</th>
        <th>เอกสารแนบ</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="wol-foot">OPEC OpsFlow — หัก ณ ที่จ่ายของบริษัท (ลูกค้านำส่ง)</p>
</div>`;
}

export function capWithholdingOpecListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
