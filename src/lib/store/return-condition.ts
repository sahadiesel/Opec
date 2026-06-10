export type StoreReturnCondition = 'GOOD' | 'DAMAGED' | 'LOST';

export const STORE_RETURN_CONDITIONS: StoreReturnCondition[] = ['GOOD', 'DAMAGED', 'LOST'];

export const STORE_RETURN_CONDITION_LABELS: Record<StoreReturnCondition, string> = {
  GOOD: 'สภาพดี — นำกลับเข้าสต็อก',
  DAMAGED: 'ชำรุด — รับคืนแล้ว ไม่เข้าสต็อก',
  LOST: 'สูญหาย — รับคืนแล้ว ไม่เข้าสต็อก',
};

export function storeReturnConditionRestocksInventory(condition: StoreReturnCondition): boolean {
  return condition === 'GOOD';
}

export function storeReturnTransactionType(condition: StoreReturnCondition): 'RETURN' | 'DAMAGED' | 'LOST' {
  return condition === 'GOOD' ? 'RETURN' : condition;
}
