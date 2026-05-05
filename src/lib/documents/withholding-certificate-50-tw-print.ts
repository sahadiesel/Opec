/**
 * พิมพ์แบบฟอร์มหนังสือรับรองการหักภาษี ณ ที่จ่าย (มาตรา 50 ทวิ)
 */

import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import { amountToThaiBahtText } from '@/lib/documents/thai-baht-text';
import { formatDateTimeThaiBE, formatYmdLocalThaiBE } from '@/lib/date-thai';
import type {
  PaymentMethod,
  WithholdingCertificateCopyVariant,
  WithholdingCertificateDocument,
  WhtTaxCondition,
} from '@/lib/types';

/** @deprecated ใช้ snapshot จาก {@link WithholdingCertificateDocument} แทน — เก็บไว้ให้โค้ดเก่าอ้างอิงชื่อฟิลด์ */
export type CompanyProfileForWhtCert = {
  companyNameTh?: string;
  taxId?: string;
  branchType?: 'head_office' | 'branch';
  branchNo?: string;
  addressLine1?: string;
  addressLine2?: string;
};

export interface WithholdingCertificateDocumentPrintOptions {
  copyVariant: WithholdingCertificateCopyVariant;
  /** true = เลขที่จริง (หลัง ISSUED); false = ร่าง/preview */
  official: boolean;
  printedByName: string;
  printedAtMs: number;
  showSignatureImage: boolean;
  showCompanyStamp: boolean;
  showSystemGeneratedNote: boolean;
}

/** ตัวเลือกพิมพ์เมื่อสร้างหลายฉบับในไฟล์เดียว — ไม่มี copyVariant */
export type WithholdingCertificateDocumentPrintBaseOptions = Omit<
  WithholdingCertificateDocumentPrintOptions,
  'copyVariant'
