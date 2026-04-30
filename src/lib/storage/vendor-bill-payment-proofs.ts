import type { FirebaseApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const MAX_PDF_BYTES = 10 * 1024 * 1024;

function safeFileSegment(name: string): string {
  return name.replace(/[^\w.\-()\u0E00-\u0E7F]+/g, '_').slice(0, 80) || 'file';
}

export function validateVendorBillPaymentProofPdf(file: File): string | null {
  if (file.type !== 'application/pdf') {
    return 'อัปโหลดได้เฉพาะไฟล์ PDF';
  }
  if (file.size > MAX_PDF_BYTES) {
    return 'PDF ต้องไม่เกิน 10 MB';
  }
  return null;
}

export async function uploadVendorBillPaymentProofPdf(
  firebaseApp: FirebaseApp,
  vendorBillId: string,
  uploaderUid: string,
  file: File
): Promise<{ downloadUrl: string; fileName: string; storagePath: string }> {
  const err = validateVendorBillPaymentProofPdf(file);
  if (err) throw new Error(err);
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const safeName = safeFileSegment(file.name.replace(/\.[^.]+$/, '') + '.pdf');
  const path = `vendor_bill_payment_proofs/${uploaderUid}/${vendorBillId}/${Date.now()}_${id.slice(0, 8)}_${safeName}`;
  const storage = getStorage(firebaseApp);
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: 'application/pdf' });
  const downloadUrl = await getDownloadURL(r);
  return { downloadUrl, fileName: file.name, storagePath: path };
}
