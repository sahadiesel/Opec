import type { StoreTransaction } from '@/lib/types';

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
