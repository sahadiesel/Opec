'use client';

import { PurchaseVendorBillsList } from '@/components/purchases/purchase-vendor-bills-list';

/** คิวรอจ่ายเจ้าหนี้ — รวมใบรับวางบิล PO + รอบค่าเช่าตามสัญญา · แท็บ «รอจ่าย» เป็นค่าเริ่มต้น */
export default function VendorBillsPayoutPage() {
  return <PurchaseVendorBillsList mode="accounting-payout" />;
}
