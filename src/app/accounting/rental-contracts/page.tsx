'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** เส้นทางเดิม — เปลี่ยนไปยัง hub การจัดการสัญญา */
export default function RentalContractsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/accounting/contracts');
  }, [router]);
  return null;
}
