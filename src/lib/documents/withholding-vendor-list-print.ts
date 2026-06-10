import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type WithholdingVendorListPrintRow = {
  status: string;
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

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="wvl-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="wvl-muted">ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล</p>';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="8" class="wvl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td>${escapeHtmlDoc(r.status)}</td>
              <td class="wvl-mono">${escapeHtmlDoc(r.certificateNo)}</td>
              <td>${escapeHtmlDoc(r.vendorName)}${r.vendorTaxId ? `<br /><span class="wvl-sub">${escapeHtmlDoc(r.vendorTaxId)}</span>` : ''}</td>
              <td>${escapeHtmlDoc(r.paymentDate)}</td>
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
<style>
  .wvl-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .wvl-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .wvl-meta { font-size: 9pt; color: #555; margin-bottom: 12px; }
  .wvl-scope { font-weight: 700; margin-bottom: 6px; }
  .wvl-totals { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; font-size: 9pt; }
  .wvl-total-box { border: 1px solid #ccc; padding: 8px 12px; border-radius: 4px; min-width: 140px; }
  .wvl-total-box strong { display: block; font-size: 11pt; margin-top: 2px; }
  .wvl-filters { margin: 0 0 12px; padding-left: 18px; font-size: 9pt; color: #333; }
  .wvl-muted { font-size: 9pt; color: #666; margin: 0 0 12px; }
  .wvl-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .wvl-table th, .wvl-table td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }
  .wvl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .wvl-num { text-align: right; font-weight: 700; white-space: nowrap; }
  .wvl-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; }
  .wvl-sub { font-size: 8pt; color: #666; font-family: ui-monospace, monospace; }
  .wvl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .wvl-foot { margin-top: 10px; font-size: 8pt; color: #666; }
</style>
<div class="wvl-wrap">
  <h1 class="wvl-title">รายการหัก ณ ที่จ่าย (คู่ค้า)</h1>
  <p class="wvl-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="wvl-scope">${escapeHtmlDoc(scopeTitle)} — ${rows.length} รายการ</p>
  ${filterBlock}
  <div class="wvl-totals">
    <div class="wvl-total-box">ยอดจ่ายรวม<strong>${escapeHtmlDoc(totalPaidLabel)}</strong></div>
    <div class="wvl-total-box">ยอดหักรวม<strong>${escapeHtmlDoc(totalWithholdingLabel)}</strong></div>
  </div>
  <table class="wvl-table">
    <thead>
      <tr>
        <th>สถานะ</th>
        <th>เลขที่หนังสือ</th>
        <th>คู่ค้า</th>
        <th>วันที่จ่าย</th>
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
