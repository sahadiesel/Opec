'use client';

import { doc } from 'firebase/firestore';
import { useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import type { User } from '@/lib/types';

/** รูปลายเซ็นที่ผู้ใช้อัปโหลดในหน้าจัดการผู้ใช้งาน */
export function useUserSignatureUrl(uid: string | null | undefined): string {
  const firestore = useFirestore();
  const id = (uid || '').trim();
  const ref = useMemoFirebase(() => (firestore && id ? doc(firestore, 'users', id) : null), [firestore, id]);
  const { data } = useDoc<User>(ref as never);
  return (data?.signatureImageUrl || '').trim();
}
