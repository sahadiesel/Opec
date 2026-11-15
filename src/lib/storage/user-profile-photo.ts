import type { FirebaseApp } from 'firebase/app';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getNamedStorage } from '@/firebase/named-storage';

/** Replace this user's profile photo. The blob must already be at most 100 KB. */
export async function uploadUserProfilePhoto(firebaseApp: FirebaseApp, userId: string, blob: Blob): Promise<string> {
  const safeId = userId.replace(/[^\w-]/g, '');
  if (!safeId) throw new Error('ไม่พบรหัสผู้ใช้');
  const storage = getNamedStorage(firebaseApp);
  const r = ref(storage, `user_photos/${safeId}.jpg`);
  await uploadBytes(r, blob, { contentType: 'image/jpeg' });
  const url = await getDownloadURL(r);
  return `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
}
