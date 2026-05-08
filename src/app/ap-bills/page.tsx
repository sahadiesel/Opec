'use client';

import { PurchaseVendorBillsList } from '@/components/purchases/purchase-vendor-bills-list';

/** รายการเดียวกับคลัง `/store/vendor-bills` — บัญชีเปิดจากเมนู AP ได้ */
export default function APBillsPage() {
  return <PurchaseVendorBillsList mode="accounting" />;
}
