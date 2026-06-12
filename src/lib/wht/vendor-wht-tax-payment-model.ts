import type { WithholdingCertificateDocument } from '@/lib/types';
import { whtTaxStatusLabel } from '@/lib/payroll/payroll-wht-tax-payment-model';

/** คู่ค้าจ่ายแล้วและออกหนังสือรับรองแล้ว — พร้อมนำส่งภาษี */
export function isVendorWhtSourcePaid(doc: WithholdingCertificateDocument): boolean {
  const st = doc.documentStatus;
  if (st === 'CANCELLED' || st === 'REPLACED') return false;
  return st === 'ISSUED' || st === 'VERIFIED';
}

export function isVendorWhtTaxRemitted(doc: WithholdingCertificateDocument): boolean {
  return !!(doc.whtTaxCashbookEntryId || doc.whtTaxPaidAt);
}

export function vendorPaymentStatusLabel(doc: WithholdingCertificateDocument): string {
  const st = doc.documentStatus;
  if (st === 'ISSUED' || st === 'VERIFIED') return 'จ่ายแล้ว';
  if (st === 'CANCELLED') return 'ยกเลิก';
  if (st === 'REPLACED') return 'แทนที่';
  return 'ร่าง';
}

export function vendorWhtTaxStatusLabel(doc: WithholdingCertificateDocument): string {
  return whtTaxStatusLabel(isVendorWhtSourcePaid(doc), isVendorWhtTaxRemitted(doc));
}

export function isVendorWhtRowPayable(doc: WithholdingCertificateDocument): boolean {
  const tax = Number(doc.withholdingTaxAmount) || 0;
  if (tax <= 0.005) return false;
  return isVendorWhtSourcePaid(doc) && !isVendorWhtTaxRemitted(doc);
}
