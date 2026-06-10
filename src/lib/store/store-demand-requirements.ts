import type { Firestore } from 'firebase/firestore';
import { collection, getDocs } from 'firebase/firestore';
import type {
  Assignment,
  PositionPPERequirement,
  PositionToolRequirement,
  StoreItem,
  Worker,
} from '@/lib/types';
import { isActiveWorkerForSelection } from '@/lib/hr/worker-active';
import {
  appliesPpeRequirement,
  appliesToolRequirement,
  fulfillmentLineDocId,
  isMobilizationInStoreFulfillmentScope,
  loadFulfillmentMap,
} from '@/lib/store/mobilization-fulfillment';
import {
  listStoreItemsMatchingPpeRequirement,
  listStoreItemsMatchingToolRequirement,
} from '@/lib/store/position-issue-match';

export type StoreDemandVariantStock = {
  storeItemId: string;
  label: string;
  currentStock: number;
  unit: string;
};

export type StoreDemandRequirementRow = {
  requirementKey: string;
  /** ชื่อเมนตามโควต้าตำแหน่ง (ไม่ระบุไซส์/รุ่นย่อย) */
  displayName: string;
  itemCode: string;
  unit: string;
  /** ยังต้องเบิกให้ครบ (ไม่นับที่เบิกครบแล้ว / WAIVED) */
  demand: number;
  mobilizationHits: number;
  variantStocks: StoreDemandVariantStock[];
  totalAvailable: number;
  aggregateShortage: number;
};

function workerActiveById(workers: Worker[] | null | undefined): Map<string, Worker> {
  const m = new Map<string, Worker>();
  for (const w of workers ?? []) {
    if (isActiveWorkerForSelection(w)) m.set(w.id, w);
  }
  return m;
}

function mobilizationsInDemandScope(
  mobilizations: Assignment[] | null | undefined,
  activeWorkers: Map<string, Worker>,
): Assignment[] {
  return (mobilizations ?? []).filter((m) => {
    if (!isMobilizationInStoreFulfillmentScope(m)) return false;
    if (!(m.workerId || '').trim() || !(m.positionId || '').trim()) return false;
    return activeWorkers.has(m.workerId);
  });
}

/** คีย์รวมโควต้า — ตามเมนตำแหน่ง ไม่แยก SKU */
function requirementAggregateKey(
  kind: 'ppe' | 'tool',
  req: PositionPPERequirement | PositionToolRequirement,
): string {
  const vgk = (req.variantGroupKey || '').trim();
  if (vgk) return `${kind}:vg:${vgk}`;
  const sid = (req.storeItemId || '').trim();
  if (sid) return `${kind}:sid:${sid}`;
  const code = (req.itemCode || '').trim();
  if (code) return `${kind}:code:${code.toUpperCase()}`;
  return `${kind}:name:${(req.itemName || '').trim().toLowerCase()}`;
}

