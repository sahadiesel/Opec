/**
 * รูปแบบพิมพ์มาตรฐานเดียวกันสำหรับ PO / ใบเสนอราคา / ใบกำกับ / ใบแจ้งหนี้ ฯลฯ
 * คลาส CSS ใช้ prefix sd- (standard document) — เอกสารอื่นในระบบควร reuse สไตล์ชุดนี้
 */

import type { Purchase, PurchaseLine, PurchasePaymentMilestone, Vendor } from '@/lib/types';
import { formatDateThaiBE, formatDateTimeThaiBE } from '@/lib/date-thai';
import { amountToThaiBahtText } from '@/lib/documents/thai-baht-text';

export type CompanyProfilePrint = {
  companyNameTh?: string;
  companyNameEn?: string;
  taxId?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
};

export function escapeHtmlDoc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** สี teal หลัก — ให้สอดคล้องธีมเอกสารเรียบ (ใกล้เคียงตัวอย่างใบกำกับ) */
const ACCENT = '#0d9488';

export const STANDARD_DOCUMENT_PRINT_CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: 'Sarabun', 'Prompt', system-ui, -apple-system, sans-serif;
    color: #171717;
    margin: 0;
    padding: 6mm 14mm 22mm 14mm;
    font-size: 11pt;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sd-page { max-width: 21cm; margin: 0 auto; position: relative; min-height: 0; }
  .sd-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding-bottom: 8px;
    border-bottom: 2px solid ${ACCENT};
    margin-bottom: 12px;
  }
  .sd-company-name { font-weight: 800; font-size: 13pt; margin: 0 0 4px 0; }
  .sd-company-line { margin: 0; color: #404040; font-size: 9.5pt; }
  .sd-doc-title {
    margin: 0;
    font-size: 18pt;
    font-weight: 800;
    color: ${ACCENT};
    text-align: right;
    line-height: 1.2;
  }
  .sd-meta-row { margin-top: 4px; font-size: 10pt; text-align: right; }
  .sd-meta-row strong { font-weight: 700; }
  .sd-party {
    border: 1px solid #d4d4d8;
    border-radius: 4px;
    padding: 10px 12px;
    margin-bottom: 16px;
  }
  .sd-party-label {
    margin: 0 0 6px 0;
    font-size: 10pt;
    font-weight: 700;
    color: ${ACCENT};
  }
  .sd-party-name { margin: 0; font-weight: 700; font-size: 11pt; }
  .sd-party-line { margin: 4px 0 0 0; font-size: 9.5pt; color: #404040; white-space: pre-wrap; }
  .sd-table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  .sd-table th {
    background: #f4f4f5;
    border: 1px solid #d4d4d8;
    padding: 8px 6px;
    font-size: 9.5pt;
    font-weight: 700;
    text-align: left;
  }
  .sd-table th.sd-num, .sd-table td.sd-num { text-align: center; width: 36px; }
  .sd-table th.sd-right, .sd-table td.sd-right { text-align: right; }
  .sd-table td {
    border: 1px solid #e4e4e7;
    padding: 8px 6px;
    font-size: 10pt;
    vertical-align: top;
  }
  .sd-totals-wrap { display: flex; justify-content: flex-end; margin-top: 8px; }
  .sd-totals { width: 280px; font-size: 10pt; }
  .sd-totals-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f4f4f5; }
  .sd-totals-row.sd-grand { border-bottom: none; margin-top: 6px; padding-top: 8px; }
  .sd-totals-row.sd-grand .sd-total-label { font-weight: 800; }
  .sd-totals-row.sd-grand .sd-total-val {
    font-weight: 800;
    font-size: 14pt;
    color: ${ACCENT};
  }
  .sd-amount-words {
    text-align: right;
    font-size: 9pt;
    color: #525252;
    margin-top: 6px;
    font-style: italic;
  }
  .sd-section-title {
    margin: 20px 0 8px 0;
    font-size: 10.5pt;
    font-weight: 800;
    color: #262626;
  }
  .sd-terms { margin: 0; padding-left: 18px; font-size: 9.5pt; color: #404040; }
  .sd-terms li { margin-bottom: 4px; }
  .sd-notes { font-size: 9.5pt; color: #404040; margin-top: 10px; }
  .sd-wht { font-size: 9.5pt; color: #404040; margin-top: 8px; }
  .sd-signatures {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 48px;
    margin-top: 36px;
    padding-top: 16px;
    border-top: 1px solid #e4e4e7;
  }
  .sd-sign-block { text-align: center; }
  .sd-sign-line {
    border-top: 1px dotted #737373;
    margin: 48px 12px 8px 12px;
    height: 0;
  }
  .sd-sign-role { font-size: 9pt; color: #525252; margin: 0; }
  .sd-sign-name { font-size: 10.5pt; font-weight: 700; margin: 4px 0 0 0; }
  .sd-approval-notice {
    margin-top: 14px;
    font-size: 9pt;
    color: #404040;
    text-align: center;
    line-height: 1.4;
  }
  .sd-doc-footer-ref {
    margin-top: 14px;
    font-size: 9.5pt;
    text-align: center;
    color: #262626;
  }
  .sd-purchase-type-line {
    margin: 0 0 8px 0;
    font-size: 9.5pt;
    color: #404040;
  }
  .sd-print-stamp {
    position: fixed;
    left: 10mm;
    bottom: 6mm;
    font-size: 8pt;
    color: #737373;
    z-index: 2;
    line-height: 1.3;
  }
`;

function purchaseTypeTh(t: string | undefined): string {
  if (t === 'CASH') return 'เงินสด';
  if (t === 'CREDIT') return 'เครดิต';
  return t ? String(t) : '—';
}

/**
 * เงื่อนไขการซื้อในระบบ = ฟิลด์ purchaseType บน PO (เงินสด / เครดิต)
 * รายละเอียดงวดชำระจริงอยู่ในแผนงวดด้านล่าง — ไม่ซ้ำแสดงที่หัวเอกสาร
 */
export function buildPurchaseOrderPrintHtml(params: {
  company: CompanyProfilePrint | null | undefined;
  purchase: Purchase;
  vendor: Vendor | null | undefined;
  lines: PurchaseLine[] | null | undefined;
  milestones: PurchasePaymentMilestone[] | null | undefined;
  /** เวลาที่กดพิมพ์ (แสดงเป็นสแตมป์มุมล่างซ้าย) */
  printedAtMs?: number;
}): string {
  const { company, purchase, vendor, lines, milestones, printedAtMs } = params;
  const printedAt = printedAtMs ?? Date.now();
  const cn = company?.companyNameTh || company?.companyNameEn || '—';
  const docDate = formatDateThaiBE(`${purchase.purchaseDate}T12:00:00`);
  const ms = [...(milestones || [])].sort((a, b) => a.sequence - b.sequence);

  const lineRows = (lines || [])
    .map((line, idx) => {
      const desc = escapeHtmlDoc(line.itemDescription || '—');
      const qty = line.quantity.toLocaleString();
      const up = line.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 });
      const am = line.amount.toLocaleString(undefined, { minimumFractionDigits: 2 });
      return `<tr>
        <td class="sd-num">${idx + 1}</td>
        <td>${desc}</td>
        <td class="sd-right">${qty}</td>
        <td class="sd-right">${up}</td>
        <td class="sd-right">${am}</td>
      </tr>`;
    })
    .join('');

  const termsItems = ms
    .map((m) => {
      const due = m.dueDate ? ` (ครบกำหนด ${formatDateThaiBE(`${m.dueDate}T12:00:00`)})` : '';
      return `<li>งวดที่ ${m.sequence}: ${escapeHtmlDoc(m.label)} — ฿${m.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}${due}</li>`;
    })
    .join('');

  const whtLine =
    purchase.supplierWithholdingEnabled && (purchase.supplierWithholdingRatePercent ?? 0) > 0
      ? `<p class="sd-wht"><strong>หัก ณ ที่จ่าย:</strong> อัตรา ${purchase.supplierWithholdingRatePercent}% (คำนวณจากยอดแต่ละงวดชำระตามแผน)</p>`
      : `<p class="sd-wht"><strong>หัก ณ ที่จ่าย:</strong> ไม่มีตามการตั้งค่าเอกสารนี้</p>`;

  const notesBlock = purchase.notes?.trim()
    ? `<p class="sd-notes"><strong>หมายเหตุ:</strong> ${escapeHtmlDoc(purchase.notes.trim())}</p>`
    : '';

  const totalWords = amountToThaiBahtText(purchase.totalAmount);

  const stampLine = escapeHtmlDoc(`พิมพ์เมื่อ ${formatDateTimeThaiBE(printedAt)}`);

  const showElectronicApprovalNotice = ['APPROVED', 'ISSUED', 'COMPLETED'].includes(purchase.status);
  const approvalNotice = showElectronicApprovalNotice
    ? `<p class="sd-approval-notice">เอกสารผ่านการอนุมัติด้วยระบบอิเล็กทรอนิกส์</p>`
    : '';

  return `
<div class="sd-page">
  <div class="sd-print-stamp">${stampLine}</div>
  <header class="sd-header">
    <div>
      <p class="sd-company-name">${escapeHtmlDoc(cn)}</p>
      ${company?.addressLine1 ? `<p class="sd-company-line">${escapeHtmlDoc(company.addressLine1)}</p>` : ''}
      ${company?.addressLine2 ? `<p class="sd-company-line">${escapeHtmlDoc(company.addressLine2)}</p>` : ''}
      ${company?.phone ? `<p class="sd-company-line">โทร. ${escapeHtmlDoc(company.phone)}</p>` : ''}
      ${company?.email ? `<p class="sd-company-line">อีเมล ${escapeHtmlDoc(company.email)}</p>` : ''}
      ${company?.taxId ? `<p class="sd-company-line">เลขประจำตัวผู้เสียภาษี ${escapeHtmlDoc(company.taxId)}</p>` : ''}
    </div>
    <div>
      <h1 class="sd-doc-title">ใบสั่งซื้อ</h1>
      <p class="sd-meta-row"><strong>วันที่เอกสาร</strong> ${escapeHtmlDoc(docDate)}</p>
    </div>
  </header>

  <div class="sd-party">
    <p class="sd-party-label">ข้อมูลคู่ค้า / ผู้ขาย</p>
    <p class="sd-party-name">${escapeHtmlDoc(vendor?.vendorName || '—')}</p>
    ${vendor?.address ? `<p class="sd-party-line">${escapeHtmlDoc(vendor.address)}</p>` : ''}
    ${vendor?.phone ? `<p class="sd-party-line">โทร. ${escapeHtmlDoc(vendor.phone)}</p>` : ''}
    ${vendor?.taxId ? `<p class="sd-party-line">เลขประจำตัวผู้เสียภาษี ${escapeHtmlDoc(vendor.taxId)}</p>` : ''}
  </div>

  <table class="sd-table">
    <thead>
      <tr>
        <th class="sd-num">#</th>
        <th>รายการ</th>
        <th class="sd-right">จำนวน</th>
        <th class="sd-right">ราคา/หน่วย</th>
        <th class="sd-right">รวมเงิน</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows || '<tr><td colspan="5" style="text-align:center;color:#737373">ไม่มีรายการ</td></tr>'}
    </tbody>
  </table>

  <div class="sd-totals-wrap">
    <div class="sd-totals">
      <div class="sd-totals-row">
        <span>รวมเป็นเงิน</span>
        <span>${purchase.amountBeforeTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
      </div>
      <div class="sd-totals-row">
        <span>ภาษีมูลค่าเพิ่ม 7%</span>
        <span>${purchase.vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
      </div>
      <div class="sd-totals-row sd-grand">
        <span class="sd-total-label">ยอดสุทธิรวม</span>
        <span class="sd-total-val">฿ ${purchase.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
      </div>
      <p class="sd-amount-words">${escapeHtmlDoc(totalWords)}</p>
    </div>
  </div>

  <h2 class="sd-section-title">เงื่อนไขการชำระเงิน</h2>
  <p class="sd-purchase-type-line"><strong>เงื่อนไขการซื้อ:</strong> ${escapeHtmlDoc(purchaseTypeTh(purchase.purchaseType))}</p>
  ${ms.length ? `<ol class="sd-terms">${termsItems}</ol>` : '<p class="sd-notes" style="margin-top:0">— ยังไม่มีแผนงวดในระบบ —</p>'}
  ${whtLine}
  ${notesBlock}

  <p class="sd-doc-footer-ref"><strong>เลขที่เอกสาร</strong> ${escapeHtmlDoc(purchase.purchaseNo)}</p>

  <div class="sd-signatures">
    <div class="sd-sign-block">
      <div class="sd-sign-line"></div>
      <p class="sd-sign-role">ผู้จัดทำเอกสาร (จัดซื้อ)</p>
      <p class="sd-sign-name">${escapeHtmlDoc(purchase.createdByName || '—')}</p>
    </div>
    <div class="sd-sign-block">
      <div class="sd-sign-line"></div>
      <p class="sd-sign-role">ผู้อนุมัติ (ผู้จัดการปฏิบัติการ)</p>
      <p class="sd-sign-name">${escapeHtmlDoc(purchase.approvalDecisionByName || '—')}</p>
    </div>
  </div>

  ${approvalNotice}
</div>
`;
}

export function wrapStandardPrintDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="th"><head>
    <meta charset="utf-8"/>
    <title>${escapeHtmlDoc(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com"/>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap" rel="stylesheet"/>
    <style>${STANDARD_DOCUMENT_PRINT_CSS}</style>
  </head><body>${bodyHtml}</body></html>`;
}
