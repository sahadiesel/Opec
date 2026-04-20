import type { FirebaseApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import type { WaveMonthTimesheetPhotoAttachment } from '@/lib/types';
import { compressImageFileToMaxSize } from '@/lib/storage/image-compress';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_COMPRESSED = 500 * 1024;
const MAX_IMAGE_ORIGINAL_BYTES = 25 * 1024 * 1024;
/** PDF ไม่บีบฝั่ง client — จำกัดขนาดต้นทาง */
const MAX_PDF_BYTES = 10 * 1024 * 1024;

function safeFileSegment(name: string): string {
  return name.replace(/[^\w.\-()\u0E00-\u0E7F]+/g, '_').slice(0, 80) || 'file';
}

/**
 * ตรวจไฟล์แนบ timesheet รายเดือน — รูป (JPEG/PNG/WebP) หรือ PDF
 */
export function validateWaveMonthTimesheetFile(file: File): string | null {
  if (IMAGE_TYPES.has(file.type)) {
    if (file.size > MAX_IMAGE_ORIGINAL_BYTES) {
      return 'ไฟล์รูปต้นฉบับใหญ่เกินไป (จำกัด ~25 MB ก่อนบีบอัด)';
    }
    return null;
  }
  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF_BYTES) {
      return `PDF ต้องไม่เกิน ${Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB`;
    }
    return null;
  }
  return 'รองรับเฉพาะรูป JPEG, PNG, WebP หรือไฟล์ PDF';
}

/** @deprecated ใช้ validateWaveMonthTimesheetFile */
export function validateWaveMonthTimesheetImageFile(file: File): string | null {
  return validateWaveMonthTimesheetFile(file);
}

/**
 * อัปโหลดรูป/PDF timesheet รายเดือน — รูปใหญ่จะบีบให้ไม่เกิน ~500 KB; PDF อัปโหลดตามขนาด (ไม่เกินเพดาน)
 */
export async function uploadWaveMonthTimesheetPhoto(
  firebaseApp: FirebaseApp,
  reviewDocId: string,
  file: File,
): Promise<WaveMonthTimesheetPhotoAttachment> {
  const err = validateWaveMonthTimesheetFile(file);
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

  const path = `wave_month_timesheet_photos/${reviewDocId}/${Date.now()}_${id.slice(0, 8)}_${safeName}`;
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

export async function deleteWaveMonthTimesheetPhotoFile(firebaseApp: FirebaseApp, storagePath: string): Promise<void> {
  const storage = getStorage(firebaseApp);
  await deleteObject(ref(storage, storagePath));
}
