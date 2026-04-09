import type { FirebaseApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import type { TaxInvoiceTimesheetAttachment } from '@/lib/types';
import { compressImageFileToMaxSize } from '@/lib/storage/image-compress';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** After compression, uploaded object must be at most this size (business rule). */
const MAX_UPLOAD_BYTES = 500 * 1024;
/** Reject originals larger than this before attempting canvas decode (browser safety). */
const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;

function safeFileSegment(name: string): string {
  return name.replace(/[^\w.\-()\u0E00-\u0E7F]+/g, '_').slice(0, 80) || 'image';
}

export function validateTimesheetImageFile(file: File): string | null {
  if (!ALLOWED_TYPES.has(file.type)) {
    return 'รองรับเฉพาะรูป JPEG, PNG, WebP';
  }
  if (file.size > MAX_ORIGINAL_BYTES) {
    return 'ไฟล์ต้นฉบับใหญ่เกินไป (จำกัด ~25 MB ก่อนบีบอัด) — ลองถ่ายความละเอียดต่ำลง';
  }
  return null;
}

export async function uploadTaxInvoiceTimesheetImage(
  firebaseApp: FirebaseApp,
  invoiceId: string,
  file: File,
  uid: string,
  displayName: string
): Promise<TaxInvoiceTimesheetAttachment> {
  const err = validateTimesheetImageFile(file);
  if (err) throw new Error(err);

  const blob = await compressImageFileToMaxSize(file, MAX_UPLOAD_BYTES);
  const contentType = blob.type || 'image/jpeg';

  const safe = safeFileSegment(file.name.replace(/\.[^.]+$/, '') + '.jpg');
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const path = `tax_invoice_attachments/${invoiceId}/${Date.now()}_${id.slice(0, 8)}_${safe}`;
  const storage = getStorage(firebaseApp);
  const r = ref(storage, path);
  await uploadBytes(r, blob, { contentType });
  const downloadUrl = await getDownloadURL(r);

  return {
    id,
    storagePath: path,
    downloadUrl,
    fileName: file.name,
    contentType: file.type,
    uploadedAt: Date.now(),
    uploadedByUid: uid,
    uploadedByName: displayName,
  };
}

export async function deleteTaxInvoiceAttachmentFile(firebaseApp: FirebaseApp, storagePath: string): Promise<void> {
  const storage = getStorage(firebaseApp);
  await deleteObject(ref(storage, storagePath));
}
