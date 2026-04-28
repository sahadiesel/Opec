/**
 * พิมพ์แบบฟอร์มหนังสือรับรองการหักภาษี ณ ที่จ่าย (มาตรา 50 ทวิ)
 */

import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import { amountToThaiBahtText } from '@/lib/documents/thai-baht-text';
import type { Purchase, PurchasePaymentMilestone, PurchaseVendorBill, Vendor } from '@/lib/types';

export type CompanyProfileForWhtCert = {
  companyNameTh?: string;
  taxId?: string;
  branchType?: 'head_office' | 'branch';
  branchNo?: string;
  addressLine1?: string;
  addressLine2?: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function datePartsBE(ms: number): { d: string; m: string; y: string } {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return { d: '____', m: '____', y: '________' };
  return {
    d: pad2(d.getDate()),
    m: pad2(d.getMonth() + 1),
    y: String(d.getFullYear() + 543),
  };
}

function fmtBaht(n: number): string {
  return roundMoney2(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function payerAddress(c: CompanyProfileForWhtCert | null | undefined): string {
  if (!c) return '';
  const a = [c.addressLine1, c.addressLine2].filter(Boolean).join(' ');
  return a.trim();
}

function vendorAddress(v: Vendor): string {
  return (v.address || '').trim();
}

function incomeTypeLineHtml(purchase: Purchase): string {
  const isService = purchase.purchaseLineMode === 'SERVICE';
  return `${isService ? '☐' : '☑'} ค่าจ้างทำของ &nbsp; ${isService ? '☑' : '☐'} ค่าจ้างเหมา / ค่าบริการ`;
}

export interface WithholdingCertificate50TwInput {
  company: CompanyProfileForWhtCert | null | undefined;
  vendor: Vendor;
  purchase: Purchase;
  bill: PurchaseVendorBill;
  milestone: PurchasePaymentMilestone | null | undefined;
  baseBeforeVat: number;
  wht: number;
  netPaid: number;
  grossInclVat: number;
  whtRatePercent: number;
  paymentDateMs: number;
  /** เลขที่หนังสือรับรองจากระบบ (number_sequences) */
  certificateNo: string;
  /** ผู้กดพิมพ์ */
  issuerDisplayName: string;
}

export function buildWithholdingCertificate50TwHtml(input: WithholdingCertificate50TwInput): string {
  const {
    company,
    vendor,
    purchase,
    bill,
    milestone,
    baseBeforeVat,
    wht,
    netPaid,
    grossInclVat,
    whtRatePercent,
    paymentDateMs,
    certificateNo,
    issuerDisplayName,
  } = input;

  const vatAmount = roundMoney2(grossInclVat - baseBeforeVat);
  const certParts = datePartsBE(paymentDateMs);
  const payParts = datePartsBE(paymentDateMs);

  const payerName = (company?.companyNameTh || '').trim() || '_______________________________';
  const payerTax = (company?.taxId || '').trim() || '_______________________';
  const payerAddr = payerAddress(company) || '________________________________________________';
  const payerIsHead = company?.branchType !== 'branch';
  const payerBranchNo = (company?.branchNo || '').trim();

  const payeeName = (vendor.vendorName || '').trim() || '—';
  const payeeTax = (vendor.taxId || '').trim() || '_______________________';
  const payeeAddr = vendorAddress(vendor) || '________________________________________________';
  const payeeIsHead = vendor.branchType !== 'branch';
  const payeeBranchNo = (vendor.branchNo || '').trim();

  const billRefNo = (bill.receiptNo || '').trim() || '__________';
  const workDetailParts = [
    milestone?.label ? `งวดชำระ: ${milestone.label}` : '',
    purchase.notes ? `หมายเหตุ PO: ${purchase.notes}` : '',
    bill.notes ? `ใบวางบิล: ${bill.notes}` : '',
  ].filter(Boolean);
  const workDetail = workDetailParts.length ? workDetailParts.join(' · ') : '________________________________________';

  const whtWords = amountToThaiBahtText(wht);

  const css = `
    @page { size: A4; margin: 10mm 12mm; }
    body {
      font-family: 'Sarabun', 'TH Sarabun New', 'Tahoma', sans-serif;
      font-size: 11px;
      line-height: 1.35;
      color: #111;
      margin: 0;
    }
    .doc-top { position: relative; margin-bottom: 8px; min-height: 52px; }
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
      max-width: 240px;
    }
    .doc-meta div { margin-bottom: 3px; }
    .sec {
      margin-top: 7px;
      font-weight: bold;
      border-bottom: 1px solid #333;
      padding-bottom: 1px;
      margin-bottom: 4px;
      font-size: 11.5px;
    }
    .field { margin: 2px 0 3px; font-size: 10.5px; }
    table.amounts { width: 100%; border-collapse: collapse; margin: 4px 0; font-size: 10.5px; }
    table.amounts td { padding: 2px 5px; vertical-align: top; }
    table.amounts td:last-child { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .checkbox-row { margin: 3px 0; font-size: 10.5px; }
    .certify-block { margin-top: 6px; font-size: 10.5px; }
    .footer-sys {
      margin-top: 10px;
      padding-top: 6px;
      border-top: 1px solid #ddd;
      font-size: 10px;
      color: #333;
      text-align: right;
    }
  `;

  const cn = escapeHtml(certificateNo);

  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>หนังสือรับรองการหักภาษี ณ ที่จ่าย ${cn}</title>
<style>${css}</style></head><body>
<div class="doc-top">
  <div class="doc-title-wrap">
    <h1>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1>
    <p class="sub">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</p>
  </div>
  <div class="doc-meta">
    <div><strong>เลขที่</strong> ${cn}</div>
    <div><strong>วันที่ออกหนังสือรับรอง</strong><br/>${certParts.d} / ${certParts.m} / ${certParts.y}</div>
  </div>
</div>

<div class="sec">1. ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</div>
<div class="field">ชื่อบริษัท/ห้าง: ${escapeHtml(payerName)}</div>
<div class="field">เลขประจำตัวผู้เสียภาษี: ${escapeHtml(payerTax)}</div>
<div class="field">ที่อยู่: ${escapeHtml(payerAddr)}</div>
<div class="field">สาขา: ${payerIsHead ? '☑' : '☐'} สำนักงานใหญ่ &nbsp; ${payerIsHead ? '☐' : '☑'} สาขาเลขที่ ${escapeHtml(!payerIsHead && payerBranchNo ? payerBranchNo : '__________')}</div>

<div class="sec">2. ผู้ถูกหักภาษี ณ ที่จ่าย / คู่ค้า / ผู้รับจ้าง</div>
<div class="field">ชื่อบุคคล/บริษัท/ห้าง: ${escapeHtml(payeeName)}</div>
<div class="field">เลขประจำตัวผู้เสียภาษี: ${escapeHtml(payeeTax)}</div>
<div class="field">ที่อยู่: ${escapeHtml(payeeAddr)}</div>
<div class="field">สาขา: ${payeeIsHead ? '☑' : '☐'} สำนักงานใหญ่ &nbsp; ${payeeIsHead ? '☐' : '☑'} สาขาเลขที่ ${escapeHtml(!payeeIsHead && payeeBranchNo ? payeeBranchNo : '__________')}</div>

<div class="sec">3. รายละเอียดการจ่ายเงิน</div>
<div class="field">ประเภทเงินได้: ${incomeTypeLineHtml(purchase)}</div>
<div class="field">อ้างอิงเอกสาร: ใบแจ้งหนี้/ใบวางบิล/ใบกำกับภาษี เลขที่ ${escapeHtml(billRefNo)}</div>
<div class="field">รายละเอียดงาน: ${escapeHtml(workDetail)}</div>
<div class="field">วันที่จ่ายเงิน: ${payParts.d} / ${payParts.m} / ${payParts.y}</div>

<table class="amounts" aria-label="ยอดเงิน">
  <tr><td>จำนวนเงินค่าจ้างก่อน VAT</td><td>${fmtBaht(baseBeforeVat)} บาท</td></tr>
  <tr><td>VAT 7%</td><td>${fmtBaht(vatAmount)} บาท</td></tr>
  <tr><td><strong>ยอดรวมตามใบแจ้งหนี้</strong></td><td><strong>${fmtBaht(grossInclVat)} บาท</strong></td></tr>
  <tr><td>ฐานภาษีหัก ณ ที่จ่าย</td><td>${fmtBaht(baseBeforeVat)} บาท</td></tr>
  <tr><td>อัตราภาษีหัก ณ ที่จ่าย</td><td>${escapeHtml(String(whtRatePercent))}%</td></tr>
  <tr><td>จำนวนภาษีที่หักไว้</td><td>${fmtBaht(wht)} บาท</td></tr>
  <tr><td><strong>ยอดเงินสุทธิที่จ่ายให้คู่ค้า</strong></td><td><strong>${fmtBaht(netPaid)} บาท</strong></td></tr>
</table>

<div class="field">ตัวอักษรจำนวนภาษีที่หักไว้: ${escapeHtml(whtWords)}</div>

<div class="sec">4. เงื่อนไขการหักภาษี</div>
<div class="checkbox-row">☑ หัก ณ ที่จ่าย</div>
<div class="checkbox-row">☐ ออกภาษีให้ตลอดไป</div>
<div class="checkbox-row">☐ ออกภาษีให้ครั้งเดียว</div>
<div class="checkbox-row">☐ อื่น ๆ: _____________________________________________</div>

<div class="sec">5. ผู้จ่ายเงิน / ผู้รับรอง</div>
<div class="certify-block">ข้าพเจ้าขอรับรองว่า ข้อความและตัวเลขข้างต้นถูกต้องตรงตามความเป็นจริงทุกประการ</div>

<p class="footer-sys">เอกสารออกจากระบบ OPEC OpsFlow โดย ${escapeHtml(issuerDisplayName)}</p>
</body></html>`;
}

/** เปิดหน้าต่างพิมพ์หลังสร้าง HTML และออกเลขที่แล้ว */
export function openWithholdingCertificatePrintWindow(html: string): void {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  requestAnimationFrame(() => {
    w.print();
  });
}
