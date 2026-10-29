import type { DocumentData, UpdateData } from 'firebase/firestore';

/** Type-only: payloads ที่ประกอบเป็น Record ก่อนส่งเข้า updateDoc / WriteBatch.update */
export function asFirestoreUpdate(data: Record<string, unknown>): UpdateData<DocumentData> {
  return data as UpdateData<DocumentData>;
}
