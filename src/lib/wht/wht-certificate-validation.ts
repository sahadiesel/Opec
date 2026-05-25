/**
 * Validation ก่อนออกหนังสือรับรองหัก ณ ที่จ่าย (ม.50 ทวิ)
 */

import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import type { WithholdingCertificateCopyVariant, WithholdingCertificateDocument } from '@/lib/types';

/** เลขที่หนังสือรับรองที่ใช้แสดงและตรวจสอบ — รองรับทั้งฟิลด์หลักและ whtElectronicData.documentNo */
export function effectiveWhtCertificateDocumentNo(
  doc: Pick<WithholdingCertificateDocument, 'certificateNo' | 'whtElectronicData'>,
): string {
  const top = String(doc.certificateNo ?? '').trim();
  if (top) return top;
  return String(doc.whtElectronicData?.documentNo ?? '').trim();
}

const THAI_TAX_ID = /^\d{13}$/;

export function isValidThaiTaxId(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') return false;
  return THAI_TAX_ID.test(id.trim());
}

/** ค่าว่างหรือตัวยึดบนแบบ (— / - / en dash) เท่านั้น — ไม่ถือเป็นข้อมูลจริง */
function isMissingOrWhtPlaceholderValue(value: string | null | undefined): boolean {
  const s = (value ?? '').trim();
  if (!s) return true;
  return /^[—\-–\s]+$/u.test(s);
}

export function validateWhtCertificateForOfficialIssue(
  doc: Pick<
    WithholdingCertificateDocument,
    | 'payer'
    | 'payee'
    | 'amountBeforeVat'
    | 'withholdingTaxBase'
    | 'withholdingTaxRatePercent'
    | 'withholdingTaxAmount'
    | 'grossAmount'
    | 'vatAmount'
    | 'netPaidAmount'
    | 'paymentDate'
    | 'taxCondition'
    | 'taxConditionOtherRemark'
    | 'referenceVendorBillNo'
    | 'sourceVendorBillId'
    | 'sourceCashbookEntryId'
    | 'incomeTypeCode'
  >,
  options?: { requireCashbookReference?: boolean },
): string[] {
  const errors: string[] = [];
  const requireCb = options?.requireCashbookReference !== false;

  if (!doc.payer?.taxId?.trim()) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: ยังไม่มีเลขประจำตัวผู้เสียภาษีของผู้จ่าย (บริษัท)');
  } else if (!isValidThaiTaxId(doc.payer.taxId)) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: เลขประจำตัวผู้เสียภาษีของผู้จ่ายต้องเป็นตัวเลข 13 หลัก');
  }

  if (isMissingOrWhtPlaceholderValue(doc.payer?.legalNameTh)) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: ยังไม่มีชื่อผู้จ่าย (บริษัท) — ตรวจการตั้งค่า company profile');
  }

  if (doc.payer.branchType === 'BRANCH' && !(doc.payer.branchNo || '').trim()) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: ผู้จ่ายเป็นสาขาแต่ยังไม่มีเลขที่สาขา');
  }

  const payeeTax = (doc.payee?.taxId || '').trim();
  if (isMissingOrWhtPlaceholderValue(payeeTax)) {
    errors.push(
      'ไม่สามารถออกหนังสือรับรองได้: ยังไม่มีเลขประจำตัวผู้เสียภาษีของผู้ถูกหัก (คู่ค้า) — แก้ทะเบียนคู่ค้าให้ครบก่อน',
    );
  } else if (doc.payee.vendorCategory !== 'FOREIGN' && !isValidThaiTaxId(payeeTax)) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: เลขประจำตัวผู้เสียภาษีของคู่ค้า (นิติบุคคลไทย) ต้องเป็นตัวเลข 13 หลัก');
  }

  if (isMissingOrWhtPlaceholderValue(doc.payee?.displayName)) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: ยังไม่มีชื่อผู้ถูกหัก (คู่ค้า) — แก้ทะเบียนคู่ค้าให้ครบก่อน');
  }

  if (doc.payee.branchType === 'BRANCH' && !(doc.payee.branchNo || '').trim()) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: คู่ค้าเป็นสาขาแต่ยังไม่มีเลขที่สาขา');
  }

  if (isMissingOrWhtPlaceholderValue(doc.payer.addressTh)) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: ยังไม่มีที่อยู่ผู้จ่าย — ตรวจการตั้งค่า company profile');
  }
  if (isMissingOrWhtPlaceholderValue(doc.payee.addressTh)) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: ยังไม่มีที่อยู่ผู้ถูกหัก (คู่ค้า) — แก้ทะเบียนคู่ค้าให้ครบก่อน');
  }

  if (!doc.paymentDate?.trim()) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: ยังไม่มีวันที่จ่ายเงิน');
  }

  if (!doc.incomeTypeCode) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: ยังไม่มีประเภทเงินได้');
  }

  if (!doc.taxCondition) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: กรุณาระบุเงื่อนไขการหักภาษี');
  }
  if (doc.taxCondition === 'OTHER' && !(doc.taxConditionOtherRemark || '').trim()) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: เลือกเงื่อนไข «อื่น ๆ» ต้องระบุรายละเอียด');
  }

  if (!doc.referenceVendorBillNo?.trim() || !doc.sourceVendorBillId?.trim()) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: ขาดอ้างอิงใบวางบิล');
  }

  if (requireCb && !doc.sourceCashbookEntryId?.trim()) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: ยังไม่มีรายการจ่ายเงิน (cashbook) — ใช้ได้หลังบันทึกจ่ายแล้ว');
  }

  if (doc.amountBeforeVat < 0.005) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: ยอดก่อน VAT ต้องมากกว่า 0');
  }

  if (roundMoney2(doc.withholdingTaxAmount) < 0.005) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: จำนวนภาษีที่หักต้องมากกว่า 0');
  }

  const gross = roundMoney2(doc.amountBeforeVat + doc.vatAmount);
  if (Math.abs(gross - roundMoney2(doc.grossAmount)) > 0.02) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: ยอดรวมก่อนหักไม่เท่ากับ (ก่อน VAT + VAT)');
  }

  const baseWht = roundMoney2(doc.withholdingTaxBase);
  const grossAmt = roundMoney2(doc.grossAmount);
  if (baseWht < -0.005) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: ฐานหัก ณ ที่จ่ายต้องไม่ติดลบ');
  }
  /** ฐานหักอาจน้อยกว่ายอดก่อน VAT ทั้งใบ (หักเฉพาะบางรายการ เช่น ค่าขนส่ง) — ห้ามเกินยอดรวมจ่ายในใบ */
  if (baseWht > grossAmt + 0.02) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: ฐานหัก ณ ที่จ่ายต้องไม่เกินยอดรวมในใบ (รวม VAT)');
  }

  const rate = Number(doc.withholdingTaxRatePercent) || 0;
  const expectedWht = rate > 0 ? roundMoney2((roundMoney2(doc.withholdingTaxBase) * rate) / 100) : 0;
  if (Math.abs(expectedWht - roundMoney2(doc.withholdingTaxAmount)) > 0.02) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: จำนวนภาษีหักไม่ตรงกับอัตราที่กำหนด');
  }

  const expectedNet = roundMoney2(doc.grossAmount - doc.withholdingTaxAmount);
  if (Math.abs(expectedNet - roundMoney2(doc.netPaidAmount)) > 0.02) {
    errors.push('ไม่สามารถออกหนังสือรับรองได้: ยอดสุทธิที่จ่ายไม่สอดคล้องกับยอดรวม − ภาษีหัก');
  }

  return errors;
}

