/**
 * HTML พิมพ์หนังสือรับรองหัก ณ ที่จ่าย — ลูกจ้าง (Payroll)
 * ใช้สไตล์เดียวกับใบคู่ค้า (withholding-certificate-50-tw-print) แต่เนื้อหาตามงวดเงินเดือน
 */

import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import { formatYmdLocalThaiBE } from '@/lib/date-thai';
import { payrollWorkerWhtPrintCss } from '@/lib/documents/withholding-certificate-50-tw-print';
import { escapeHtmlDoc, sanitizePrintFileBaseName } from '@/lib/documents/standard-document-print';
import type { PaymentMethod, WithholdingCertificateCopyVariant } from '@/lib/types';
import type { PayrollWorkerWhtPrintVm } from '@/lib/payroll/payroll-worker-wht-types';

export type PayrollWorkerWhtPrintBaseOptions = {
  official: boolean;
  printedByName: string;
  printedAtMs: number;
  showSignatureImage: boolean;
  /** เก็บในชนิดเพื่อความเข้ากันได้ — แม่แบบลูกจ้างไม่แสดงตราประทับบริษัท */
  showCompanyStamp?: boolean;
  showSystemGeneratedNote: boolean;
};

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

function taxConditionChecks(): string {
  const mk = (on: boolean) => (on ? '☑' : '☐');
  const tc = 'WITHHOLDING' as const;
  return `<div class="pwht-tax-conds">
<div class="checkbox-row">${mk(tc === 'WITHHOLDING')} หัก ณ ที่จ่าย</div>
<div class="checkbox-row">${mk(false)} ออกภาษีให้ตลอดไป</div>
<div class="checkbox-row">${mk(false)} ออกภาษีให้ครั้งเดียว</div>
<div class="checkbox-row">${mk(false)} อื่น ๆ: _____________________________</div>
</div>`;
}

