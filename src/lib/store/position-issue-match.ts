import type { PositionPPERequirement, PositionToolRequirement, StoreItem } from '@/lib/types';

export function issueItemMatchesPositionReq(
  item: StoreItem,
  posPPE: PositionPPERequirement[],
  posTools: PositionToolRequirement[],
): { matchPPE?: PositionPPERequirement; matchTool?: PositionToolRequirement } {
  if (item.catalogGroupRole === 'header') {
    return {};
  }
  const matchPPE = posPPE.find((p) => {
    if (p.storeItemId && p.storeItemId === item.id) return true;
    const pk = (p.variantGroupKey || '').trim();
    const ik = (item.variantGroupKey || '').trim();
    if (pk && ik && pk === ik) return true;
    if (p.itemCode && p.itemCode === item.itemCode) return true;
    if (p.itemName && p.itemName === item.itemName) return true;
    return false;
  });
  const matchTool = posTools.find((t) => {
    if (t.storeItemId && t.storeItemId === item.id) return true;
    const tk = (t.variantGroupKey || '').trim();
    const ik = (item.variantGroupKey || '').trim();
    if (tk && ik && tk === ik) return true;
    if (t.itemCode && t.itemCode === item.itemCode) return true;
    if (t.itemName && t.itemName === item.itemName) return true;
    return false;
  });
  return { matchPPE, matchTool };
}

export function quantityUsedTowardPpeRequirement(
  match: PositionPPERequirement,
  issueList: { itemId: string; quantity: number }[],
  storeItems: StoreItem[],
): number {
  const gk = (match.variantGroupKey || '').trim();
  if (gk) {
    let sum = 0;
    for (const line of issueList) {
      const si = storeItems.find((x) => x.id === line.itemId);
      if (!si) continue;
      if ((si.variantGroupKey || '').trim() === gk) sum += line.quantity;
    }
    return sum;
  }
  if (match.storeItemId) {
    return issueList.find((l) => l.itemId === match.storeItemId)?.quantity ?? 0;
  }
  let sum = 0;
  for (const line of issueList) {
    const si = storeItems.find((x) => x.id === line.itemId);
    if (!si) continue;
    if ((match.itemCode && si.itemCode === match.itemCode) || (match.itemName && si.itemName === match.itemName)) {
      sum += line.quantity;
    }
  }
  return sum;
}

export function quantityUsedTowardToolRequirement(
  match: PositionToolRequirement,
  issueList: { itemId: string; quantity: number }[],
  storeItems: StoreItem[],
): number {
  const gk = (match.variantGroupKey || '').trim();
  if (gk) {
    let sum = 0;
    for (const line of issueList) {
      const si = storeItems.find((x) => x.id === line.itemId);
      if (!si) continue;
      if ((si.variantGroupKey || '').trim() === gk) sum += line.quantity;
    }
    return sum;
  }
  if (match.storeItemId) {
    return issueList.find((l) => l.itemId === match.storeItemId)?.quantity ?? 0;
  }
  let sum = 0;
  for (const line of issueList) {
    const si = storeItems.find((x) => x.id === line.itemId);
    if (!si) continue;
    if ((match.itemCode && si.itemCode === match.itemCode) || (match.itemName && si.itemName === match.itemName)) {
      sum += line.quantity;
    }
  }
  return sum;
}

export function pickDefaultStoreItemForPpe(
  req: PositionPPERequirement,
  storeItems: StoreItem[],
): StoreItem | undefined {
  if (req.storeItemId) {
    const direct = storeItems.find((s) => s.id === req.storeItemId);
    /** `storeItemId` อาจชี้เมน (header) — เบิกได้เฉพาะรุ่นย่อย */
    if (direct && direct.catalogGroupRole !== 'header') return direct;
  }
  const matches = storeItems.filter((item) => {
    const { matchPPE } = issueItemMatchesPositionReq(item, [req], []);
    return !!matchPPE;
  });
  matches.sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));
  return matches[0];
}

export function pickDefaultStoreItemForTool(
  req: PositionToolRequirement,
  storeItems: StoreItem[],
): StoreItem | undefined {
  if (req.storeItemId) {
    const direct = storeItems.find((s) => s.id === req.storeItemId);
    if (direct && direct.catalogGroupRole !== 'header') return direct;
  }
  const matches = storeItems.filter((item) => {
    const { matchTool } = issueItemMatchesPositionReq(item, [], [req]);
    return !!matchTool;
  });
  matches.sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));
  return matches[0];
}

/** SKU ในคลังที่นับเข้าโควต้ารายการตำแหน่งนี้ได้ (รวมทุกไซส์ที่ใช้ variantGroupKey เดียวกัน) */
export function listStoreItemsMatchingPpeRequirement(
  req: PositionPPERequirement,
  storeItems: StoreItem[],
): StoreItem[] {
  const matches = storeItems.filter((item) => {
    if (item.catalogGroupRole === 'header') return false;
    const { matchPPE } = issueItemMatchesPositionReq(item, [req], []);
    return !!matchPPE;
  });
  matches.sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));
  return matches;
}

export function listStoreItemsMatchingToolRequirement(
  req: PositionToolRequirement,
  storeItems: StoreItem[],
): StoreItem[] {
  const matches = storeItems.filter((item) => {
    if (item.catalogGroupRole === 'header') return false;
    const { matchTool } = issueItemMatchesPositionReq(item, [], [req]);
    return !!matchTool;
  });
  matches.sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));
  return matches;
}
