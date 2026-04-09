'use client';

import { useEffect, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import { doc, getDoc } from 'firebase/firestore';
import type { Worker } from '@/lib/types';

/**
 * โหลด worker ทีละเอกสารด้วย getDoc — ถ้า worker หนึ่งคนไม่ผ่านกฎ security คนอื่นยังโหลดได้
 * (แบตช์ `where(documentId(), 'in', …)` ล้มทั้งก้อนถ้ามีสัก doc ไม่มีสิทธิ์)
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
      await Promise.all(
        unique.map(async (workerId) => {
          try {
            const snap = await getDoc(doc(firestore, 'workers', workerId));
            if (snap.exists()) {
              m.set(workerId, { ...(snap.data() as object), id: workerId } as Worker);
            }
          } catch {
            /* permission-denied or network — skip this worker */
          }
        })
      );
      if (!cancelled) setById(m);
    })();

    return () => {
      cancelled = true;
    };
  }, [firestore, ids.join('|')]);

  return byId;
}
