import { getAuth } from 'firebase/auth';
import type { FirestoreError } from 'firebase/firestore';

/**
 * ระหว่าง signOut snapshot อาจได้ permission-denied ขณะ auth เป็น null อยู่แล้ว —
 * ไม่ควรยิง global error overlay
 */
export function isPermissionDeniedWhileLoggedOut(error: FirestoreError): boolean {
  if (error.code !== 'permission-denied') return false;
  try {
    return getAuth().currentUser === null;
  } catch {
    return false;
  }
}
