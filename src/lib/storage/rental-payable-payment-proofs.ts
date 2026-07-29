import type { FirebaseApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  resolvedVendorBillProofContentType,
  validateVendorBillPaymentProof,
} from '@/lib/storage/vendor-bill-payment-proofs';

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

async function uploadRentalProof(
  firebaseApp: FirebaseApp,
  folder: 'rental_payable_payment_proofs' | 'rental_payable_wht_payment_proofs',
  payableId: string,
  uploaderUid: string,
  file: File,
): Promise<{ downloadUrl: string; fileName: string; storagePath: string }> {
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
  const path = `${folder}/${uploaderUid}/${payableId}/${Date.now()}_${id.slice(0, 8)}_${safeName}`;
  const storage = getStorage(firebaseApp);
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: resolvedVendorBillProofContentType(file) });
  const downloadUrl = await getDownloadURL(r);
  return { downloadUrl, fileName: file.name, storagePath: path };
}

/** หลักฐานโอนเงินค่าเช่า — รูปแบบเดียวกับใบวางบิล */
export async function uploadRentalPayablePaymentProof(
  firebaseApp: FirebaseApp,
  payableId: string,
  uploaderUid: string,
  file: File,
): Promise<{ downloadUrl: string; fileName: string; storagePath: string }> {
  return uploadRentalProof(firebaseApp, 'rental_payable_payment_proofs', payableId, uploaderUid, file);
}

/** หลักฐานหัก ณ ที่จ่ายค่าเช่า */
export async function uploadRentalPayableWhtProof(
  firebaseApp: FirebaseApp,
  payableId: string,
  uploaderUid: string,
  file: File,
): Promise<{ downloadUrl: string; fileName: string; storagePath: string }> {
  return uploadRentalProof(
    firebaseApp,
    'rental_payable_wht_payment_proofs',
    payableId,
    uploaderUid,
    file,
  );
}

export { validateVendorBillPaymentProof as validateRentalPayablePaymentProof };
