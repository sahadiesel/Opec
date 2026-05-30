import { getAuth } from 'firebase/auth';
import type { FirestoreError } from 'firebase/firestore';

let loggingOut = false;

/** ตั้งก่อน signOut — snapshot ที่ error ระหว่าง unmount ไม่ควรแสดง overlay */
export function markFirestoreLoggingOut(): void {
  loggingOut = true;
}

export function clearFirestoreLoggingOut(): void {
  loggingOut = false;
}

export function isFirestoreLoggingOut(): boolean {
  return loggingOut;
}

function isAuthSignedOut(): boolean {
  try {
    return getAuth().currentUser === null;
  } catch {
    return false;
  }
}

/**
 * ระหว่าง signOut snapshot อาจได้ permission-denied ขณะ auth เป็น null อยู่แล้ว —
 * ไม่ควรยิง global error overlay / console.error จาก Firebase SDK
 */
export function shouldSuppressFirestorePermissionError(error: FirestoreError | { code?: string }): boolean {
  if (error.code !== 'permission-denied') return false;
  return isFirestoreLoggingOut() || isAuthSignedOut();
}

/** @deprecated use shouldSuppressFirestorePermissionError */
export function isPermissionDeniedWhileLoggedOut(error: FirestoreError): boolean {
  return shouldSuppressFirestorePermissionError(error);
}
