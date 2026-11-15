import type { FirebaseApp } from 'firebase/app';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getNamedStorage } from '@/firebase/named-storage';
import {
  publicStorageMediaUrl,
  userIdFromSignatureUrl,
  userSignatureStoragePath,
} from '@/lib/storage/print-signature-image';

/** อัปโหลดรูปลายเซ็นที่ครอบกรอบแล้ว — ทับไฟล์เดิมของผู้ใช้คนนั้น */
export async function uploadUserSignatureImage(
  firebaseApp: FirebaseApp,
  userId: string,
  blob: Blob,
): Promise<string> {
  const safeId = userId.replace(/[^\w-]/g, '');
  if (!safeId) throw new Error('ไม่พบรหัสผู้ใช้');
  const storage = getNamedStorage(firebaseApp);
  const r = ref(storage, `user_signatures/${safeId}.png`);
  await uploadBytes(r, blob, { contentType: 'image/png' });
  const url = await getDownloadURL(r);
  return `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
}

/**
 * ลิงก์แสดงลายเซ็นจากถังสิงคโปร์ตาม path คงที่
 * ลิงก์ที่บันทึกไว้ก่อนย้ายไฟล์อาจยังชี้ถังเดิม จึงไม่ใช้ลิงก์นั้นเป็นหลัก
 */
export async function resolveUserSignatureDisplayUrl(
  firebaseApp: FirebaseApp,
  userId: string,
  storedUrl?: string | null,
): Promise<string> {
  const stored = (storedUrl || '').trim();
  const path =
    userSignatureStoragePath(userId) || userSignatureStoragePath(userIdFromSignatureUrl(stored));
  if (!path) return stored;
  try {
    const storage = getNamedStorage(firebaseApp);
    const url = await getDownloadURL(ref(storage, path));
    return `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
  } catch {
    return publicStorageMediaUrl(path);
  }
}
