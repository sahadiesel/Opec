import type { PositionToolRequirement } from './worker';

/** Domain types: store (from master types.ts split). */

/** Store catalog categories — PPE แยกหน้าทะเบียน; อุปกรณ์ทั่วไปใช้ Workwear / Tool / Medical Supplies / General */
export const STORE_ITEM_CATEGORIES = ['PPE', 'Workwear', 'Tool', 'Medical Supplies', 'General'] as const;

export type StoreItemCatalogCategory = (typeof STORE_ITEM_CATEGORIES)[number];

export interface StoreItem {
  id: string;
  itemCode: string;
  /** ชื่อรายการหลัก (ไม่รวมขนาด/รุ่น) */
  itemName: string;
  /**
   * โครงสร้างคลังแบบหลัก–ย่อย: `header` = เมนชื่ออย่างเดียวไม่ถือสต็อกโดยตรง · `line` = รุ่น/ไซส์มีสต็อก · ไม่ระบุ = รายการเดี่ยวแบบเดิม
   */
  catalogGroupRole?: 'header' | 'line';
  /** รายการย่อยอ้างอิงเมนหลัก (`catalogGroupRole === 'line'`) */
  parentStoreItemId?: string;
  /** ขนาด/รุ่น เช่น Size M, 8\" — แยกจากชื่อเพื่อโควต้ารวมหลาย SKU */
  variantSpecification?: string;
  /** รหัสกลุ่มเดียวกันสำหรับโควต้าเบิกรวม (เช่น เสื้อ M กับ L ใช้คีย์เดียวกัน) */
  variantGroupKey?: string;
  category: string;
  unit: string;
  minimumStock: number;
  currentStock: number;
  isPPE: boolean;
  isTool: boolean;
  /** วัสดุสิ้นเปลือง — เบิกแล้วตัดสต็อก ไม่ติดตามรับคืน (ค่าเริ่มต้น = ต้องคืน) */
  isConsumable?: boolean;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

/** รายการที่ถือเป็น PPE ในคลัง — ใช้แยกหน้าทะเบียน PPE กับอุปกรณ์ทั่วไป */
export function storeItemIsPpeCatalog(item: Pick<StoreItem, 'isPPE' | 'category'>): boolean {
  return item.isPPE === true || (item.category || '') === 'PPE';
}

export function storeItemIsConsumable(item: Pick<StoreItem, 'isConsumable'> | null | undefined): boolean {
  return item?.isConsumable === true;
}

/** ประเภทเบิกในตำแหน่งงาน — อิง `isConsumable` / `isTool` จากทะเบียนคลัง (ไม่ใช่หมวด Workwear = consumable) */
export function storeItemToPositionToolItemType(
  item: Pick<StoreItem, 'isTool' | 'isConsumable'>,
): PositionToolRequirement['itemType'] {
  if (storeItemIsConsumable(item)) return 'consumable';
  if (item.isTool) return 'tool';
  return 'equipment';
}

export function resolvePositionToolRequirementItemType(
  req: Pick<PositionToolRequirement, 'itemType' | 'storeItemId' | 'storeCategory'>,
  storeItems: StoreItem[] | undefined,
): PositionToolRequirement['itemType'] {
  const linked = req.storeItemId ? storeItems?.find((s) => s.id === req.storeItemId) : undefined;
  if (linked) return storeItemToPositionToolItemType(linked);
  if (req.storeCategory === 'Tool') return 'tool';
  if (req.storeCategory === 'Workwear') return 'equipment';
  return req.itemType ?? 'equipment';
}

export function positionToolItemTypeLabel(type: PositionToolRequirement['itemType']): string {
  switch (type) {
    case 'consumable':
      return 'วัสดุสิ้นเปลือง';
    case 'tool':
      return 'เครื่องมือ';
    default:
      return 'อุปกรณ์';
  }
}

export function formatStoreItemLabel(item: Pick<StoreItem, 'itemName' | 'variantSpecification'>): string {
  const name = (item.itemName || '').trim();
  const spec = (item.variantSpecification || '').trim();
  if (!name && spec) return spec;
  return spec ? `${name} — ${spec}` : name;
}

export interface StoreTransaction {
  id: string;
  itemId: string;
  transactionType: TransactionType;
  quantity: number;
  workerId?: string;
  /** Office staff borrow (no field assignment) */
  officeStaffId?: string;
  issueType?: 'field' | 'office';
  assignmentId?: string;
  waveId?: string;
  transactionDate: string;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  createdAt: number;
  createdBy: string;
}

export type TransactionType = 'RECEIVE' | 'ISSUE' | 'RETURN' | 'WRITEOFF' | 'DAMAGED' | 'LOST';

