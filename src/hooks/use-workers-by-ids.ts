'use client';

import { useEffect, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import type { Worker } from '@/lib/types';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * โหลดเฉพาะ worker ตาม id (สูงสุด 10 ต่อ query ตามข้อจำกัด Firestore `in`)
 * — เหมาะกับพอร์ทัลลูกค้าที่ไม่สามารถ list ทั้ง workers ได้
 */
export function useWorkersByIds(firestore: Firestore | null, ids: string[]) {
  const [byId, setById] = useState<Map<string, Worker>>(new Map());

  useEffect(() => {
    if (!firestore) return;
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) {
      setById(new Map());
      return;
    }

    let cancelled = false;

    (async () => {
      const m = new Map<string, Worker>();
      for (const part of chunk(unique, 10)) {
        const q = query(collection(firestore, 'workers'), where(documentId(), 'in', part));
        try {
          const snap = await getDocs(q);
          snap.docs.forEach((d) => {
            m.set(d.id, { ...(d.data() as object), id: d.id } as Worker);
          });
        } catch (e) {
          console.error('useWorkersByIds', e);
        }
      }
      if (!cancelled) setById(m);
    })();

    return () => {
      cancelled = true;
    };
  }, [firestore, ids.join('|')]);

  return byId;
}
