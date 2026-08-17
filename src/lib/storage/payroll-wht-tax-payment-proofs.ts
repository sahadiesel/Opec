import type { FirebaseApp } from 'firebase/app';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import {
  resolvedVendorBillProofContentType,
  validateVendorBillPaymentProof,
} from '@/lib/storage/vendor-bill-payment-proofs';
import type { WhtTaxPaymentProofAttachment } from '@/lib/types';

function safeFileSegment(name: string): string {
  return name.replace(/[^\w.\-()\u0E00-\u0E7F]+/g, '_').slice(0, 80) || 'file';
}

function proofStorageExtensionFromFilename(name: string): string | null {
  const m = name.match(/(\.[a-z0-9]+)$/i);
  if (!m) return null;
  const e = m[1].toLowerCase();
  if (e === '.jpeg') return '.jpg';
  if (['.pdf', '.png', '.jpg', '.webp', '.gif'].includes(e)) return e;
  return null;
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
  const ext =
    proofStorageExtensionFromFilename(file.name) ??
    (resolvedVendorBillProofContentType(file) === 'application/pdf' ? '.pdf' : '.jpg');
  const safeName = safeFileSegment(`${stem}${ext}`);
  const folder =
    section === 'sso' ? 'payroll_sso_payment_proofs' : 'payroll_wht_tax_payment_proofs';
  const path = `${folder}/${section === 'sso' ? 'combined' : section}/${uploaderUid}/${Date.now()}_${id.slice(0, 8)}_${safeName}`;

  const storage = getStorage(firebaseApp);
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: resolvedVendorBillProofContentType(file) });
  const downloadUrl = await getDownloadURL(r);

  return {
    id,
    storagePath: path,
    downloadUrl,
    fileName: file.name,
    contentType: resolvedVendorBillProofContentType(file),
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