function variantStockLines(
  kind: 'ppe' | 'tool',
  req: PositionPPERequirement | PositionToolRequirement,
  storeItems: StoreItem[],
): StoreDemandVariantStock[] {
  const matches =
    kind === 'ppe'
      ? listStoreItemsMatchingPpeRequirement(req as PositionPPERequirement, storeItems)
      : listStoreItemsMatchingToolRequirement(req as PositionToolRequirement, storeItems);

  let active = matches.filter((i) => i.active && i.catalogGroupRole !== 'header');

  if (active.length === 0) {
    const sid = (req.storeItemId || '').trim();
    const direct = storeItems.find((s) => s.id === sid && s.active && s.catalogGroupRole !== 'header');
    if (direct) active = [direct];
  }

  if (active.length === 0 && (req.itemCode || req.itemName)) {
    active = storeItems.filter(
      (s) =>
        s.active &&
        s.catalogGroupRole !== 'header' &&
        ((req.itemCode && s.itemCode === req.itemCode) ||
          (req.itemName && s.itemName === req.itemName)),
    );
  }

  return active
    .map((i) => ({
      storeItemId: i.id,
      label: (i.variantSpecification || '').trim() || i.itemCode || i.itemName,
      currentStock: i.currentStock ?? 0,
      unit: i.unit || 'EA',
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'th'));
}

function mergeVariantStocks(
  a: StoreDemandVariantStock[],
  b: StoreDemandVariantStock[],
): StoreDemandVariantStock[] {
  const map = new Map<string, StoreDemandVariantStock>();
  for (const v of [...a, ...b]) map.set(v.storeItemId, v);
  return [...map.values()].sort((x, y) => x.label.localeCompare(y.label, 'th'));
}

function requirementDisplayMeta(
  req: PositionPPERequirement | PositionToolRequirement,
  variantStocks: StoreDemandVariantStock[],
): { displayName: string; itemCode: string; unit: string } {
  const displayName = (req.itemName || '').trim() || variantStocks[0]?.label || '—';
  const itemCode = (req.itemCode || '').trim();
  const unit = variantStocks[0]?.unit || 'EA';
  return { displayName, itemCode, unit };
}

/**
 * ความต้องการคลังจาก mobilization — นับเฉพาะโควต้าที่ยังเบิกไม่ครบ
 * แสดงระดับเมนตามตำแหน่ง + สต็อกแยกรุ่นย่อยให้ผู้ใช้ตัดสินใจจัดซื้อ
 */
export async function computeStoreDemandRequirements(
  firestore: Firestore,
  mobilizations: Assignment[] | null | undefined,
  storeItems: StoreItem[],
  workers: Worker[] | null | undefined,
): Promise<StoreDemandRequirementRow[]> {
  const activeWorkers = workerActiveById(workers);
  const scoped = mobilizationsInDemandScope(mobilizations, activeWorkers);
  const byKey = new Map<
    string,
    {
      displayName: string;
      itemCode: string;
      unit: string;
      demand: number;
      mobIds: Set<string>;
      variantStocks: StoreDemandVariantStock[];
    }
  >();

  const posCache = new Map<string, { ppe: PositionPPERequirement[]; tools: PositionToolRequirement[] }>();

  const loadPositionReqs = async (positionId: string) => {
    const cached = posCache.get(positionId);
    if (cached) return cached;
    const [ppeSnap, toolSnap] = await Promise.all([
      getDocs(collection(firestore, 'positions', positionId, 'ppe_requirements')),
      getDocs(collection(firestore, 'positions', positionId, 'tool_requirements')),
    ]);
    const value = {
      ppe: ppeSnap.docs.map((d) => ({ ...d.data(), id: d.id } as PositionPPERequirement)),
      tools: toolSnap.docs.map((d) => ({ ...d.data(), id: d.id } as PositionToolRequirement)),
    };
    posCache.set(positionId, value);
    return value;
  };

  for (const m of scoped) {
    const { ppe, tools } = await loadPositionReqs(m.positionId);
    const fmap = await loadFulfillmentMap(firestore, m.id);

    const processLine = (
      kind: 'ppe' | 'tool',
      req: PositionPPERequirement | PositionToolRequirement,
    ) => {
      const applies =
        kind === 'ppe'
          ? appliesPpeRequirement(req as PositionPPERequirement)
          : appliesToolRequirement(req as PositionToolRequirement);
      if (!applies) return;

      const qty = Math.max(1, Number(req.quantityDefault) || 1);
      const line = fmap.get(fulfillmentLineDocId(kind, req.id));
      if (line?.status === 'WAIVED') return;

      const issued = Math.max(0, Number(line?.quantityIssued) || 0);
      const pending = Math.max(0, qty - issued);
      if (pending <= 0) return;

      const key = requirementAggregateKey(kind, req);
      const variantStocks = variantStockLines(kind, req, storeItems);
      const meta = requirementDisplayMeta(req, variantStocks);

      const cur = byKey.get(key) ?? {
        displayName: meta.displayName,
        itemCode: meta.itemCode,
        unit: meta.unit,
        demand: 0,
        mobIds: new Set<string>(),
        variantStocks,
      };
      cur.demand += pending;
      cur.mobIds.add(m.id);
      cur.variantStocks = mergeVariantStocks(cur.variantStocks, variantStocks);
      byKey.set(key, cur);
    };

    for (const p of ppe) processLine('ppe', p);
    for (const t of tools) processLine('tool', t);
  }

  const rows: StoreDemandRequirementRow[] = [];
  for (const [requirementKey, v] of byKey) {
    if (v.demand <= 0) continue;
    const totalAvailable = v.variantStocks.reduce((sum, s) => sum + s.currentStock, 0);
    rows.push({
      requirementKey,
      displayName: v.displayName,
      itemCode: v.itemCode,
      unit: v.unit,
      demand: v.demand,
      mobilizationHits: v.mobIds.size,
      variantStocks: v.variantStocks,
      totalAvailable,
      aggregateShortage: Math.max(0, v.demand - totalAvailable),
    });
  }

  rows.sort((a, b) => {
    if (b.aggregateShortage !== a.aggregateShortage) return b.aggregateShortage - a.aggregateShortage;
    if (b.demand !== a.demand) return b.demand - a.demand;
    return a.displayName.localeCompare(b.displayName, 'th');
  });

  return rows;
}