function buildPayrollWorkerWhtBodyHtml(vm: PayrollWorkerWhtPrintVm, copyVariant: WithholdingCertificateCopyVariant, opts: PayrollWorkerWhtPrintBaseOptions): string {
  const cnRaw = (vm.documentNo || '').trim();
  const cn = escapeHtml(opts.official && cnRaw ? cnRaw : cnRaw || '(ฉบับร่าง — preview)');

  const issueDateDisp = formatYmdLocalThaiBE(vm.issueDateYmd, '____/____/________');
  const payDateDisp = formatYmdLocalThaiBE(vm.paymentDateYmd, '____/____/________');

  const payer = vm.payer;
  const payee = vm.payee;
  const payerIsHead = payer.branchIsHeadOffice;

  const sigUrl = opts.showSignatureImage ? (vm.signatureImageUrl || '').trim() : '';

  const banner = escapeHtml(copyVariantBannerTh(copyVariant));

  const earnRows = vm.earningsRows
    .map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>${fmtBaht(r.amount)} บาท</td></tr>`)
    .join('');
  const dedRows = vm.deductionsRows
    .map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>${fmtBaht(r.amount)} บาท</td></tr>`)
    .join('');

  const pitNote = vm.pitZeroNote ? `<div class="field muted">${escapeHtml(vm.pitZeroNote)}</div>` : '';

  return `
${!opts.official ? '<div class="draft-watermark">[ ตัวอย่างก่อนออกเอกสาร — ไม่ใช่หลักฐานทางการ ]</div>' : ''}
<div class="copy-banner">${banner}</div>
<div class="doc-top">
  <div class="doc-title-wrap">
    <h1>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1>
    <p class="sub">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</p>
    <p class="sub" style="margin-top:4px;font-weight:600;">${escapeHtml(vm.subtitleTh)}</p>
  </div>
  <div class="doc-meta">
    <div><strong>เลขที่</strong> ${cn}</div>
    <div><strong>วันที่ออกหนังสือรับรอง</strong><br/>${escapeHtml(issueDateDisp)}</div>
    <div><strong>วันที่จ่ายเงิน</strong><br/>${escapeHtml(payDateDisp)}</div>
  </div>
</div>

<div class="pwht-print-fill">
<div class="sec">1. ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</div>
<div class="field">ชื่อบริษัท/ห้าง: ${escapeHtml(payer.legalNameTh || '—')}</div>
${payer.legalNameEn ? `<div class="field muted">Name (EN): ${escapeHtml(payer.legalNameEn)}</div>` : ''}
<div class="field">เลขประจำตัวผู้เสียภาษี: ${escapeHtml(payer.taxId || '—')}</div>
<div class="field">ประเภทผู้เสียภาษี: นิติบุคคล</div>
<div class="field">ที่อยู่ (ภาษาไทย): ${escapeHtml(payer.addressTh || '—')}</div>
${payer.phone || payer.email ? `<div class="field">โทรศัพท์ / อีเมล: ${escapeHtml([payer.phone, payer.email].filter(Boolean).join(' · ') || '—')}</div>` : ''}
<div class="field">สาขา: ${payerIsHead ? '☑' : '☐'} สำนักงานใหญ่ &nbsp; ${payerIsHead ? '☐' : '☑'} สาขาเลขที่ ${escapeHtml(!payerIsHead && payer.branchNo ? payer.branchNo : '__________')}</div>

<div class="sec">2. ผู้ถูกหักภาษี ณ ที่จ่าย / ลูกจ้าง</div>
<div class="field">ชื่อลูกจ้าง: ${escapeHtml(payee.displayName || '—')}</div>
<div class="field">รหัสลูกจ้าง: ${escapeHtml(payee.workerCode || '—')}</div>
<div class="field">${payee.taxIdIsPassport ? 'เลข Passport' : 'เลขประจำตัวประชาชน'}: ${escapeHtml(payee.taxIdDisplay)}</div>
${payee.taxIdIsPassport ? `<div class="field muted">หมายเหตุ: ไม่ใช่เลขประจำตัวผู้เสียภาษีอากรไทย — แรงงานต่างชาติ</div>` : ''}
${payee.nationality ? `<div class="field">สัญชาติ: ${escapeHtml(payee.nationality)}</div>` : ''}
${payee.positionLabel ? `<div class="field">ตำแหน่งหลัก: ${escapeHtml(payee.positionLabel)}</div>` : ''}
${payee.addressTh ? `<div class="field">ที่อยู่: ${escapeHtml(payee.addressTh)}</div>` : ''}
${payee.bankName || payee.bankAccountLast4 ? `<div class="field">ธนาคาร / เลขบัญชี (ปลาย 4 หลัก): ${escapeHtml(payee.bankName || '—')}${payee.bankAccountLast4 ? ` · …${escapeHtml(payee.bankAccountLast4)}` : ''}</div>` : ''}

<div class="sec">3. รายละเอียดการจ่ายเงิน</div>
<div class="field">งวด Payroll: ${escapeHtml(vm.payrollPeriodLabel)}</div>
<div class="field">เลขอ้างอิง batch: ${escapeHtml(vm.batchReference)}</div>
<div class="field">ประเภทเงินได้: ☑ ${escapeHtml(vm.incomeTypeNameTh)}</div>
<div class="field muted">รหัสภายในระบบ: ${escapeHtml(vm.incomeTypeCode)} · แบบหัก ณ ที่จ่าย: ภงด.1 · formTypeCode: ${escapeHtml(vm.formTypeCode)}</div>
<div class="field">วิธีชำระเงิน: ${escapeHtml(paymentMethodTh(vm.paymentMethod))}</div>
<div class="field">เลขที่อ้างอิงการชำระเงิน: ${escapeHtml(vm.paymentReferenceNo || '—')}</div>

<div class="pwht-earn-ded-wrap">
  <div class="pwht-earn-ded-col">
    <div class="sec pwht-inline-sec">รายได้</div>
    <table class="amounts" aria-label="รายได้">
      <tbody>
        ${earnRows}
        <tr><td><strong>รวมรายได้</strong></td><td><strong>${fmtBaht(vm.grossAmount)} บาท</strong></td></tr>
      </tbody>
    </table>
  </div>
  <div class="pwht-earn-ded-col">
    <div class="sec pwht-inline-sec">รายการหัก</div>
    <table class="amounts" aria-label="รายการหัก">
      <tbody>
        ${dedRows}
        <tr><td><strong>รวมรายการหัก</strong></td><td><strong>${fmtBaht(vm.totalDeductions)} บาท</strong></td></tr>
      </tbody>
    </table>
  </div>
</div>

<div class="sec">4. ภาษีหัก ณ ที่จ่าย</div>
${pitNote}
<div class="field">ฐานภาษี (เงินได้ที่ใช้คำนวณใน Payroll): ${fmtBaht(vm.taxableIncomeAmount)} บาท</div>
<div class="field">อัตราภาษีหัก ณ ที่จ่าย ${escapeHtml(vm.withholdingTaxRateDisplayTh)} เป็นเงินที่หักไว้ ${fmtBaht(vm.withholdingTaxAmount)} บาท</div>
<div class="field">ตัวอักษรจำนวนภาษีที่หักไว้: ${escapeHtml(vm.withholdingTaxWordsTh)}</div>
<div class="field"><strong>ยอดสุทธิที่จ่าย</strong>: ${fmtBaht(vm.netPaidAmount)} บาท</div>

<div class="sec">5. เงื่อนไขการหักภาษี</div>
${taxConditionChecks()}

<div class="sec">6. ผู้จ่ายเงิน / ผู้รับรอง</div>
<div class="certify-block">ข้าพเจ้าขอรับรองว่า ข้อความและตัวเลขข้างต้นถูกต้องตรงตามความเป็นจริงทุกประการ</div>
<div class="sign-grid">
  <div class="sign-cell">
    <div><strong>ลงชื่อ</strong> ${escapeHtml(vm.authorizedSignerName || '_______________________')}</div>
    <div>${escapeHtml(vm.signerPosition || 'ตำแหน่ง _______________')}</div>
    ${sigUrl ? `<img class="sign-img" src="${escapeHtml(sigUrl)}" alt="signature" />` : ''}
  </div>
</div>
<div class="field pwht-after-sign">
  <strong>ผู้ออกเอกสาร:</strong> ${escapeHtml(vm.issuedByName || '—')} &nbsp;|&nbsp;
  <strong>ผู้พิมพ์:</strong> ${escapeHtml(opts.printedByName)}
</div>

<p class="footer-sys">
  เอกสารนี้ออกจากระบบ OPEC OpsFlow · สถานะเอกสาร: ${escapeHtml(vm.documentStatusLabel)} · XML-ready:
  ${escapeHtml(vm.xmlExportStatus)}${opts.showSystemGeneratedNote ? ' · จัดทำด้วยระบบ — โปรดตรวจสอบก่อนใช้เป็นหลักฐานทางการ' : ''}
</p>
</div>`;
}

