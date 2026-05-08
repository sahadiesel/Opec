'use client';

import StoreVendorBillDetailPage from '@/app/store/vendor-bills/[id]/page';

/** รายละเอียดใบรับวางบิลเดียวกับคลัง — URL _under /ap-bills สำหรับเมนูบัญชี */
export default function AccountingVendorBillDetailPage(props: { params: Promise<{ id: string }> }) {
  return <StoreVendorBillDetailPage {...props} />;
}
