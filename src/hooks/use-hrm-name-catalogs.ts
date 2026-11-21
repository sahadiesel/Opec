'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { BankNameCatalogItem, SsoHospitalCatalogItem } from '@/lib/types';

/**
 * โหลดทะเบียนชื่อธนาคารแบบ one-shot (ไม่ใช้ onSnapshot)
 * ดึงทั้งชุดแล้วกรอง isActive ฝั่ง client — ไม่พึ่ง composite index (isActive + sortOrder)
 * หาก permission ไม่พอ คืน [] โดยไม่ throw เพื่อไม่ให้หน้า worker/office พังทั้งหน้า
 */
export function useActiveBankNameCatalog(): BankNameCatalogItem[] {
  const firestore = useFirestore();
  const [rows, setRows] = useState<BankNameCatalogItem[]>([]);

  useEffect(() => {
    if (!firestore) {
      setRows([]);
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const q = query(collection(firestore, 'bank_name_catalog'), orderBy('sortOrder', 'asc'));
        const snap = await getDocs(q);
        if (cancel) return;
        const all = snap.docs.map(
          (d) =>
            ({
              id: d.id,
              ...d.data(),
            }) as BankNameCatalogItem,
        );
        setRows(all.filter((b) => b.isActive !== false));
      } catch {
        if (!cancel) setRows([]);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [firestore]);

  return rows;
}

/** โรงพยาบาล สปส. (ใช้งาน) — เหมือนกัน ไม่ทำลายทั้งหน้าถ้า list ไม่ได้ */
export function useActiveSsoHospitalCatalog(): SsoHospitalCatalogItem[] {
  const firestore = useFirestore();
  const [rows, setRows] = useState<SsoHospitalCatalogItem[]>([]);

  useEffect(() => {
    if (!firestore) {
      setRows([]);
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const q = query(collection(firestore, 'sso_hospital_catalog'), orderBy('sortOrder', 'asc'));
        const snap = await getDocs(q);
        if (cancel) return;
        const all = snap.docs.map(
          (d) =>
            ({
              id: d.id,
              ...d.data(),
            }) as SsoHospitalCatalogItem,
        );
        setRows(all.filter((h) => h.isActive !== false));
      } catch {
        if (!cancel) setRows([]);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [firestore]);

  return rows;
}
