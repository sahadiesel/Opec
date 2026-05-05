'use client';

import { useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

/**
 * ฟัง permission-error จากบริการที่ยัง emit อยู่ (เช่น use-permission-profiles, firestore-service)
 * — ไม่ throw ระดับ root เพราะทำให้ Next.js แสดงหน้าขาว "Application error" ทั้งไซต์
 */
export function FirebaseErrorListener() {
  useEffect(() => {
    const handleError = (err: FirestorePermissionError) => {
      console.error('[Firestore permission]', err.message, err.request ?? '');
    };
    errorEmitter.on('permission-error', handleError);
    return () => {
      errorEmitter.off('permission-error', handleError);
    };
  }, []);

  return null;
}
