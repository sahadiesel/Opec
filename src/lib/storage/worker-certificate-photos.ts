import type { FirebaseApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { WaveMonthTimesheetPhotoAttachment } from '@/lib/types';
import { compressImageFileToMaxSize } from '@/lib/storage/image-compress';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_IMAGE_COMPRESSED = 500 * 1024;
const MAX_IMAGE_ORIGINAL_BYTES = 25 * 1024 * 1024;

function safeFileSegment(name: string): string {
  return name.replace(/[^\w.\-()\u0E00-\u0E7F]+/g, '_').slice(0, 80) || 'photo';
}

export function validateWorkerCertificatePhotoFile(file: File): string | null {
  if (!file.type.startsWith('image/') && !IMAGE_TYPES.has(file.type)) {
    return 'รองรับเฉพาะไฟล์รูปภาพ (JPEG, PNG, WebP)';
  }
  if (file.size > MAX_IMAGE_ORIGINAL_BYTES) {
    return 'ไฟล์รูปต้นฉบับใหญ่เกินไป (จำกัด ~25 MB ก่อนบีบอัด)';
  }
  return null;
}

/** อัปโหลดรูปใบเซอร์ — บีบให้ไม่เกิน 500 KB */
export async function uploadWorkerCertificatePhoto(
  firebaseApp: FirebaseApp,
  workerId: string,
  certificateCode: string,
  file: File,
): Promise<WaveMonthTimesheetPhotoAttachment> {
  const err = validateWorkerCertificatePhotoFile(file);
  if (err) throw new Error(err);

  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

  const blob = await compressImageFileToMaxSize(file, MAX_IMAGE_COMPRESSED);
  const contentType = blob.type || 'image/jpeg';
  const safeCode = safeFileSegment(certificateCode || 'cert');
  const safeName = safeFileSegment(file.name.replace(/\.[^.]+$/, '') + '.jpg');
  const path = `worker_certificate_photos/${workerId}/${safeCode}/${Date.now()}_${id.slice(0, 8)}_${safeName}`;

  const storage = getStorage(firebaseApp);
  const r = ref(storage, path);
  await uploadBytes(r, blob, { contentType });
  const downloadUrl = await getDownloadURL(r);

  return {
    id,
    storagePath: path,
    downloadUrl,
    fileName: file.name,
    contentType,
    uploadedAt: Date.now(),
  };
}
