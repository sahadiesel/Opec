'use client';

import { doc } from 'firebase/firestore';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';

/** ตรงกับหน้า Document Header Profile — `system/company_profile` */
export type CompanyDocumentProfileNames = {
  companyNameTh?: string;
  companyNameEn?: string;
};

/**
 * โหลดชื่อบริษัทสำหรับหัวเอกสาร (สลิป, ใบเสนอราคา ฯลฯ)
 */
export function useCompanyDocumentProfile() {
  const firestore = useFirestore();
  const profileRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'system', 'company_profile') : null),
    [firestore],
  );
  const { data, isLoading } = useDoc<CompanyDocumentProfileNames>(profileRef as any);
  return { profile: data ?? null, isLoading };
}