export function buildPayrollWorkerWhtCertificateHtml(
  vm: PayrollWorkerWhtPrintVm,
  copyVariant: WithholdingCertificateCopyVariant,
  opts: PayrollWorkerWhtPrintBaseOptions,
): string {
  const cnRaw = (vm.documentNo || '').trim();
  const printFileTitle = sanitizePrintFileBaseName(cnRaw || 'PND1-worker-preview');
  const css = payrollWorkerWhtPrintCss();
  const inner = buildPayrollWorkerWhtBodyHtml(vm, copyVariant, opts);
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtmlDoc(printFileTitle)}</title>
<style>${css}</style></head><body class="payroll-wht-print"><div class="wht-print-page">${inner}</div></body></html>`;
}

export function buildPayrollWorkerWhtCertificateMultiHtml(
  vm: PayrollWorkerWhtPrintVm,
  variants: WithholdingCertificateCopyVariant[],
  opts: PayrollWorkerWhtPrintBaseOptions,
): string {
  const cnRaw = (vm.documentNo || '').trim();
  const printFileTitle = sanitizePrintFileBaseName(cnRaw || 'PND1-worker-preview');
  const css = payrollWorkerWhtPrintCss();
  const pages = variants
    .map((v) => `<div class="wht-print-page">${buildPayrollWorkerWhtBodyHtml(vm, v, opts)}</div>`)
    .join('');
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtmlDoc(printFileTitle)}</title>
<style>${css}</style></head><body class="payroll-wht-print">${pages}</body></html>`;
}

export function openPayrollWorkerWhtPrintWindow(html: string): void {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  requestAnimationFrame(() => {
    try {
      w.document.title = sanitizePrintFileBaseName(w.document.title || 'PND1-worker');
    } catch {
      /* ignore */
    }
    w.print();
  });
}
