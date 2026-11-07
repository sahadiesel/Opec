import type { FirebaseApp } from 'firebase/app';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getNamedStorage } from '@/firebase/named-storage';

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
