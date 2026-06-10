import type { StoreItem, StoreTransaction } from '@/lib/types';
import { storeItemIsConsumable } from '@/lib/types';

/**
 * ผลต่อยอดถือครองนอกคลัง (ISSUE เพิ่ม · RETURN/DAMAGED/LOST ลด)
 * — ใช้ร่วมกันหน้าคืนและแดชบอร์ดคลัง
 */
export function netCustodyQuantityDelta(tx: Pick<StoreTransaction, 'transactionType' | 'quantity'>): number {
  const q = Number(tx.quantity) || 0;
  if (tx.transactionType === 'ISSUE') return q;
  if (tx.transactionType === 'RETURN' || tx.transactionType === 'DAMAGED' || tx.transactionType === 'LOST') {
    return -q;
  }
  return 0;
}

/** วัสดุสิ้นเปลือง — ไม่นับ ISSUE เป็นยอดค้างคืน */
export function netCustodyQuantityDeltaForItem(
  tx: Pick<StoreTransaction, 'transactionType' | 'quantity' | 'itemId'>,
  itemLookup: (itemId: string) => Pick<StoreItem, 'isConsumable'> | undefined,
): number {
  const item = itemLookup(tx.itemId);
  if (storeItemIsConsumable(item) && tx.transactionType === 'ISSUE') return 0;
  return netCustodyQuantityDelta(tx);
}
