import type { FirestoreError } from 'firebase/firestore';

/** Firestore แจ้ง failed-precondition เมื่อ query ต้องการ composite index */
export function isFirestoreMissingIndexError(error: unknown): error is FirestoreError {
  if (!error || typeof error !== 'object') return false;
  const e = error as FirestoreError;
  if (e.code !== 'failed-precondition') return false;
  const msg = String(e.message || '');
  return msg.includes('index') || msg.includes('requires an index');
}

/** ดึง URL สร้าง index จากข้อความ error ของ Firebase (ถ้ามี) */
export function extractFirestoreIndexConsoleUrl(message: string): string | null {
  const m = message.match(/https:\/\/console\.firebase\.google\.com[^\s"'<>]+/);
  if (!m) return null;
  return m[0].replace(/[.,;)\]]+$/, '');
}
