import type { FirebaseApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import type { WaveMonthTimesheetPhotoAttachment } from '@/lib/types';
import { compressImageFileToMaxSize } from '@/lib/storage/image-compress';
import { validateWaveMonthTimesheetFile } from '@/lib/storage/wave-month-timesheet-photos';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_COMPRESSED = 500 * 1024;

function safeFileSegment(name: string): string {
  return name.replace(/[^\w.\-()\u0E00-\u0E7F]+/g, '_').slice(0, 80) || 'file';
}

/**
 * อัปโหลดรูป/PDF สำหรับเอกสาร timesheet ราย **PO+เดือน** (ไม่ใช่ราย wave) — รูป > ~500KB บีบก่อนอัปโหลด
 */
export async function uploadPoMonthTimesheetPhoto(
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

  const path = `po_month_timesheet_photos/${reviewDocId}/${Date.now()}_${id.slice(0, 8)}_${safeName}`;
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

export async function deletePoMonthTimesheetPhotoFile(
  firebaseApp: FirebaseApp,
  storagePath: string,
): Promise<void> {
  const storage = getStorage(firebaseApp);
  await deleteObject(ref(storage, storagePath));
}
