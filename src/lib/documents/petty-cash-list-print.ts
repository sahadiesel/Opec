import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type PettyCashListPrintRow = {
  entryDate: string;
  entryNo: string;
  description: string;
  entryType: string;
  sourceLabel: string;
  inLabel: string;
  outLabel: string;
  balanceLabel: string;
};

function fmtBaht(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  return `฿${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPettyCashPrintBaht(amount: number): string {
  return fmtBaht(amount);
}

const PC_PRINT_STYLES = `
  @page { size: A4 landscape; margin: 10mm; }
  .pc-wrap {
    font-family: Sarabun, sans-serif;
    font-size: 10pt;
    color: #111;
    width: 100%;
  }
  .pc-title { font-size: 16pt; font-weight: 700; margin: 0 0 2px; }
  .pc-sub { font-size: 10pt; color: #444; margin: 0 0 8px; }
  .pc-meta { font-size: 9pt; color: #555; margin: 0 0 10px; }
  .pc-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 20px;
    margin: 0 0 10px;
    padding: 8px 10px;
    border: 1px solid #ccc;
    background: #f7f7f7;
  }
  .pc-summary strong { font-variant-numeric: tabular-nums; }
  table.pc-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .pc-table th, .pc-table td {
    border: 1px solid #bbb;
    padding: 4px 6px;
    vertical-align: top;
  }
  .pc-table th {
    background: #e8e8e8;
    font-size: 9pt;
    text-align: center;
  }
  .pc-table td.pc-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pc-table td.pc-center { text-align: center; }
  .pc-mono { font-family: ui-monospace, monospace; font-size: 9pt; }
  .pc-subline { display: block; font-size: 8.5pt; color: #555; margin-top: 1px; }
  .pc-open { background: #f0f0f0; font-weight: 600; }
  .pc-foot { margin-top: 8px; font-size: 8.5pt; color: #666; }
`;

export function buildPettyCashListPrintHtml(params: {
  accountCode: string;
  accountName: string;
  monthLabel: string;
  monthYm: string;
  openingBalanceLabel: string;
  broughtForwardLabel: string;
  totalInLabel: string;
  totalOutLabel: string;
  netLabel: string;
  closingBalanceLabel: string;
  rows: PettyCashListPrintRow[];
  generatedAt: string;
  printedBy?: string;
}): string {
  const {
    accountCode,
    accountName,
    monthLabel,
    monthYm,
    openingBalanceLabel,
    broughtForwardLabel,
    totalInLabel,
    totalOutLabel,
    netLabel,
    closingBalanceLabel,
    rows,
    generatedAt,
    printedBy,
  } = params;

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="6" class="pc-center">ไม่มีรายการเคลื่อนไหวในเดือนนี้</td></tr>'
      : rows
          .map(
            (r) => `<tr class="${r.entryNo === '—' ? 'pc-open' : ''}">
              <td class="pc-center">${escapeHtmlDoc(r.entryDate)}</td>
              <td class="pc-mono pc-center">${escapeHtmlDoc(r.entryNo)}</td>
              <td>${escapeHtmlDoc(r.description)}${
                r.entryType
                  ? `<span class="pc-subline">${escapeHtmlDoc(r.sourceLabel)} · ${escapeHtmlDoc(r.entryType)}</span>`
                  : ''
              }</td>
              <td class="pc-num">${escapeHtmlDoc(r.inLabel)}</td>
              <td class="pc-num">${escapeHtmlDoc(r.outLabel)}</td>
              <td class="pc-num">${escapeHtmlDoc(r.balanceLabel)}</td>
            </tr>`,
          )
          .join('');

  return `
<style>${PC_PRINT_STYLES}</style>
<div class="sd-list-report pc-wrap">
  <h1 class="pc-title">รายการเคลื่อนไหว Petty Cash (กองหน้างาน)</h1>
  <p class="pc-sub">${escapeHtmlDoc(accountCode)} — ${escapeHtmlDoc(accountName)}</p>
  <p class="pc-meta">
    เดือน ${escapeHtmlDoc(monthLabel)} (${escapeHtmlDoc(monthYm)}) · พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}
    ${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}
  </p>
  <div class="pc-summary">
    <div>ยอดยกมา: <strong>${escapeHtmlDoc(broughtForwardLabel)}</strong></div>
    <div>รวมรับ: <strong>${escapeHtmlDoc(totalInLabel)}</strong></div>
    <div>รวมจ่าย: <strong>${escapeHtmlDoc(totalOutLabel)}</strong></div>
    <div>สุทธิ: <strong>${escapeHtmlDoc(netLabel)}</strong></div>
    <div>คงเหลือปลายงวด: <strong>${escapeHtmlDoc(closingBalanceLabel)}</strong></div>
    <div>ยอดตั้งต้นกอง: <strong>${escapeHtmlDoc(openingBalanceLabel)}</strong></div>
  </div>
  <table class="pc-table">
    <colgroup>
      <col style="width:9%" />
      <col style="width:14%" />
      <col style="width:41%" />
      <col style="width:12%" />
      <col style="width:12%" />
      <col style="width:12%" />
    </colgroup>
    <thead>
      <tr>
        <th>วันที่</th>
        <th>เลขที่</th>
        <th>รายละเอียด / ประเภท</th>
        <th>รับ (เข้า)</th>
        <th>จ่าย (ออก)</th>
        <th>คงเหลือ</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  <p class="pc-foot">เอกสารสำหรับตรวจสอบกองเงินสดหน้างาน — ไม่ใช่สมุดรายรับ-รายจ่ายฝ่ายบัญชี</p>
</div>`;
}
