'use client';

import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { companyLogoUrlForPrint } from '@/lib/storage/print-signature-image';

/**
 * โลโก้ชุดเดียวกับหัวเอกสาร — อ่านจาก Document Header Profile
 * ถ้ายังไม่ได้ตั้งโลโก้ในโปรไฟล์ ใช้ไฟล์สำรองบนเว็บ
 */
export function CompanyLogoMark({
  className,
  fallbackSrc,
  alt = 'OPEC',
}: {
  className?: string;
  fallbackSrc: string;
  alt?: string;
}) {
  const { profile } = useCompanyDocumentProfile();
  const src = companyLogoUrlForPrint(profile) || fallbackSrc;
  return <img src={src} alt={alt} className={className} />;
}
