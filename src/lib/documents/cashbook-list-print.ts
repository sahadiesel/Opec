import { formatPayrollYearMonthThaiBE } from '@/lib/date-thai';

import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';



export type CashbookListPrintRow = {

  entryNo: string;

  entryDate: string;

  description: string;

  entryType: string;

  bankLabel: string;

  paymentMethod: string;

  inLabel: string;

  outLabel: string;

};



const PRINT_ROW_LIMIT = 500;



function fmtBahtPrint(amount: number): string {

  if (!Number.isFinite(amount)) return '—';

  return `฿${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

}



export function describeCashbookListPrintFilters(
  searchTerm: string,
  monthYyyyMm: string,
  directionFilter: 'IN' | 'OUT' | 'BOTH' = 'BOTH',
  bankAccountCode?: string,
): string[] {

  const lines: string[] = [];

  if (monthYyyyMm.trim()) {

    lines.push(`เดือน: ${formatPayrollYearMonthThaiBE(monthYyyyMm)} (${monthYyyyMm})`);

  }

  if (directionFilter !== 'BOTH') {

    lines.push(`ทิศทาง: ${directionFilter === 'IN' ? 'รายรับ' : 'รายจ่าย'}`);

  }

  if (bankAccountCode?.trim()) {

    lines.push(`บัญชี: ${bankAccountCode.trim()}`);

  }

  if (searchTerm.trim()) {

    lines.push(`ค้นหา: "${searchTerm.trim()}"`);

  }

  return lines;

}



const CBL_PRINT_STYLES = `

  @page { size: A4 landscape; margin: 8mm; }

  .cbl-wrap {

    font-family: Sarabun, sans-serif;

    font-size: 10pt;

    color: #111;

    width: 100%;

    max-width: 100%;

  }

  .cbl-head-row {

    display: flex;

    align-items: baseline;

    justify-content: space-between;

    gap: 10px;

    margin-bottom: 6px;

  }

  .cbl-head-left { flex: 1 1 58%; min-width: 0; }

  .cbl-head-right {

    flex: 0 1 42%;

    margin: 0;

    font-size: 9pt;

    color: #555;

    text-align: right;

    word-wrap: break-word;

    overflow-wrap: anywhere;

  }

  .cbl-title { font-size: 16pt; font-weight: 800; margin: 0; color: #0f3d5c; }

  .cbl-scope { font-weight: 700; margin: 0; }

  .cbl-totals {

    display: grid;

    grid-template-columns: repeat(3, minmax(0, 1fr));

    gap: 8px;

    margin-bottom: 10px;

    font-size: 9pt;

  }

  .cbl-total-box { border: 1px solid #ccc; padding: 6px 10px; border-radius: 4px; min-width: 0; }

  .cbl-total-box strong { display: block; font-size: 11pt; margin-top: 2px; }

  .cbl-total-in strong { color: #15803d; }

  .cbl-total-out strong { color: #dc2626; }

  .cbl-total-net strong { color: #0f3d5c; }

  .cbl-filters { margin: 0 0 8px; padding-left: 18px; font-size: 9pt; color: #333; }

  .cbl-table {

    width: 100%;

    max-width: 100%;

    border-collapse: collapse;

    font-size: 9pt;

    table-layout: fixed;

  }

  .cbl-table th, .cbl-table td {

    border: 1px solid #ccc;

    padding: 5px 6px;

    vertical-align: top;

    word-wrap: break-word;

    overflow-wrap: anywhere;

    line-height: 1.25;

  }

  .cbl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }

  .cbl-num { text-align: right; font-weight: 700; white-space: nowrap; }

  .cbl-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; }

  .cbl-date { white-space: nowrap; font-size: 8.5pt; color: #444; }

  .cbl-sub { font-size: 8pt; color: #666; }

  .cbl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }

  .cbl-foot { margin-top: 4px; font-size: 8pt; color: #666; }

  @media print {
    .cbl-wrap { overflow: visible !important; }
    .cbl-title { font-size: 14pt; }
    .cbl-totals { gap: 6px; margin-bottom: 8px; }
    .cbl-table { font-size: 8.5pt; }
    .sd-list-report.cbl-wrap .cbl-table th,
    .sd-list-report.cbl-wrap .cbl-table td {
      padding: 5px 6px;
      line-height: 1.38;
    }
    .cbl-mono { font-size: 8pt; }
    .cbl-date, .cbl-sub { font-size: 7.5pt; }
  }

`;



function buildCblFilterBlock(filterLines: string[]): {

  filterBlock: string;

  periodLine?: string;

  scopeRightNote?: string;

} {

  const periodLine = filterLines.find((l) => l.startsWith('เดือน:'));

  const otherFilterLines = filterLines.filter((l) => !l.startsWith('เดือน:'));

  const filterBlock =

    otherFilterLines.length > 0

      ? `<ul class="cbl-filters">${otherFilterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`

      : '';

  const scopeRightNote =

    !periodLine && filterLines.length === 0 ? 'ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล' : undefined;

  return { filterBlock, periodLine, scopeRightNote };

}



function buildCblHeader(params: {

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

  <div class="cbl-head-row">

    <h1 class="cbl-title cbl-head-left">รายรับรายจ่าย (Cashbook)</h1>

    <p class="cbl-head-right">${printedMeta}</p>

  </div>

  <div class="cbl-head-row">

    <p class="cbl-scope cbl-head-left">${escapeHtmlDoc(params.scopeTitle)} — ${params.rowCount} รายการ</p>

    ${scopeRight ? `<p class="cbl-head-right">${escapeHtmlDoc(scopeRight)}</p>` : '<span class="cbl-head-right" aria-hidden="true"></span>'}

  </div>

  ${params.filterBlock}`;

}



export function buildCashbookListPrintHtml(params: {

  rows: CashbookListPrintRow[];

  scopeTitle: string;

  filterLines: string[];

  pnlInLabel: string;

  pnlOutLabel: string;

  netLabel: string;

  generatedAt: string;

  printedBy?: string;

  truncated?: boolean;

}): string {

  const {

    rows,

    scopeTitle,

    filterLines,

    pnlInLabel,

    pnlOutLabel,

    netLabel,

    generatedAt,

    printedBy,

    truncated,

  } = params;



  const { filterBlock, periodLine, scopeRightNote } = buildCblFilterBlock(filterLines);



  const tableRows =

    rows.length === 0

      ? '<tr><td colspan="6" class="cbl-empty">ไม่มีรายการ</td></tr>'

      : rows

          .map(

            (r) => `<tr>

              <td class="cbl-mono">${escapeHtmlDoc(r.entryNo)} <span class="cbl-date">${escapeHtmlDoc(r.entryDate)}</span></td>

              <td>${escapeHtmlDoc(r.description)} <span class="cbl-sub">(${escapeHtmlDoc(r.entryType)})</span></td>

              <td>${escapeHtmlDoc(r.bankLabel)}</td>

              <td>${escapeHtmlDoc(r.paymentMethod)}</td>

              <td class="cbl-num">${escapeHtmlDoc(r.inLabel)}</td>

              <td class="cbl-num">${escapeHtmlDoc(r.outLabel)}</td>

            </tr>`,

          )

          .join('');



  const truncateNote = truncated

    ? `<p class="cbl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองเพื่อแยกชุดข้อมูล</p>`

    : '';



  return `

<style>${CBL_PRINT_STYLES}</style>

<div class="sd-list-report cbl-wrap">

  ${buildCblHeader({

    scopeTitle,

    rowCount: rows.length,

    generatedAt,

    printedBy,

    periodLine,

    scopeRightNote,

    filterBlock,

  })}

  <div class="cbl-totals">

    <div class="cbl-total-box cbl-total-in">รายรับ (งบ)<strong>${escapeHtmlDoc(pnlInLabel)}</strong></div>

    <div class="cbl-total-box cbl-total-out">รายจ่าย (งบ)<strong>${escapeHtmlDoc(pnlOutLabel)}</strong></div>

    <div class="cbl-total-box cbl-total-net">สุทธิ (งบ)<strong>${escapeHtmlDoc(netLabel)}</strong></div>

  </div>

  <table class="cbl-table">

    <colgroup>

      <col style="width:15%" />

      <col style="width:32%" />

      <col style="width:12%" />

      <col style="width:10%" />

      <col style="width:15%" />

      <col style="width:16%" />

    </colgroup>

    <thead>

      <tr>

        <th>เลขที่ / วันที่</th>

        <th>รายละเอียด</th>

        <th>บัญชีธนาคาร</th>

        <th>วิธีชำระ</th>

        <th class="cbl-num">เงินเข้า</th>

        <th class="cbl-num">เงินออก</th>

      </tr>

    </thead>

    <tbody>${tableRows}</tbody>

  </table>

  ${truncateNote}

  <p class="cbl-foot">OPEC OpsFlow — รายรับรายจ่าย (Cashbook)</p>

</div>`;

}



export function capCashbookListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {

  if (rows.length <= PRINT_ROW_LIMIT) {

    return { rows, truncated: false };

  }

  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };

}



export function buildCashbookListPrintRow(

  entry: {

    entryNo?: string;

    id: string;

    entryDate?: string;

    description?: string;

    entryType?: string;

    direction: 'IN' | 'OUT';

    amount: number;

    paymentMethod?: string;

  },

  bankLabel: string,

): CashbookListPrintRow {

  const amt = Number(entry.amount);

  const safeAmt = Number.isFinite(amt) ? amt : 0;

  return {

    entryNo: entry.entryNo?.trim() || entry.id.slice(0, 8),

    entryDate: entry.entryDate || '—',

    description: entry.description?.trim() || '—',

    entryType: entry.entryType || 'OTHER',

    bankLabel: bankLabel || '—',

    paymentMethod: entry.paymentMethod || '—',

    inLabel: entry.direction === 'IN' ? fmtBahtPrint(safeAmt) : '—',

    outLabel: entry.direction === 'OUT' ? fmtBahtPrint(safeAmt) : '—',

  };

}



export function fmtCashbookPrintBaht(amount: number): string {

  return fmtBahtPrint(amount);

}


