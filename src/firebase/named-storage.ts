import type { FirebaseApp } from 'firebase/app';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

import { FIREBASE_STORAGE_BUCKET } from '@/firebase/config';

/** ถังไฟล์สิงคโปร์ `gs://opec-data-sg` — ไม่ใช้ถัง default ที่มากับแอป */
export function getNamedStorage(app: FirebaseApp): FirebaseStorage {
  const bucket = FIREBASE_STORAGE_BUCKET.startsWith('gs://')
    ? FIREBASE_STORAGE_BUCKET
    : `gs://${FIREBASE_STORAGE_BUCKET}`;
  return getStorage(app, bucket);
}
