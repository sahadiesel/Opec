import type { FirebaseApp } from 'firebase/app';
import { getDownloadURL, getStorage, ref } from 'firebase/storage';

import { FIREBASE_STORAGE_BUCKET } from '@/firebase/config';
import { getNamedStorage } from '@/firebase/named-storage';

/** แยก bucket + object path จาก download URL ของ Firebase Storage */
export function parseFirebaseStorageDownloadUrl(
  url: string,
): { bucket: string; path: string } | null {
  try {
    const u = new URL(String(url || '').trim());
    const m = u.pathname.match(/\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!m) return null;
    return {
      bucket: decodeURIComponent(m[1]),
      path: decodeURIComponent(m[2]),
    };
  } catch {
    return null;
  }
}

function normalizeBucket(bucket: string): string {
  return bucket.replace(/^gs:\/\//, '').trim();
}

async function getDownloadUrlFromBucket(
  app: FirebaseApp,
  bucket: string,
  path: string,
): Promise<string> {
  const storage = getStorage(app, `gs://${normalizeBucket(bucket)}`);
  return getDownloadURL(ref(storage, path));
}

/**
 * ขอ download URL จาก storagePath / downloadUrl เดิม
 * ลองถังหลัก opec-data-sg ก่อน แล้วค่อยถังตาม URL เก่า
 */
export async function resolveStorageAttachmentUrl(
  app: FirebaseApp,
  opts: { downloadUrl?: string | null; storagePath?: string | null },
): Promise<string> {
  const pathHint = String(opts.storagePath || '').trim();
  const rawUrl = String(opts.downloadUrl || '').trim();
  const parsed = rawUrl ? parseFirebaseStorageDownloadUrl(rawUrl) : null;
  const objectPath = pathHint || parsed?.path || '';

  if (!objectPath && rawUrl) return rawUrl;
  if (!objectPath) throw new Error('ไม่มีลิงก์ไฟล์');

  const primaryBucket = normalizeBucket(FIREBASE_STORAGE_BUCKET);
  const buckets: string[] = [primaryBucket];
  if (parsed?.bucket) {
    const fromUrl = normalizeBucket(parsed.bucket);
    if (fromUrl && fromUrl !== primaryBucket) buckets.push(fromUrl);
  }

  let lastErr: unknown;
  for (const bucket of buckets) {
    try {
      return await getDownloadUrlFromBucket(app, bucket, objectPath);
    } catch (e) {
      lastErr = e;
    }
  }

  // สำรอง: getNamedStorage โดยตรง (กรณี config แปลก)
  try {
    return await getDownloadURL(ref(getNamedStorage(app), objectPath));
  } catch (e) {
    lastErr = e;
  }

  if (rawUrl) return rawUrl;
  throw lastErr instanceof Error ? lastErr : new Error('เปิดไฟล์จาก Storage ไม่สำเร็จ');
}

/**
 * ขอ download URL ใหม่จาก bucket ที่อยู่ในลิงก์เดิม
 * (รองรับไฟล์บนถังเก่า default และถัง opec-data-sg)
 */
export async function resolveFreshStorageDownloadUrl(
  app: FirebaseApp,
  url: string,
): Promise<string> {
  return resolveStorageAttachmentUrl(app, { downloadUrl: url });
}

/** เปิดหลักฐานในแท็บใหม่ — รีเฟรช token ผ่าน SDK ก่อน (กัน 403 เมื่อเปิดลิงก์ตรง) */
export async function openStorageDownloadUrl(
  app: FirebaseApp,
  url: string,
  storagePath?: string | null,
): Promise<void> {
  const fresh = await resolveStorageAttachmentUrl(app, {
    downloadUrl: url,
    storagePath,
  });
  const win = window.open(fresh, '_blank', 'noopener,noreferrer');
  if (!win) {
    // ป๊อปอัปถูกบล็อก — นำทางแท็บปัจจุบัน
    window.location.assign(fresh);
  }
}
