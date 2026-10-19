import type { Vendor, WithholdingCertificateDocument, WhtWithholdingFormType } from '@/lib/types';

/** คำนำหน้าที่ใช้กับบุคคลธรรมดา — ภงด.3 */
const NATURAL_PERSON_NAME =
  /^\s*(นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง|mr\.?|mrs\.?|ms\.?|miss)\b/i;

export function withholdingFormTypeForVendor(
  vendor: Pick<Vendor, 'vendorLegalForm'> | null | undefined,
): WhtWithholdingFormType {
  return vendor?.vendorLegalForm === 'NATURAL' ? 'PND3' : 'PND53';
}

/**
 * แยกรายการคู่ค้า: ภงด.3 = บุคคลธรรมดา, ภงด.53 = นิติบุคคล
 * ชื่อที่มีคำนำหน้าบุคคลมาก่อน เพราะทะเบียนคู่ค้าเดิมอาจยังไม่ได้ระบุรูปแบบนิติบุคคล
 */
export function vendorCertificateFormBucket(
  doc: Pick<WithholdingCertificateDocument, 'withholdingFormType' | 'formTypeCode' | 'payee'>,
  vendor?: Pick<Vendor, 'vendorLegalForm' | 'vendorName'> | null,
): WhtWithholdingFormType {
  const displayName = (doc.payee?.displayName || vendor?.vendorName || '').trim();
  if (NATURAL_PERSON_NAME.test(displayName)) return 'PND3';
  if (vendor?.vendorLegalForm === 'NATURAL') return 'PND3';
  if (doc.withholdingFormType === 'PND3' || doc.formTypeCode === 'PND3') return 'PND3';
  if (doc.payee?.vendorCategory === 'INDIVIDUAL') return 'PND3';
  return 'PND53';
}
