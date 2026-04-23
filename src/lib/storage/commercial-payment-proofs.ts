import type { FirebaseApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { compressImageFileToMaxSize } from '@/lib/storage/image-compress';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_COMPRESSED = 500 * 1024;
const MAX_IMAGE_ORIGINAL_BYTES = 25 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

function safeFileSegment(name: string): string {
  return name.replace(/[^\w.\-()\u0E00-\u0E7F]+/g, '_').slice(0, 80) || 'file';
}

export function validateCommercialPaymentProofFile(file: File): string | null {
  if (IMAGE_TYPES.has(file.type)) {
    if (file.size > MAX_IMAGE_ORIGINAL_BYTES) {
      return 'ไฟล์รูปต้นฉบับใหญ่เกินไป (จำกัด ~25 MB ก่อนบีบอัด)';
    }
    return null;
  }
  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF_BYTES) {
      return 'PDF ต้องไม่เกิน 10 MB';
    }
    return null;
  }
  return 'รองรับเฉพาะรูป JPEG, PNG, WebP หรือไฟล์ PDF';
}

export async function uploadCommercialPaymentProof(
  firebaseApp: FirebaseApp,
  commercialInvoiceId: string,
  uploaderUid: string,
  file: File,
): Promise<{ downloadUrl: string; fileName: string; contentType: string; storagePath: string }> {
  const err = validateCommercialPaymentProofFile(file);
  if (err) throw new Error(err);

  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

  let blob: Blob;
  let contentType: string;
  let safeName: string;

  if (IMAGE_TYPES.has(file.type)) {
    blob = await compressImageFileToMaxSize(file, MAX_IMAGE_COMPRESSED);
    contentType = blob.type || 'image/jpeg';
    safeName = safeFileSegment(file.name.replace(/\.[^.]+$/, '') + '.jpg');
  } else {
    blob = file;
    contentType = 'application/pdf';
    safeName = safeFileSegment(file.name.replace(/\.[^.]+$/, '') + '.pdf');
  }

  const path = `commercial_payment_proofs/${uploaderUid}/${commercialInvoiceId}/${Date.now()}_${id.slice(0, 8)}_${safeName}`;
  const storage = getStorage(firebaseApp);
  const r = ref(storage, path);
  await uploadBytes(r, blob, { contentType });
  const downloadUrl = await getDownloadURL(r);

  return {
    downloadUrl,
    fileName: file.name,
    contentType: file.type || contentType,
    storagePath: path,
  };
}
