'use client';

/**
 * Fan-out reader สำหรับ `purchase_orders/{poId}/po_lines/{lineId}`
 *
 * ใช้แทน `collectionGroup('po_lines')` ในหน้าที่ต้องอ่าน PO Lines ของหลาย PO พร้อมกัน
 * (Firestore rules ใน production ยังไม่ได้ deploy `match /{path=**}/po_lines/{lineId}`
 * collection-group read — แต่ rule per-PO subcollection `match /purchase_orders/{poId}/po_lines/{lineId}`
 * มีอยู่แล้วและผ่าน internal/staff gate ปกติ)
 *
 * รูปแบบการใช้:
 *   const { data: allPOLines, isLoading, error } = usePoLinesFanout(activePOs?.map(p => p.id));
 *
 * - ส่งรายการ poIds (อาจเป็น undefined ขณะรอข้อมูล PO เพื่อหลีกเลี่ยง subscribe เปล่า)
 * - subscribe `onSnapshot` ทีละ PO เพื่อรองรับ real-time
 * - คืน `data: POLine[]` รวมจากทุก PO และ error string ถ้าตัวใดถูก deny
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import type { Unsubscribe } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { POLine } from '@/lib/types';

export interface PoLinesFanoutResult {
  data: POLine[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function usePoLinesFanout(poIds: string[] | undefined | null): PoLinesFanoutResult {
  const firestore = useFirestore();
  const [linesByPo, setLinesByPo] = useState<Record<string, POLine[]>>({});
  const [pendingPos, setPendingPos] = useState<Set<string>>(new Set());
  const [error, setError] = useState<Error | null>(null);
  const unsubsRef = useRef<Map<string, Unsubscribe>>(new Map());

  const idsKey = useMemo(() => {
    if (!poIds || poIds.length === 0) return '';
    return [...new Set(poIds.filter(Boolean))].sort().join('|');
  }, [poIds]);

  useEffect(() => {
    if (!firestore) return;
    const ids = idsKey ? idsKey.split('|') : [];
    const wanted = new Set(ids);

    /** ปลด subscriber ของ PO ที่ไม่ต้องการแล้ว และล้างข้อมูลส่วนนั้นออก */
    for (const [id, unsub] of unsubsRef.current.entries()) {
      if (!wanted.has(id)) {
        try {
          unsub();
        } catch {
          /* noop */
        }
        unsubsRef.current.delete(id);
        setLinesByPo((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    }

    /** เพิ่ม subscriber ใหม่สำหรับ PO ที่เพิ่งเข้ามา */
    const newlyPending = new Set<string>();
    for (const id of ids) {
      if (unsubsRef.current.has(id)) continue;
      newlyPending.add(id);
      const ref = collection(firestore, `purchase_orders/${id}/po_lines`);
      const unsub = onSnapshot(
        ref,
        (snap) => {
          const rows: POLine[] = [];
          for (const d of snap.docs) {
            rows.push({ ...(d.data() as POLine), id: d.id });
          }
          setLinesByPo((prev) => ({ ...prev, [id]: rows }));
          setPendingPos((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          setError(null);
        },
        (err) => {
          setError(err as Error);
          setPendingPos((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        },
      );
      unsubsRef.current.set(id, unsub);
    }

    if (newlyPending.size > 0) {
      setPendingPos((prev) => {
        const next = new Set(prev);
        for (const id of newlyPending) next.add(id);
        return next;
      });
    }
  }, [firestore, idsKey]);

  /** clean-up ทั้งหมดเมื่อ component unmount */
  useEffect(() => {
    const map = unsubsRef.current;
    return () => {
      for (const unsub of map.values()) {
        try {
          unsub();
        } catch {
          /* noop */
        }
      }
      map.clear();
    };
  }, []);

  const data = useMemo<POLine[] | undefined>(() => {
    if (!idsKey) return [];
    const ids = idsKey.split('|');
    if (ids.some((id) => !(id in linesByPo))) return undefined;
    const out: POLine[] = [];
    for (const id of ids) {
      const rows = linesByPo[id];
      if (rows) out.push(...rows);
    }
    return out;
  }, [idsKey, linesByPo]);

  return {
    data,
    isLoading: pendingPos.size > 0 || (!!idsKey && data === undefined),
    error,
  };
}
