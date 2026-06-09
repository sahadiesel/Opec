import type { StoreItem } from '@/lib/types';
import { formatStoreItemLabel } from '@/lib/types';

export function isReceivableStoreItem(item: StoreItem): boolean {
  return !!item.active && item.catalogGroupRole !== 'header';
}

export function variantLinesForParent(parentId: string, items: StoreItem[]): StoreItem[] {
  return items
    .filter((i) => i.catalogGroupRole === 'line' && i.parentStoreItemId === parentId && i.active)
    .sort((a, b) =>
      formatStoreItemLabel(a).localeCompare(formatStoreItemLabel(b), 'th', { sensitivity: 'base' }),
    );
}

export function storeCatalogHeaders(items: StoreItem[]): StoreItem[] {
  return items
    .filter((i) => i.active && i.catalogGroupRole === 'header')
    .sort((a, b) => a.itemName.localeCompare(b.itemName, 'th', { sensitivity: 'base' }));
}

export function storeCatalogStandalone(items: StoreItem[]): StoreItem[] {
  return items
    .filter((i) => i.active && i.catalogGroupRole !== 'header' && i.catalogGroupRole !== 'line')
    .sort((a, b) => a.itemName.localeCompare(b.itemName, 'th', { sensitivity: 'base' }));
}

/** PR / จัดซื้อ — ไม่แสดงเมนหลักที่มีรุ่นย่อย; แสดงเฉพาะ SKU ย่อย (ชื่อ — รุ่น) หรือรายการเดี่ยว */
export function storeCatalogPickableItems(items: StoreItem[]): StoreItem[] {
  const active = items.filter((i) => i.active);
  const menuIdsWithVariants = new Set(
    active
      .filter((i) => i.catalogGroupRole === 'line' && i.parentStoreItemId)
      .map((i) => i.parentStoreItemId as string),
  );

  return active
    .filter((i) => i.catalogGroupRole !== 'header' && !menuIdsWithVariants.has(i.id))
    .sort((a, b) =>
      formatStoreItemLabel(a).localeCompare(formatStoreItemLabel(b), 'th', { sensitivity: 'base' }),
    );
}

/** จับคู่รุ่นย่อยจากคำอธิบาย PO เช่น «สีเหลือง» → variantSpecification */
export function guessVariantFromPoDescription(
  headerId: string,
  poDescription: string,
  items: StoreItem[],
): StoreItem | undefined {
  const desc = poDescription.toLowerCase();
  const variants = variantLinesForParent(headerId, items);
  for (const v of variants) {
    const spec = (v.variantSpecification || '').trim().toLowerCase();
    if (spec && desc.includes(spec)) return v;
    const label = formatStoreItemLabel(v).toLowerCase();
    for (const part of label.split('—')) {
      const p = part.trim();
      if (p.length >= 2 && desc.includes(p)) return v;
    }
  }
  return undefined;
}

export type ReceiveStockPickResult =
  | { kind: 'ready'; item: StoreItem }
  | { kind: 'pick_variant'; header: StoreItem; variants: StoreItem[] };

export function resolveReceiveStockPick(items: StoreItem[], pickedId: string): ReceiveStockPickResult | null {
  const item = items.find((i) => i.id === pickedId);
  if (!item?.active) return null;
  if (item.catalogGroupRole === 'header') {
    const variants = variantLinesForParent(item.id, items);
    if (variants.length === 0) return null;
    return { kind: 'pick_variant', header: item, variants };
  }
  if (!isReceivableStoreItem(item)) return null;
  return { kind: 'ready', item };
}

export function receiveLineFromStoreItem(
  base: {
    id: string;
    quantity: number;
    unitCost: number;
    purchaseLineId?: string;
    poDescription?: string;
  },
  item: StoreItem,
): {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  variantSpecification?: string;
  quantity: number;
  unit: string;
  unitCost: number;
  currentStock: number;
  purchaseLineId?: string;
  poDescription?: string;
  needsStockMapping: false;
  needsVariantSelection: false;
} {
  return {
    id: base.id,
    purchaseLineId: base.purchaseLineId,
    poDescription: base.poDescription,
    itemId: item.id,
    itemName: item.itemName,
    itemCode: item.itemCode,
    variantSpecification: item.variantSpecification,
    quantity: base.quantity,
    unit: item.unit,
    unitCost: base.unitCost,
    currentStock: item.currentStock,
    needsStockMapping: false,
    needsVariantSelection: false,
  };
}
