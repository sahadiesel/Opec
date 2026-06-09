import type { PurchaseLine, StoreItem } from '@/lib/types';
import { formatStoreItemLabel } from '@/lib/types';
import { guessVariantFromPoDescription } from '@/lib/store/receive-stock-select';

export type PurchaseLineStockRef = Pick<PurchaseLine, 'storeItemId' | 'storeItemCode' | 'itemDescription'>;

/** หา SKU คลังจาก PO/PR line — id ก่อน แล้ว itemCode แล้วจับคู่ชื่อ */
export function resolvePurchaseLineStoreItem(
  pl: PurchaseLineStockRef,
  storeItems: StoreItem[],
): StoreItem | undefined {
  const active = storeItems.filter((i) => i.active);

  if (pl.storeItemId) {
    const byId = active.find((i) => i.id === pl.storeItemId);
    if (byId) return byId;
  }

  const code = (pl.storeItemCode || '').trim();
  if (code) {
    const byCode = active.find((i) => i.itemCode === code);
    if (byCode) return byCode;
  }

  const desc = (pl.itemDescription || '').trim();
  if (!desc) return undefined;

  const byLabel = active.filter((i) => formatStoreItemLabel(i) === desc);
  if (byLabel.length === 1) return byLabel[0];

  const embedded = desc.match(/\b((?:EQM|PPE)-\d+)\b/i);
  if (embedded) {
    const found = active.find((i) => i.itemCode.toUpperCase() === embedded[1].toUpperCase());
    if (found) return found;
  }

  return undefined;
}

/** SKU ที่รับเข้าคลังได้ — แปลง header เป็น line ตามคำอธิบาย PO ถ้าจำเป็น */
export function purchaseLineToReceivableStoreItem(
  pl: PurchaseLineStockRef,
  storeItems: StoreItem[],
): StoreItem | undefined {
  const linked = resolvePurchaseLineStoreItem(pl, storeItems);
  if (!linked) return undefined;
  if (linked.catalogGroupRole === 'header') {
    return guessVariantFromPoDescription(linked.id, pl.itemDescription || '', storeItems);
  }
  if (linked.catalogGroupRole === 'line' || !linked.catalogGroupRole) {
    return linked;
  }
  return undefined;
}
