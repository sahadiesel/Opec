import type { FirebaseApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { compressImageFileToMaxSize } from '@/lib/storage/image-compress';

const MAX_AFTER_COMPRESS = 800 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const STORAGE_PATH: Record<'logo' | 'stamp', string> = {
  logo: 'company_profile_branding/document_header_logo',
  stamp: 'company_profile_branding/document_header_stamp',
};

export function validateDocumentHeaderImageFile(file: File): string | null {
  if (!IMAGE_TYPES.has(file.type)) {
    return 'รองรับเฉพาะรูป JPEG, PNG, WebP';
  }
  if (file.size > 20 * 1024 * 1024) {
    return 'ไฟล์ต้นฉบับต้องไม่เกิน 20 MB';
  }
  return null;
}

/**
 * อัปโหลดโลโก้/ตรายางหัวเอกสาร — บีบอัดก่อน ใช้ path คงที่ (อัปโหลดซ้ำทับไฟล์เดิม)
 */
export async function uploadDocumentHeaderImage(
  firebaseApp: FirebaseApp,
  kind: 'logo' | 'stamp',
  file: File,
): Promise<string> {
  const err = validateDocumentHeaderImageFile(file);
  if (err) throw new Error(err);
  const blob = await compressImageFileToMaxSize(file, MAX_AFTER_COMPRESS);
  const contentType = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
  const path = STORAGE_PATH[kind];
  const storage = getStorage(firebaseApp);
  const r = ref(storage, path);
  await uploadBytes(r, blob, { contentType });
  return getDownloadURL(r);
}
