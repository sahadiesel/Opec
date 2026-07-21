'use client';

import { PurchaseVendorBillsList } from '@/components/purchases/purchase-vendor-bills-list';

/** คิวรอจ่ายเจ้าหนี้ — ชุดข้อมูลเดียวกับ `/ap-bills` (purchase_vendor_bills) เปิดแท็บ «รอจ่าย» เป็นค่าเริ่มต้น ทำจ่ายได้ทั้งสองที่ */
export default function VendorBillsPayoutPage() {
  return <PurchaseVendorBillsList mode="accounting-payout" />;
}
