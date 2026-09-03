'use client';

import { doc } from 'firebase/firestore';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';

/** ตรงกับหน้า Document Header Profile — `system/company_profile` */
export type CompanyDocumentProfileNames = {
  companyNameTh?: string;
  companyNameEn?: string;
  taxId?: string;
  phone?: string;
  email?: string;
  /** ที่อยู่ภาษาอังกฤษ (ใช้ในเอกสาร EN) */
  addressLine1?: string;
  /** ที่อยู่ภาษาไทย (ใช้ในเอกสาร TH) */
  addressLine2?: string;
  /** URL รูปโลโก้สำหรับหัวเอกสาร (System > Document Header) */
  documentHeaderLogoUrl?: string;
  /** URL รูปตรายาง (ถ้ามี) */
  documentHeaderStampUrl?: string;
  whtCertificateDisplay?: {
    authorizedSignerName?: string;
    signerPosition?: string;
  };
};

/** ที่อยู่บริษัทภาษาไทยสำหรับเอกสาร TH — ตรงกับ `companyProfileAddressForPrintLocale(..., 'th')` */
export function companyProfileThaiAddress(
  profile: Pick<CompanyDocumentProfileNames, 'addressLine1' | 'addressLine2'> | null | undefined,
): string {
  const th = (profile?.addressLine2 || '').trim();
  const en = (profile?.addressLine1 || '').trim();
  return th || en || '';
}

export function resolveOpecLessorFromCompanyProfile(
  profile: CompanyDocumentProfileNames | null | undefined,
  fallbackName = 'บริษัท โอเปค เอ็นจิเนียริ่ง แอนด์ แมนเนจเม้นท์ จำกัด',
): {
  lessorName: string;
  lessorAddress: string;
  lessorTaxId: string;
  lessorAuthorizedSignatory: string;
} {
  return {
    lessorName: profile?.companyNameTh?.trim() || fallbackName,
    lessorAddress: companyProfileThaiAddress(profile),
    lessorTaxId: profile?.taxId?.trim() || '',
    lessorAuthorizedSignatory: profile?.whtCertificateDisplay?.authorizedSignerName?.trim() || '',
  };
}

/**
 * โหลดโปรไฟล์บริษัทสำหรับหัวเอกสาร / คู่สัญญา OPEC (สลิป, ใบเสนอราคา, สัญญาเช่า ฯลฯ)
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