>;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtBaht(n: number): string {
  return roundMoney2(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function copyVariantBannerTh(v: WithholdingCertificateCopyVariant): string {
  switch (v) {
    case 'COPY_PAYEE_TAX_RETURN':
      return 'ฉบับที่ 1 สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบแบบแสดงรายการภาษี';
    case 'COPY_PAYEE_RECORD':
      return 'ฉบับที่ 2 สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน';
    case 'COPY_PAYER_RECORD':
      return 'สำเนาสำหรับผู้หักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน';
    default:
      return '';
  }
}

function paymentMethodTh(m: PaymentMethod): string {
  switch (m) {
    case 'TRANSFER':
      return 'โอนเงิน';
    case 'CASH':
      return 'เงินสด';
    case 'CHEQUE':
      return 'เช็ค';
    default:
      return 'อื่น ๆ';
  }
}

function taxConditionChecks(tc: WhtTaxCondition, otherRemark?: string): string {
  const oth = (otherRemark || '').trim();
  const mk = (on: boolean) => (on ? '☑' : '☐');
  return `
<div class="checkbox-row">${mk(tc === 'WITHHOLDING')} หัก ณ ที่จ่าย</div>
<div class="checkbox-row">${mk(tc === 'TAX_PAID_BY_PAYER_FOREVER')} ออกภาษีให้ตลอดไป</div>
<div class="checkbox-row">${mk(tc === 'TAX_PAID_BY_PAYER_ONE_TIME')} ออกภาษีให้ครั้งเดียว</div>
<div class="checkbox-row">${mk(tc === 'OTHER')} อื่น ๆ: ${escapeHtml(tc === 'OTHER' && oth ? oth : '_____________________________')}</div>`;
}

function incomeTypeCheckboxes(doc: WithholdingCertificateDocument): string {
  const goods = doc.incomeTypeCode === 'GOODS_MANUFACTURING';
  const service = doc.incomeTypeCode === 'SERVICE_CONTRACT';
  const other = doc.incomeTypeCode === 'OTHER';
  return `${goods ? '☑' : '☐'} ค่าจ้างทำของ &nbsp; ${service ? '☑' : '☐'} ค่าจ้างเหมา / ค่าบริการ${
    other ? ` &nbsp; ☑ อื่น ๆ (${escapeHtml(doc.incomeTypeDisplayTh)})` : ''
  }`;
}

function payerTaxpayerTypeTh(t?: string): string {
  if (t === 'PERSON') return 'บุคคลธรรมดา';
  if (t === 'OTHER') return 'อื่น ๆ';
  return 'นิติบุคคล';
}

function payeeCategoryTh(c: WithholdingCertificateDocument['payee']['vendorCategory']): string {
  switch (c) {
    case 'INDIVIDUAL':
      return 'บุคคลธรรมดา';
    case 'FOREIGN':
      return 'คู่ค้าต่างประเทศ';
    case 'OTHER':
      return 'อื่น ๆ';
    default:
      return 'นิติบุคคล (ในประเทศ)';
  }
}

/**
 * สไตล์พิมพ์หนังสือรับรองหัก ณ ที่จ่าย — ลูกจ้าง (Payroll)
 * - หนึ่งหน้า A4: ความสูงพิมพ์ได้ ~279mm (ขอบ 9mm) — ปรับตัวอักษร/ระยะสมดุล + zoom ตอนพิมพ์กันล้นหน้า
 * - โซนเนื้อหาหลัก (.pwht-print-fill) ยืดตาม flex ~80% ความสูงที่เหลือ — ดันลายเซ็น/ฟุตเตอร์ลงล่างเมื่อเนื้อหาสั้น
 */
export function payrollWorkerWhtPrintCss(): string {
  return withholdingCertificatePrintCss(`
    @page { size: A4; margin: 9mm 10mm; }
    html {
      height: 100%;
    }
    body.payroll-wht-print {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-size: 10px;
      line-height: 1.34;
    }
    body.payroll-wht-print .wht-print-page {
      box-sizing: border-box;
      min-height: 279mm;
      display: flex;
      flex-direction: column;
    }
    body.payroll-wht-print .copy-banner {
      padding: 5px 9px;
      margin-bottom: 6px;
      font-size: 10px;
      line-height: 1.32;
      flex-shrink: 0;
    }
    body.payroll-wht-print .doc-top {
      margin-bottom: 10px;
      min-height: 72px;
      flex-shrink: 0;
    }
    body.payroll-wht-print .doc-title-wrap {
      padding: 0 120px;
    }
    body.payroll-wht-print h1 {
      font-size: 13px;
      margin: 0 0 3px;
      line-height: 1.22;
    }
    body.payroll-wht-print .sub {
      font-size: 9.5px;
      margin: 0 0 2px;
      line-height: 1.32;
    }
    body.payroll-wht-print .doc-meta {
      font-size: 9.5px;
      max-width: 210px;
      padding-bottom: 4px;
      line-height: 1.38;
    }
    body.payroll-wht-print .doc-meta div {
      margin-bottom: 3px;
    }
    body.payroll-wht-print .pwht-print-fill {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      min-height: 0;
      max-width: 100%;
    }
    body.payroll-wht-print .pwht-print-fill > .sec:first-child {
      margin-top: 0;
    }
    body.payroll-wht-print .sec {
      margin-top: 8px;
      margin-bottom: 3px;
      font-size: 10.5px;
      padding-bottom: 1px;
      line-height: 1.28;
      break-after: avoid;
      page-break-after: avoid;
    }
    body.payroll-wht-print .sec.pwht-inline-sec {
      margin-top: 0;
      margin-bottom: 3px;
      font-size: 10px;
    }
    body.payroll-wht-print .field {
      margin: 2px 0;
      font-size: 9.75px;
      line-height: 1.36;
    }
    body.payroll-wht-print .muted {
      font-size: 8.75px;
      line-height: 1.32;
    }
    body.payroll-wht-print table.amounts {
      margin: 3px 0 5px;
      font-size: 9.5px;
    }
    body.payroll-wht-print table.amounts td {
      padding: 2px 5px;
      line-height: 1.32;
    }
    body.payroll-wht-print table.amounts tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    body.payroll-wht-print .checkbox-row {
      margin: 2px 0;
      font-size: 9.75px;
      line-height: 1.32;
    }
    body.payroll-wht-print .certify-block {
      margin-top: 6px;
      font-size: 9.75px;
      line-height: 1.4;
    }
    body.payroll-wht-print .sign-grid {
      display: block;
      width: 100%;
      margin-top: 8px;
      flex-shrink: 0;
    }
    body.payroll-wht-print .sign-cell {
      display: block;
      width: 100%;
      padding-right: 0;
      font-size: 9.75px;
      line-height: 1.38;
    }
    body.payroll-wht-print .sign-img {
      max-height: 36px;
      max-width: 160px;
      margin-top: 4px;
    }
    body.payroll-wht-print .pwht-after-sign {
      margin-top: auto;
      padding-top: 10px;
      flex-shrink: 0;
    }
    body.payroll-wht-print .footer-sys {
      margin-top: 6px;
      flex-shrink: 0;
      padding-top: 5px;
      margin-bottom: 0;
      font-size: 8.5px;
      line-height: 1.38;
    }
    body.payroll-wht-print .draft-watermark {
      margin-bottom: 4px;
      font-size: 9.5px;
      line-height: 1.32;
      flex-shrink: 0;
    }
    body.payroll-wht-print .pwht-earn-ded-wrap {
      display: table;
      width: 100%;
      margin-top: 5px;
      table-layout: fixed;
    }
    body.payroll-wht-print .pwht-earn-ded-col {
      display: table-cell;
      width: 50%;
      vertical-align: top;
      padding-right: 7px;
    }
    body.payroll-wht-print .pwht-earn-ded-col:last-child {
      padding-right: 0;
      padding-left: 7px;
    }
    body.payroll-wht-print .pwht-tax-conds {
      display: grid;
      grid-template-columns: 1fr 1fr;
      column-gap: 12px;
      row-gap: 3px;
      margin-top: 5px;
    }
    body.payroll-wht-print .pwht-tax-conds .checkbox-row {
      margin: 0;
    }
    @media print {
      body.payroll-wht-print {
        zoom: 96%;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  `);
}

export function withholdingCertificatePrintCss(extra = ''): string {
  return `
    @page { size: A4; margin: 10mm 12mm; }
    body {
      font-family: 'Sarabun', 'TH Sarabun New', 'Tahoma', sans-serif;
      font-size: 11px;
      line-height: 1.35;
      color: #111;
      margin: 0;
    }
    .copy-banner {
      text-align: center;
      font-weight: bold;
      font-size: 11px;
      border: 1px solid #333;
      padding: 5px 8px;
      margin-bottom: 6px;
      background: #fafafa;
    }
    .doc-top { position: relative; margin-bottom: 20px; min-height: 96px; }
    .doc-title-wrap { text-align: center; padding: 0 175px; }
    h1 { font-size: 14px; margin: 0 0 2px; font-weight: bold; }
    .sub { font-size: 11px; margin: 0; color: #222; }
    .doc-meta {
      position: absolute;
      top: 0;
      right: 0;
      text-align: right;
      font-size: 10.5px;
      line-height: 1.45;
      max-width: 260px;
      padding-bottom: 12px;
    }
    .doc-meta div { margin-bottom: 5px; }
    .doc-top + .sec {
      margin-top: 14px;
    }
    .sec {
      margin-top: 10px;
      font-weight: bold;
      border-bottom: 1px solid #333;
      padding-bottom: 1px;
      margin-bottom: 4px;
      font-size: 11.5px;
    }
    .field { margin: 2px 0 3px; font-size: 10.5px; }
    .muted { color: #444; font-size: 10px; }
    table.amounts { width: 100%; border-collapse: collapse; margin: 4px 0; font-size: 10.5px; }
    table.amounts td { padding: 2px 5px; vertical-align: top; }
    table.amounts td:last-child { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .checkbox-row { margin: 3px 0; font-size: 10.5px; }
    .certify-block { margin-top: 6px; font-size: 10.5px; }
    .sign-grid { display: table; width: 100%; margin-top: 10px; }
    .sign-cell { display: table-cell; width: 50%; vertical-align: top; padding-right: 12px; font-size: 10.5px; }
    .sign-img { max-height: 56px; max-width: 180px; object-fit: contain; margin-top: 4px; }
    .footer-sys {
      margin-top: 10px;
      padding-top: 6px;
      border-top: 1px solid #ddd;
      font-size: 10px;
      color: #333;
      text-align: right;
    }
    .draft-watermark {
      color: #999;
      font-size: 10px;
      text-align: center;
      margin-bottom: 4px;
    }
    .wht-print-page {
      page-break-after: always;
      break-after: page;
    }
    .wht-print-page:last-of-type {
      page-break-after: auto;
      break-after: auto;
    }
    ${extra}
  `;
}

/**
 * เนื้อหาเอกสารหนึ่งหน้า (ฉบับเดียว) — ใช้ร่วมกับหลายหน้าในไฟล์เดียว
 */
function buildWithholdingCertificateBodyHtml(
  doc: WithholdingCertificateDocument,
  opts: WithholdingCertificateDocumentPrintOptions,
): string {
  const cnRaw = (doc.certificateNo || '').trim();
  const cn = escapeHtml(
    opts.official && cnRaw ? cnRaw : cnRaw || '(ฉบับร่าง — ยังไม่ออกเลขที่อย่างเป็นทางการ)',
  );

  const issueDateDisp = formatYmdLocalThaiBE(doc.paymentIssueDate, '____/____/________');
  const payDateDisp = formatYmdLocalThaiBE(doc.paymentDate, '____/____/________');

  const payer = doc.payer;
  const payee = doc.payee;
  const payerIsHead = payer.branchType === 'HEAD_OFFICE';
  const payeeIsHead = payee.branchType === 'HEAD_OFFICE';

  const whtWords = amountToThaiBahtText(doc.withholdingTaxAmount);

  const sigUrl = opts.showSignatureImage ? (doc.signatureImageUrl || '').trim() : '';
  const stampUrl = opts.showCompanyStamp ? (doc.companyStampImageUrl || '').trim() : '';

  const banner = escapeHtml(copyVariantBannerTh(opts.copyVariant));

  return `
${!opts.official ? '<div class="draft-watermark">[ ตัวอย่างก่อนออกเอกสาร — ไม่ใช่หลักฐานทางการ ]</div>' : ''}
<div class="copy-banner">${banner}</div>
<div class="doc-top">
  <div class="doc-title-wrap">
    <h1>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1>
    <p class="sub">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</p>
  </div>
  <div class="doc-meta">
    <div><strong>เลขที่</strong> ${cn}</div>
    <div><strong>วันที่ออกหนังสือรับรอง</strong><br/>${escapeHtml(issueDateDisp)}</div>
    <div><strong>วันที่จ่ายเงิน</strong><br/>${escapeHtml(payDateDisp)}</div>
  </div>
</div>

<div class="sec">1. ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</div>
<div class="field">ชื่อบริษัท/ห้าง: ${escapeHtml(payer.legalNameTh || '—')}</div>
${payer.legalNameEn ? `<div class="field muted">Name (EN): ${escapeHtml(payer.legalNameEn)}</div>` : ''}
<div class="field">เลขประจำตัวผู้เสียภาษี: ${escapeHtml(payer.taxId || '—')}</div>
<div class="field">ประเภทผู้เสียภาษี: ${escapeHtml(payerTaxpayerTypeTh(payer.taxpayerType))}</div>
<div class="field">ที่อยู่ (ภาษาไทย): ${escapeHtml(payer.addressTh || '—')}</div>
${payer.addressEn ? `<div class="field">ที่อยู่ (English): ${escapeHtml(payer.addressEn)}</div>` : ''}
${payer.phone || payer.email ? `<div class="field">โทรศัพท์ / อีเมล: ${escapeHtml([payer.phone, payer.email].filter(Boolean).join(' · ') || '—')}</div>` : ''}
<div class="field">สาขา: ${payerIsHead ? '☑' : '☐'} สำนักงานใหญ่ &nbsp; ${payerIsHead ? '☐' : '☑'} สาขาเลขที่ ${escapeHtml(!payerIsHead && payer.branchNo ? payer.branchNo : '__________')}</div>

<div class="sec">2. ผู้ถูกหักภาษี ณ ที่จ่าย / คู่ค้า / ผู้รับจ้าง</div>
<div class="field">ชื่อบุคคล/บริษัท/ห้าง: ${escapeHtml(payee.displayName || '—')}</div>
<div class="field">เลขประจำตัวผู้เสียภาษี: ${escapeHtml(payee.taxId || '—')}</div>
<div class="field">ประเภทคู่ค้า: ${escapeHtml(payeeCategoryTh(payee.vendorCategory))}${payee.countryCode ? ` · รหัสประเทศ ${escapeHtml(payee.countryCode)}` : ''}</div>
<div class="field">ที่อยู่ (ภาษาไทย): ${escapeHtml(payee.addressTh || '—')}</div>
${payee.addressEn ? `<div class="field">ที่อยู่ (English): ${escapeHtml(payee.addressEn)}</div>` : ''}
<div class="field">สาขา: ${payeeIsHead ? '☑' : '☐'} สำนักงานใหญ่ &nbsp; ${payeeIsHead ? '☐' : '☑'} สาขาเลขที่ ${escapeHtml(!payeeIsHead && payee.branchNo ? payee.branchNo : '__________')}</div>

<div class="sec">3. รายละเอียดการจ่ายเงิน</div>
<div class="field">ประเภทเงินได้: ${incomeTypeCheckboxes(doc)}</div>
<div class="field muted">รหัสภายในระบบ: ${escapeHtml(doc.incomeTypeCode)}${doc.withholdingIncomeCode ? ` · รหัสรายได้ (เตรียมส่งออก): ${escapeHtml(doc.withholdingIncomeCode)}` : ''} · แบบหัก ณ ที่จ่าย: ${escapeHtml(doc.withholdingFormType)}${doc.formTypeCode ? ` · formTypeCode: ${escapeHtml(doc.formTypeCode)}` : ''}</div>
<div class="field">อ้างอิงใบวางบิล/ใบแจ้งหนี้ เลขที่ ${escapeHtml(doc.referenceVendorBillNo || '—')}</div>
${doc.referencePurchaseNo ? `<div class="field">อ้างอิงใบสั่งซื้อ (PO) เลขที่ ${escapeHtml(doc.referencePurchaseNo)}</div>` : ''}
${doc.referenceTaxInvoiceNo ? `<div class="field">อ้างอิงใบกำกับภาษี เลขที่ ${escapeHtml(doc.referenceTaxInvoiceNo)}</div>` : ''}
${doc.referencePaymentNo ? `<div class="field">อ้างอิงการจ่ายเงิน (cashbook) เลขที่ ${escapeHtml(doc.referencePaymentNo)}</div>` : ''}
<div class="field">รายละเอียดงาน / บริการ: ${escapeHtml(doc.jobDescription || '—')}</div>
<div class="field">วิธีชำระเงิน: ${escapeHtml(paymentMethodTh(doc.paymentMethod))}</div>
${doc.bankName ? `<div class="field">ธนาคารที่จ่าย: ${escapeHtml(doc.bankName)}${doc.bankAccountLast4 ? ` (เลขบัญชีปลาย 4 หลัก **${escapeHtml(doc.bankAccountLast4)})` : ''}</div>` : ''}
${doc.sendingBankName && doc.sendingBankName !== doc.bankName ? `<div class="field">ธนาคารผู้โอน (ส่งข้อมูลอิเล็กทรอนิกส์): ${escapeHtml(doc.sendingBankName)}</div>` : ''}
${doc.paymentReferenceNo ? `<div class="field">เลขที่อ้างอิงการชำระเงิน: ${escapeHtml(doc.paymentReferenceNo)}</div>` : ''}

<table class="amounts" aria-label="ยอดเงิน">
  <tr><td>จำนวนเงินค่าจ้างก่อน VAT</td><td>${fmtBaht(doc.amountBeforeVat)} บาท</td></tr>
  <tr><td>VAT 7%</td><td>${fmtBaht(doc.vatAmount)} บาท</td></tr>
  <tr><td><strong>ยอดรวมตามใบแจ้งหนี้ (รวม VAT)</strong></td><td><strong>${fmtBaht(doc.grossAmount)} บาท</strong></td></tr>
  <tr><td>ฐานภาษีหัก ณ ที่จ่าย</td><td>${fmtBaht(doc.withholdingTaxBase)} บาท</td></tr>
  <tr><td>อัตราภาษีหัก ณ ที่จ่าย</td><td>${escapeHtml(String(doc.withholdingTaxRatePercent))}%</td></tr>
  <tr><td>จำนวนภาษีที่หักไว้</td><td>${fmtBaht(doc.withholdingTaxAmount)} บาท</td></tr>
  <tr><td><strong>ยอดเงินสุทธิที่จ่ายให้คู่ค้า</strong></td><td><strong>${fmtBaht(doc.netPaidAmount)} บาท</strong></td></tr>
</table>

<div class="field">ตัวอักษรจำนวนภาษีที่หักไว้: ${escapeHtml(whtWords)}</div>

<div class="sec">4. เงื่อนไขการหักภาษี</div>
${taxConditionChecks(doc.taxCondition, doc.taxConditionOtherRemark)}

<div class="sec">5. ผู้จ่ายเงิน / ผู้รับรอง</div>
<div class="certify-block">ข้าพเจ้าขอรับรองว่า ข้อความและตัวเลขข้างต้นถูกต้องตรงตามความเป็นจริงทุกประการ</div>
<div class="sign-grid">
  <div class="sign-cell">
    <div><strong>ลงชื่อ</strong> ${escapeHtml(doc.authorizedSignerName || '_______________________')}</div>
    <div>${escapeHtml(doc.signerPosition || 'ตำแหน่ง _______________')}</div>
    ${sigUrl ? `<img class="sign-img" src="${escapeHtml(sigUrl)}" alt="signature" />` : ''}
  </div>
  <div class="sign-cell">
    ${stampUrl ? `<div><strong>ตราประทับบริษัท</strong></div><img class="sign-img" src="${escapeHtml(stampUrl)}" alt="stamp" />` : '<div class="muted">ตราประทับ (ถ้ามี)</div>'}
  </div>
</div>
<div class="field" style="margin-top:8px;">
  <strong>ผู้ออกเอกสาร:</strong> ${escapeHtml(doc.issuedByName || '—')} &nbsp;|&nbsp;
  <strong>ผู้พิมพ์:</strong> ${escapeHtml(opts.printedByName)} &nbsp;|&nbsp;
  <strong>วันเวลาที่พิมพ์:</strong> ${escapeHtml(formatDateTimeThaiBE(opts.printedAtMs) || '—')}
</div>

<p class="footer-sys">
  เอกสารนี้ออกจากระบบ OPEC OpsFlow<br/>
  ${opts.showSystemGeneratedNote && (!sigUrl || !stampUrl) ? '<span>เอกสารนี้จัดทำโดยระบบอิเล็กทรอนิกส์ หากไม่มีลายเซ็นและตราประทับ ให้ตรวจสอบความถูกต้องจากเลขที่เอกสารอ้างอิง</span><br/>' : ''}
  สถานะเอกสาร: ${escapeHtml(doc.documentStatus)} · สถานะไฟล์ XML ภายใน: ${escapeHtml(doc.xmlExportStatus || doc.whtElectronicData?.xmlExportStatus || 'NOT_EXPORTED')}
</p>`;
}

/**
 * สร้าง HTML สำหรับพิมพ์จาก snapshot เอกสาร (ข้อมูลเดียวกันทุกฉบับ เปลี่ยนแค่ copyVariant / official)
 */
export function buildWithholdingCertificateDocumentHtml(
  doc: WithholdingCertificateDocument,
  opts: WithholdingCertificateDocumentPrintOptions,
): string {
  const cnRaw = (doc.certificateNo || '').trim();
  const cn = escapeHtml(
    opts.official && cnRaw ? cnRaw : cnRaw || '(ฉบับร่าง — ยังไม่ออกเลขที่อย่างเป็นทางการ)',
  );
  const css = withholdingCertificatePrintCss();
  const inner = buildWithholdingCertificateBodyHtml(doc, opts);

  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>หนังสือรับรองการหักภาษี ณ ที่จ่าย ${cn}</title>
<style>${css}</style></head><body>${inner}
</body></html>`;
}

/**
 * ฉบับที่ 1 + ฉบับที่ 2 (ผู้ถูกหัก) ในไฟล์เดียว — สำหรับพิมพ์หรือบันทึก PDF ให้ลูกค้า
 */
export function buildWithholdingCertificatePayeeCopies12Html(
  doc: WithholdingCertificateDocument,
  opts: WithholdingCertificateDocumentPrintBaseOptions,
): string {
  const cnRaw = (doc.certificateNo || '').trim();
  const cn = escapeHtml(
    opts.official && cnRaw ? cnRaw : cnRaw || '(ฉบับร่าง — ยังไม่ออกเลขที่อย่างเป็นทางการ)',
  );
  const css = withholdingCertificatePrintCss();
  const inner1 = buildWithholdingCertificateBodyHtml(doc, { ...opts, copyVariant: 'COPY_PAYEE_TAX_RETURN' });
  const inner2 = buildWithholdingCertificateBodyHtml(doc, { ...opts, copyVariant: 'COPY_PAYEE_RECORD' });

  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>หนังสือรับรองการหักภาษี ณ ที่จ่าย (ฉบับที่ 1 และ 2) ${cn}</title>
<style>${css}</style></head><body>
<div class="wht-print-page">${inner1}</div>
<div class="wht-print-page">${inner2}</div>
</body></html>`;
}

/** เปิดแท็บแสดง HTML เต็มหน้า — ไม่เรียกกล่องพิมพ์ (ใช้พรีวิวในแอปหรือพิมพ์จากเมนูเบราว์เซอร์) */
export function openWithholdingCertificatePreviewTab(html: string): Window | null {
  const w = window.open('', '_blank');
  if (!w) return null;
  w.document.write(html);
  w.document.close();
  w.focus();
  return w;
}

/** เปิดหน้าต่างพิมพ์หลังสร้าง HTML */
export function openWithholdingCertificatePrintWindow(html: string): void {
  const w = openWithholdingCertificatePreviewTab(html);
  if (!w) return;
  requestAnimationFrame(() => {
    w.print();
  });
}
