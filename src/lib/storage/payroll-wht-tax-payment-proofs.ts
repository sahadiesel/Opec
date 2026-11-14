import type { FirebaseApp } from 'firebase/app';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getNamedStorage } from '@/firebase/named-storage';
import {
  prepareProofUploadBody,
  validateVendorBillPaymentProof,
} from '@/lib/storage/vendor-bill-payment-proofs';
import type { WhtTaxPaymentProofAttachment } from '@/lib/types';

function safeFileSegment(name: string): string {
  return name.replace(/[^\w.\-()\u0E00-\u0E7F]+/g, '_').slice(0, 80) || 'file';
}

/** หลักฐานการโอนภาษีหัก ณ ที่จ่าย (ภงด.1) หรือ ปกส.+สมทบ — PDF หรือรูปภาพ */
export type WhtTaxPaymentProofSection = 'worker' | 'office' | 'executive' | 'vendor' | 'sso';

export async function uploadPayrollWhtTaxPaymentProof(
  firebaseApp: FirebaseApp,
  section: WhtTaxPaymentProofSection,
  uploaderUid: string,
  file: File,
  uploaderName?: string,
): Promise<WhtTaxPaymentProofAttachment> {
  const err = validateVendorBillPaymentProof(file);
  if (err) throw new Error(err);

  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

  const stem = file.name.replace(/\.[^.]+$/, '');
  const prepared = await prepareProofUploadBody(file);
  const safeName = safeFileSegment(`${stem}${prepared.ext}`);
  const folder =
    section === 'sso' ? 'payroll_sso_payment_proofs' : 'payroll_wht_tax_payment_proofs';
  const path = `${folder}/${section === 'sso' ? 'combined' : section}/${uploaderUid}/${Date.now()}_${id.slice(0, 8)}_${safeName}`;

  const storage = getNamedStorage(firebaseApp);
  const r = ref(storage, path);
  await uploadBytes(r, prepared.body, { contentType: prepared.contentType });
  const downloadUrl = await getDownloadURL(r);

  return {
    id,
    storagePath: path,
    downloadUrl,
    fileName: file.name,
    contentType: prepared.contentType,
    uploadedAt: Date.now(),
    uploadedByUid: uploaderUid,
    uploadedByName: uploaderName,
  };
}

/** alias — หลักฐานจ่าย ปกส.+สมทบ ใช้โครงเดียวกับ ภงด. */
export async function uploadPayrollSsoPaymentProof(
  firebaseApp: FirebaseApp,
  uploaderUid: string,
  file: File,
  uploaderName?: string,
): Promise<WhtTaxPaymentProofAttachment> {
  return uploadPayrollWhtTaxPaymentProof(firebaseApp, 'sso', uploaderUid, file, uploaderName);
}
