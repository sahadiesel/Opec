'use client';

import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
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

/**
 * เหมือน `useUserSignatureUrl` แต่บอกได้ว่าอ่านโปรไฟล์เสร็จแล้วหรือยัง
 * — แยก「ยังโหลดไม่เสร็จ」ออกจาก「ไม่มีลายเซ็น」เพื่อไม่ล้างติ๊กที่จำไว้ระหว่างรอข้อมูล
 */
export function useUserSignatureState(uid: string | null | undefined): {
  url: string;
  /** อ่านโปรไฟล์ของ `uid` นี้เสร็จแล้ว (รวมกรณีไม่พบ/อ่านไม่ได้ = ไม่มีลายเซ็น) */
  loaded: boolean;
} {
  const firestore = useFirestore();
  const id = (uid || '').trim();
  const [result, setResult] = useState<{ id: string; url: string } | null>(null);

  useEffect(() => {
    if (!firestore || !id) return;
    return onSnapshot(
      doc(firestore, 'users', id),
      (snap) =>
        setResult({ id, url: String((snap.data() as User | undefined)?.signatureImageUrl || '').trim() }),
      () => setResult({ id, url: '' }),
    );
  }, [firestore, id]);

  const current = id && result?.id === id ? result : null;
  return { url: current?.url ?? '', loaded: current != null };
}

function collapseSpaces(value: string | null | undefined): string {
  return (value || '').trim().replace(/\s+/g, ' ');
}

/**
 * ลายเซ็นของผู้จัดทำเอกสาร
 * ใช้รหัสผู้ใช้ก่อน เอกสารเก่าบางใบเก็บไว้แค่ชื่อ (เช่น ใบเสนอราคาที่ไม่มี createdByUid)
 * จึงค้นผู้ใช้จากชื่อที่แสดง แล้วใช้ลายเซ็นในโปรไฟล์ของคนนั้น
 */
export function useResolvedUserSignature(
  uid: string | null | undefined,
  name: string | null | undefined,
): { uid: string; url: string; loaded: boolean } {
  const uidTrim = (uid || '').trim();
  const nameTrim = collapseSpaces(name);
  const byUid = useUserSignatureState(uidTrim);
  const firestore = useFirestore();
  const [byName, setByName] = useState<{ name: string; uid: string; url: string } | null>(null);

  useEffect(() => {
    if (!firestore || uidTrim || !nameTrim) return;
    return onSnapshot(
      query(collection(firestore, 'users'), where('displayName', '==', nameTrim)),
      (snap) => {
        const rows = snap.docs.map((d) => ({ ...(d.data() as User), id: d.id }));
        const hit = rows.find((u) => (u.signatureImageUrl || '').trim()) || rows[0];
        setByName({ name: nameTrim, uid: hit?.id || '', url: (hit?.signatureImageUrl || '').trim() });
      },
      () => setByName({ name: nameTrim, uid: '', url: '' }),
    );
  }, [firestore, uidTrim, nameTrim]);

  if (uidTrim) return { uid: uidTrim, url: byUid.url, loaded: byUid.loaded };
  if (!nameTrim) return { uid: '', url: '', loaded: true };
  const current = byName?.name === nameTrim ? byName : null;
  return { uid: current?.uid ?? '', url: current?.url ?? '', loaded: current != null };
}