const COPY_VARIANTS = new Set<WithholdingCertificateCopyVariant>([
  'COPY_PAYEE_TAX_RETURN',
  'COPY_PAYEE_RECORD',
  'COPY_PAYER_RECORD',
]);

export function validateWhtCopyVariant(v: WithholdingCertificateCopyVariant | string | undefined): string | null {
  if (!v) return 'ไม่สามารถพิมพ์ได้: ยังไม่ได้ระบุประเภทสำเนาเอกสาร';
  if (!COPY_VARIANTS.has(v as WithholdingCertificateCopyVariant)) {
    return 'ไม่สามารถพิมพ์ได้: ประเภทสำเนาเอกสารไม่ถูกต้อง';
  }
  return null;
}

export function validateWhtCertificateForPreviewPrint(
  doc: Pick<WithholdingCertificateDocument, 'documentStatus'>,
  copyVariant: WithholdingCertificateCopyVariant | string | undefined,
): string[] {
  const errors: string[] = [];
  if (doc.documentStatus === 'CANCELLED') {
    errors.push('ไม่สามารถพิมพ์ได้: เอกสารถูกยกเลิกแล้ว');
  }
  const cv = validateWhtCopyVariant(copyVariant);
  if (cv) errors.push(cv);
  return errors;
}

/** พิมพ์ทางการ (หลัง ISSUED) — ต้องมีเลขที่ + ผ่าน validation ยอดเงิน */
export function validateWhtCertificateForOfficialPrint(
  doc: WithholdingCertificateDocument,
  copyVariant: WithholdingCertificateCopyVariant | string | undefined,
  options?: { requireCashbookReference?: boolean },
): string[] {
  const errors = validateWhtCertificateForPreviewPrint(doc, copyVariant);
  if (doc.documentStatus !== 'ISSUED') {
    errors.push('ไม่สามารถพิมพ์เป็นทางการได้: ต้องออกเอกสาร (ISSUED) ก่อน');
  }
  if (!effectiveWhtCertificateDocumentNo(doc)) {
    errors.push('ไม่สามารถพิมพ์เป็นทางการได้: ยังไม่มีเลขที่เอกสาร');
  }
  errors.push(...validateWhtCertificateForOfficialIssue(doc, options));
  return errors;
}

/** พิมพ์ฉบับที่ 1 + 2 (ผู้ถูกหัก) ในไฟล์เดียว — เงื่อนไขเดียวกับพิมพ์ฉบับที่ 1 */
export function validateWhtCertificateForPayeeCopies12Print(
  doc: WithholdingCertificateDocument,
  official: boolean,
  options?: { requireCashbookReference?: boolean },
): string[] {
  if (official) {
    return validateWhtCertificateForOfficialPrint(doc, 'COPY_PAYEE_TAX_RETURN', options);
  }
  return validateWhtCertificateForPreviewPrint(doc, 'COPY_PAYEE_TAX_RETURN');
}
