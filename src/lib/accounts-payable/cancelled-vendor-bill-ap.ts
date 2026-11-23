/** เจ้าหนี้ที่ผูกกับใบรับวางบิลที่ยกเลิกแล้ว — ไม่นับเป็นยอดรอจ่าย */

export type CancelledVendorBillApKeys = {
  ids: Set<string>;
  documentNos: Set<string>;
};

export function cancelledVendorBillApKeys(
  bills: readonly { id: string; status?: string | null; receiptNo?: string | null }[],
): CancelledVendorBillApKeys {
  const ids = new Set<string>();
  const documentNos = new Set<string>();
  for (const bill of bills) {
    if (bill.status !== 'CANCELLED') continue;
    if (bill.id) ids.add(bill.id);
    const no = String(bill.receiptNo || '').trim();
    if (no) documentNos.add(no);
  }
  return { ids, documentNos };
}

export function isApFromCancelledVendorBill(
  item: { id: string; documentNo?: string | null },
  keys: CancelledVendorBillApKeys,
): boolean {
  if (keys.ids.has(item.id)) return true;
  const no = String(item.documentNo || '').trim();
  return !!no && keys.documentNos.has(no);
}
