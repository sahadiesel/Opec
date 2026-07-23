import type { FirebaseApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import type { CommercialInvoiceAttachment } from '@/lib/types';
import { compressImageFileToMaxSize } from '@/lib/storage/image-compress';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Max files per commercial invoice (supporting docs for customer review). */
export const MAX_COMMERCIAL_INVOICE_ATTACHMENTS = 5;
/** Per-file limit after upload (PDF as-is; images compressed to this). */
export const MAX_COMMERCIAL_INVOICE_ATTACHMENT_BYTES = 2 * 1024 * 1024;
/** Reject huge originals before canvas compress (browser safety). */
const MAX_IMAGE_ORIGINAL_BYTES = 25 * 1024 * 1024;

export const COMMERCIAL_INVOICE_ATTACHMENT_MIME_ACCEPT =
  'image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf';

function safeFileSegment(name: string): string {
  return name.replace(/[^\w.\-()\u0E00-\u0E7F]+/g, '_').slice(0, 80) || 'file';
}

/**
 * Returns a Thai error message, or null if OK.
 * Oversize → ask user to resize/compress before retrying.
 */
export function validateCommercialInvoiceAttachmentFile(file: File): string | null {
  if (IMAGE_TYPES.has(file.type)) {
    if (file.size > MAX_IMAGE_ORIGINAL_BYTES) {
      return `ไฟล์รูปใหญ่เกินไป (จำกัด ~25 MB ก่อนบีบอัด) — โปรดลดขนาดหรือความละเอียดแล้วลองใหม่`;
    }
    return null;
  }
  if (file.type === 'application/pdf') {
    if (file.size > MAX_COMMERCIAL_INVOICE_ATTACHMENT_BYTES) {
      const mb = MAX_COMMERCIAL_INVOICE_ATTACHMENT_BYTES / (1024 * 1024);
      return `ไฟล์ PDF ต้องไม่เกิน ${mb} MB — โปรดลดขนาดไฟล์แล้วลองใหม่`;
    }
    return null;
  }
  return 'รองรับเฉพาะรูป JPEG, PNG, WebP หรือไฟล์ PDF';
}

export async function uploadCommercialInvoiceAttachment(
  firebaseApp: FirebaseApp,
  invoiceId: string,
  file: File,
  uid: string,
  displayName: string,
): Promise<CommercialInvoiceAttachment> {
  const err = validateCommercialInvoiceAttachmentFile(file);
  if (err) throw new Error(err);

  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

  let blob: Blob;
  let contentType: string;
  let safeName: string;

  if (IMAGE_TYPES.has(file.type)) {
    blob = await compressImageFileToMaxSize(file, MAX_COMMERCIAL_INVOICE_ATTACHMENT_BYTES);
    if (blob.size > MAX_COMMERCIAL_INVOICE_ATTACHMENT_BYTES) {
      throw new Error(
        `ไฟล์รูปยังใหญ่เกิน ${MAX_COMMERCIAL_INVOICE_ATTACHMENT_BYTES / (1024 * 1024)} MB หลังบีบอัด — โปรดลดขนาดแล้วลองใหม่`,
      );
    }
    contentType = blob.type || 'image/jpeg';
    safeName = safeFileSegment(file.name.replace(/\.[^.]+$/, '') + '.jpg');
  } else {
    blob = file;
    contentType = 'application/pdf';
    safeName = safeFileSegment(file.name.replace(/\.[^.]+$/, '') + '.pdf');
  }

  const path = `commercial_invoice_attachments/${invoiceId}/${Date.now()}_${id.slice(0, 8)}_${safeName}`;
  const storage = getStorage(firebaseApp);
  const r = ref(storage, path);
  await uploadBytes(r, blob, { contentType });
  const downloadUrl = await getDownloadURL(r);

  return {
    id,
    storagePath: path,
    downloadUrl,
    fileName: file.name,
    contentType: file.type || contentType,
    size: blob.size,
    uploadedAt: Date.now(),
    uploadedByUid: uid,
    uploadedByName: displayName,
  };
}

export async function deleteCommercialInvoiceAttachmentFile(
  firebaseApp: FirebaseApp,
  storagePath: string,
): Promise<void> {
  const storage = getStorage(firebaseApp);
  await deleteObject(ref(storage, storagePath));
}
