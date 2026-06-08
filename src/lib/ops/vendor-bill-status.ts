import type { PurchaseVendorBill, PurchaseVendorBillStatus } from '@/lib/types';

/** จ่ายครบแล้ว (รวมใบที่ปิดเรื่องเอกสารแล้ว) */
export function isVendorBillPaymentComplete(
  bill: Pick<PurchaseVendorBill, 'status' | 'paidAt'>,
): boolean {
  if (bill.status === 'PAID' || bill.status === 'CLOSED') return true;
  return typeof bill.paidAt === 'number' && bill.paidAt > 0;
}

/** จ่ายครบและปิดเรื่องเอกสารครบแล้ว */
export function isVendorBillFullyClosed(
  bill: Pick<PurchaseVendorBill, 'status' | 'vendorBillDocumentationClosed'>,
): boolean {
  return bill.status === 'CLOSED' || (!!bill.vendorBillDocumentationClosed && bill.status === 'PAID');
}

/** สถานะแสดงผล — รองรับข้อมูลเก่าที่ยังเป็น PAID แต่ปิดเอกสารแล้ว */
export function effectiveVendorBillStatus(
  bill: Pick<PurchaseVendorBill, 'status' | 'vendorBillDocumentationClosed'>,
): PurchaseVendorBillStatus {
  if (isVendorBillFullyClosed(bill)) return 'CLOSED';
  return bill.status;
}

export function vendorBillStatusAfterPayment(
  bill: Pick<PurchaseVendorBill, 'vendorBillDocumentationClosed'>,
): 'PAID' | 'CLOSED' {
  return bill.vendorBillDocumentationClosed ? 'CLOSED' : 'PAID';
}
