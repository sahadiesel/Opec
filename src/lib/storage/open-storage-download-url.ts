import type { FirebaseApp } from 'firebase/app';
import { getDownloadURL, getStorage, ref } from 'firebase/storage';

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

/**
 * ขอ download URL ใหม่จาก bucket ที่อยู่ในลิงก์เดิม
 * (รองรับไฟล์บนถังเก่า default และถัง opec-data-sg)
 */
export async function resolveFreshStorageDownloadUrl(
  app: FirebaseApp,
  url: string,
): Promise<string> {
  const raw = String(url || '').trim();
  if (!raw) throw new Error('ไม่มีลิงก์ไฟล์');

  const parsed = parseFirebaseStorageDownloadUrl(raw);
  if (!parsed) return raw;

  const tryBuckets = [
    parsed.bucket,
    // เผื่อ URL ชี้ถังผิดหลังย้ายข้อมูล — ลองถังที่แอปใช้อยู่ด้วย
  ];

  let lastErr: unknown;
  for (const bucket of tryBuckets) {
    try {
      const storage = getStorage(app, `gs://${bucket}`);
      return await getDownloadURL(ref(storage, parsed.path));
    } catch (e) {
      lastErr = e;
    }
  }

  try {
    return await getDownloadURL(ref(getNamedStorage(app), parsed.path));
  } catch (e) {
    lastErr = e;
  }

  throw lastErr instanceof Error ? lastErr : new Error('เปิดไฟล์จาก Storage ไม่สำเร็จ');
}

/** เปิดหลักฐานในแท็บใหม่ — รีเฟรช token ผ่าน SDK ก่อน (กัน 403 เมื่อเปิดลิงก์ตรง) */
export async function openStorageDownloadUrl(app: FirebaseApp, url: string): Promise<void> {
  const fresh = await resolveFreshStorageDownloadUrl(app, url);
  const win = window.open(fresh, '_blank', 'noopener,noreferrer');
  if (!win) {
    // ป๊อปอัปถูกบล็อก — นำทางแท็บปัจจุบัน
    window.location.assign(fresh);
  }
}
