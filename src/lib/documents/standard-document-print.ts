/**
 * มาตรฐานรูปแบบพิมพ์เอกสาร (Standard Document Print)
 * =====================================================
 * ทุกประเภทเอกสารที่ออกจากระบบควรใช้ชุดเดียวกันนี้:
 * - คลาส CSS prefix `sd-` จาก `STANDARD_DOCUMENT_PRINT_CSS`
 * - ฟังก์ชันประกอบ `buildStandard*` / `wrapStandardPrintDocument` / `escapeHtmlDoc`
 *
 * ประเภทที่ให้ยึดรูปแบบนี้ (อ้างอิง PO เป็นต้นแบบ):
 * - ใบสั่งซื้อ (Purchase Order) — ใช้แล้ว: `buildPurchaseOrderPrintHtml`
 * - ใบเสนอราคา (Quotation)
 * - ใบแจ้งหนี้ร่าง / ใบแจ้งหนี้ (Draft Invoice / Invoice)
 * - ใบกำกับภาษี / ใบเสร็จ (Tax Invoice / Receipt)
 * - ใบบันทึกเวลา (Timesheet) และเอกสารทางการค้าอื่นที่เพิ่มในอนาคต
 *
 * หลักการเลย์เอาต์:
 * - หัว: บริษัทซ้าย | ชื่อเอกสารไทย + ชื่ออังกฤษ (ถ้ามี) + meta ขวา (วันที่, เลขที่)
 * - กล่องคู่ค้า/ลูกค้า → ตารางรายการ → ยอดรวม + จำนวนเงินเป็นตัวอักษรไทย
 * - เนื้อหาเพิ่มเติมตามประเภทเอกสาร (เงื่อนไขชำระ ฯลฯ) ต่อท้ายแบบไหลธรรมชาติ ไม่ดันลายเซ็นไปชิดขอบล่างแบบ flex/min-height เต็มหน้า
 * - ฟุตเตอร์ลายเซ็น: `sd-sign-footer` มี break-inside: avoid
 * - สแตมป์เวลาพิมพ์มุมล่างซ้าย
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

/** แถว meta คอลัมน์ขวาใต้ชื่อเอกสาร (เช่น วันที่เอกสาร, เลขที่เอกสาร) */
export type StandardDocMetaRow = { label: string; value: string };

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
    padding: 6mm 14mm 26mm 14mm;
    font-size: 11pt;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sd-page {
    max-width: 21cm;
    margin: 0 auto;
    position: relative;
  }
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
  .sd-doc-title-en {
    display: block;
    margin-top: 4px;
    font-size: 12pt;
    font-weight: 600;
    color: #525252;
    text-align: right;
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
  .sd-table thead { display: table-header-group; }
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
  .sd-sign-footer {
    margin-top: 10mm;
    margin-bottom: 4mm;
    padding-top: 5mm;
    border-top: 1px solid #e4e4e7;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .sd-signatures {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 48px;
    margin-top: 0;
    padding-top: 0;
    border-top: none;
    break-inside: avoid;
    page-break-inside: avoid;
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
    margin-top: 12px;
    font-size: 9pt;
    color: #404040;
    text-align: center;
    line-height: 1.4;
    padding-bottom: 2mm;
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
    max-width: 42%;
    font-size: 8pt;
    color: #737373;
    z-index: 2;
    line-height: 1.3;
  }
`;

/** คอลัมน์ซ้าย: ชื่อและที่อยู่บริษัท (มาตรฐานทุกเอกสาร) */
export function buildStandardCompanyColumnHtml(company: CompanyProfilePrint | null | undefined): string {
  const cn = company?.companyNameTh || company?.companyNameEn || '—';
  return `<div>
      <p class="sd-company-name">${escapeHtmlDoc(cn)}</p>
      ${company?.addressLine1 ? `<p class="sd-company-line">${escapeHtmlDoc(company.addressLine1)}</p>` : ''}
      ${company?.addressLine2 ? `<p class="sd-company-line">${escapeHtmlDoc(company.addressLine2)}</p>` : ''}
      ${company?.phone ? `<p class="sd-company-line">โทร. ${escapeHtmlDoc(company.phone)}</p>` : ''}
      ${company?.email ? `<p class="sd-company-line">อีเมล ${escapeHtmlDoc(company.email)}</p>` : ''}
      ${company?.taxId ? `<p class="sd-company-line">เลขประจำตัวผู้เสียภาษี ${escapeHtmlDoc(company.taxId)}</p>` : ''}
    </div>`;
}

/** คอลัมน์ขวา: ชื่อเอกสารไทย + อังกฤษ (ถ้ามี) + แถว meta */
export function buildStandardTitleColumnHtml(params: {
  documentTitleTh: string;
  documentTitleEn?: string;
  metaRows: StandardDocMetaRow[];
}): string {
  const en = params.documentTitleEn?.trim()
    ? `<span class="sd-doc-title-en">${escapeHtmlDoc(params.documentTitleEn.trim())}</span>`
    : '';
  const rows = params.metaRows
    .map(
      (r) =>
        `<p class="sd-meta-row"><strong>${escapeHtmlDoc(r.label)}</strong> ${escapeHtmlDoc(r.value)}</p>`
    )
    .join('');
  return `<div>
      <h1 class="sd-doc-title">${escapeHtmlDoc(params.documentTitleTh)}${en}</h1>
      ${rows}
    </div>`;
}

/** `<header class="sd-header">` ครบสองคอลัมน์ */
export function buildStandardDocumentHeaderHtml(params: {
  company: CompanyProfilePrint | null | undefined;
  documentTitleTh: string;
  documentTitleEn?: string;
  metaRows: StandardDocMetaRow[];
}): string {
  return `<header class="sd-header">
    ${buildStandardCompanyColumnHtml(params.company)}
    ${buildStandardTitleColumnHtml({
      documentTitleTh: params.documentTitleTh,
      documentTitleEn: params.documentTitleEn,
      metaRows: params.metaRows,
    })}
  </header>`;
}

/** กล่องข้อมูลคู่ค้า / ลูกค้า */
export function buildStandardPartyBoxHtml(params: {
  boxLabel: string;
  partyName: string;
  detailLines?: string[];
}): string {
  const lines = (params.detailLines || [])
    .filter((x) => x.trim())
    .map((line) => `<p class="sd-party-line">${escapeHtmlDoc(line)}</p>`)
    .join('');
  return `<div class="sd-party">
    <p class="sd-party-label">${escapeHtmlDoc(params.boxLabel)}</p>
    <p class="sd-party-name">${escapeHtmlDoc(params.partyName || '—')}</p>
    ${lines}
  </div>`;
}

/** สแตมป์เวลาพิมพ์ (มุมล่างซ้าย — ใส่ใน `.sd-page`) */
export function buildStandardPrintStampHtml(printedAtMs?: number): string {
  const at = printedAtMs ?? Date.now();
  const line = escapeHtmlDoc(`พิมพ์เมื่อ ${formatDateTimeThaiBE(at)}`);
  return `<div class="sd-print-stamp">${line}</div>`;
}

/** บล็อกยอดรวมขวาล่าง (แถวธรรมดา + แถวยอดสุทธิ teal + ตัวอักษรเงินไทย) */
export type StandardTotalsRow = { label: string; value: string; grand?: boolean };

export function buildStandardTotalsBlockHtml(params: {
  rows: StandardTotalsRow[];
  /** จาก amountToThaiBahtText แล้ว */
  amountInWords?: string;
}): string {
  const body = params.rows
    .map((r) => {
      const cls = r.grand ? 'sd-totals-row sd-grand' : 'sd-totals-row';
      const lab = r.grand
        ? `<span class="sd-total-label">${escapeHtmlDoc(r.label)}</span>`
        : `<span>${escapeHtmlDoc(r.label)}</span>`;
      const val = r.grand
        ? `<span class="sd-total-val">${escapeHtmlDoc(r.value)}</span>`
        : `<span>${escapeHtmlDoc(r.value)}</span>`;
      return `<div class="${cls}">${lab}${val}</div>`;
    })
    .join('');
  const w = params.amountInWords?.trim();
  const words = w ? `<p class="sd-amount-words">${escapeHtmlDoc(w)}</p>` : '';
  return `<div class="sd-totals-wrap">
    <div class="sd-totals">
      ${body}
      ${words}
    </div>
  </div>`;
}

/** ฟุตเตอร์ลายเซ็นสองฝั่ง + ข้อความกลาง (ถ้ามี) — ห้ามแยกออกจาก sd-sign-footer เมื่อแบ่งหน้า */
export function buildStandardSignFooterHtml(params: {
  left: { roleLine: string; name: string };
  right: { roleLine: string; name: string };
  belowHtml?: string;
}): string {
  const below = params.belowHtml ?? '';
  return `<footer class="sd-sign-footer">
  <div class="sd-signatures">
    <div class="sd-sign-block">
      <div class="sd-sign-line"></div>
      <p class="sd-sign-role">${escapeHtmlDoc(params.left.roleLine)}</p>
      <p class="sd-sign-name">${escapeHtmlDoc(params.left.name || '—')}</p>
    </div>
    <div class="sd-sign-block">
      <div class="sd-sign-line"></div>
      <p class="sd-sign-role">${escapeHtmlDoc(params.right.roleLine)}</p>
      <p class="sd-sign-name">${escapeHtmlDoc(params.right.name || '—')}</p>
    </div>
  </div>
  ${below}
  </footer>`;
}

/**
 * ห่อเนื้อหาในหน้าเดียว: สแตมป์ + header + main + footer
 * ใช้เมื่อสร้างเอกสารประเภทใหม่ — ส่ง `mainHtml` เป็นตาราง/ยอด/เงื่อนไขของแต่ละชนิด
 */
export function assembleStandardPrintPageHtml(params: {
  printedAtMs?: number;
  headerHtml: string;
  mainHtml: string;
  footerHtml: string;
}): string {
  return `
<div class="sd-page">
  ${buildStandardPrintStampHtml(params.printedAtMs)}
  ${params.headerHtml}
  ${params.mainHtml}
  ${params.footerHtml}
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

function purchaseTypeTh(t: string | undefined): string {
  if (t === 'CASH') return 'เงินสด';
  if (t === 'CREDIT') return 'เครดิต';
  return t ? String(t) : '—';
}

/**
 * ใบสั่งซื้อ — ประกอบจากบล็อกมาตรฐาน (อ้างอิงสำหรับเอกสารอื่น)
 */
export function buildPurchaseOrderPrintHtml(params: {
  company: CompanyProfilePrint | null | undefined;
  purchase: Purchase;
  vendor: Vendor | null | undefined;
  lines: PurchaseLine[] | null | undefined;
  milestones: PurchasePaymentMilestone[] | null | undefined;
  printedAtMs?: number;
}): string {
  const { company, purchase, vendor, lines, milestones, printedAtMs } = params;
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

  const showElectronicApprovalNotice = ['APPROVED', 'ISSUED', 'COMPLETED'].includes(purchase.status);
  const approvalNotice = showElectronicApprovalNotice
    ? `<p class="sd-approval-notice">เอกสารผ่านการอนุมัติด้วยระบบอิเล็กทรอนิกส์</p>`
    : '';

  const headerHtml = buildStandardDocumentHeaderHtml({
    company,
    documentTitleTh: 'ใบสั่งซื้อ',
    documentTitleEn: 'Purchase Order',
    metaRows: [
      { label: 'วันที่เอกสาร', value: docDate },
      { label: 'เลขที่เอกสาร', value: purchase.purchaseNo },
    ],
  });

  const partyHtml = buildStandardPartyBoxHtml({
    boxLabel: 'ข้อมูลคู่ค้า / ผู้ขาย',
    partyName: vendor?.vendorName || '—',
    detailLines: [
      ...(vendor?.address ? [vendor.address] : []),
      ...(vendor?.phone ? [`โทร. ${vendor.phone}`] : []),
      ...(vendor?.taxId ? [`เลขประจำตัวผู้เสียภาษี ${vendor.taxId}`] : []),
    ],
  });

  const tableHtml = `<table class="sd-table">
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
  </table>`;

  const totalsHtml = buildStandardTotalsBlockHtml({
    rows: [
      { label: 'รวมเป็นเงิน', value: purchase.amountBeforeTax.toLocaleString(undefined, { minimumFractionDigits: 2 }) },
      { label: 'ภาษีมูลค่าเพิ่ม 7%', value: purchase.vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 }) },
      {
        label: 'ยอดสุทธิรวม',
        value: `฿ ${purchase.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
        grand: true,
      },
    ],
    amountInWords: totalWords,
  });

  const mainHtml = `${partyHtml}
  ${tableHtml}
  ${totalsHtml}
  <h2 class="sd-section-title">เงื่อนไขการชำระเงิน</h2>
  <p class="sd-purchase-type-line"><strong>เงื่อนไขการซื้อ:</strong> ${escapeHtmlDoc(purchaseTypeTh(purchase.purchaseType))}</p>
  ${ms.length ? `<ol class="sd-terms">${termsItems}</ol>` : '<p class="sd-notes" style="margin-top:0">— ยังไม่มีแผนงวดในระบบ —</p>'}
  ${whtLine}
  ${notesBlock}`;

  const footerHtml = buildStandardSignFooterHtml({
    left: { roleLine: 'ผู้จัดทำเอกสาร (จัดซื้อ)', name: purchase.createdByName || '—' },
    right: { roleLine: 'ผู้อนุมัติ (ผู้จัดการปฏิบัติการ)', name: purchase.approvalDecisionByName || '—' },
    belowHtml: approvalNotice,
  });

  return assembleStandardPrintPageHtml({
    printedAtMs,
    headerHtml,
    mainHtml,
    footerHtml,
  });
}
