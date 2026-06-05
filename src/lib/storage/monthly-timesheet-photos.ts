import type { FirebaseApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import type { WaveMonthTimesheetPhotoAttachment } from '@/lib/types';
import { compressImageFileToMaxSize } from '@/lib/storage/image-compress';
import { validateWaveMonthTimesheetFile } from '@/lib/storage/wave-month-timesheet-photos';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_COMPRESSED = 500 * 1024;
export const MAX_MONTHLY_TIMESHEET_ATTACHMENTS = 4;

function safeFileSegment(name: string): string {
  return name.replace(/[^\w.\-()\u0E00-\u0E7F]+/g, '_').slice(0, 80) || 'file';
}

/** อัปโหลดรูป/PDF คู่เอกสาร timesheet รายเดือน (เลข TS-) — id โฟลเดอร์ = yyyy-MM */
export async function uploadMonthlyTimesheetPhoto(
  firebaseApp: FirebaseApp,
  yearMonth: string,
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

  const path = `monthly_timesheet_photos/${yearMonth}/${Date.now()}_${id.slice(0, 8)}_${safeName}`;
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

export async function deleteMonthlyTimesheetPhotoFile(
  firebaseApp: FirebaseApp,
  storagePath: string,
): Promise<void> {
  const storage = getStorage(firebaseApp);
  await deleteObject(ref(storage, storagePath));
}

/** แปลงชื่อไฟล์ใน Storage เป็น metadata แนบ — รูปแบบ `{timestamp}_{uuid8}_{safeName}` */
function attachmentFromStorageObject(
  storagePath: string,
  downloadUrl: string,
): WaveMonthTimesheetPhotoAttachment {
  const base = storagePath.split('/').pop() || 'file';
  const m = /^(\d+)_([a-f0-9]{8})_(.+)$/i.exec(base);
  const fileName = m ? m[3] : base;
  const uploadedAt = m && Number.isFinite(Number(m[1])) ? Number(m[1]) : Date.now();
  const id =
    m != null
      ? `${m[1]}_${m[2]}`
      : base.replace(/[^\w.-]+/g, '_').slice(0, 48) || `recovered_${uploadedAt}`;
  const lower = fileName.toLowerCase();
  const contentType = lower.endsWith('.pdf')
    ? 'application/pdf'
    : lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
  return { id, storagePath, downloadUrl, fileName, contentType, uploadedAt };
}

/**
 * อ่านไฟล์ใน `monthly_timesheet_photos/{yyyy-MM}/` จาก Storage
 */
export async function listMonthlyTimesheetPhotoAttachmentsFromStorage(
  firebaseApp: FirebaseApp,
  yearMonth: string,
): Promise<WaveMonthTimesheetPhotoAttachment[]> {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return [];
  const storage = getStorage(firebaseApp);
  const folderRef = ref(storage, `monthly_timesheet_photos/${yearMonth}`);
  try {
    const listing = await listAll(folderRef);
    const out: WaveMonthTimesheetPhotoAttachment[] = [];
    for (const item of listing.items) {
      const downloadUrl = await getDownloadURL(item);
      out.push(attachmentFromStorageObject(item.fullPath, downloadUrl));
    }
    return out.sort((a, b) => a.uploadedAt - b.uploadedAt);
  } catch {
    return [];
  }
}
