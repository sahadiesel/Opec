import type { Firestore } from 'firebase/firestore';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import type {
  Assignment,
  Position,
  PositionPPERequirement,
  PositionToolRequirement,
  PositionRequirementKind,
  StoreItem,
} from '@/lib/types';
import {
  appliesPpeRequirement,
  appliesToolRequirement,
  fulfillmentLineDocId,
  fulfillmentLineSatisfied,
  loadFulfillmentMap,
} from '@/lib/store/mobilization-fulfillment';
import {
  listStoreItemsMatchingPpeRequirement,
  listStoreItemsMatchingToolRequirement,
  pickDefaultStoreItemForPpe,
  pickDefaultStoreItemForTool,
} from '@/lib/store/position-issue-match';

export type FieldQuotaPendingLine = {
  kind: PositionRequirementKind;
  req: PositionPPERequirement | PositionToolRequirement;
  quantityRequired: number;
  quantityIssued: number;
  lineDocId: string;
  defaultItem?: StoreItem;
  candidateItems?: StoreItem[];
};

export type FieldQuotaMobContext = {
  assignment: Assignment;
  position?: Position;
  pendingLines: FieldQuotaPendingLine[];
};

/** รายการโควต้าที่ยังเบิกไม่ครบ (ตามตำแหน่งงาน) — ไม่มีรายการ = เบิกเพิ่มไม่ได้ */
export async function loadFieldQuotaPendingLines(
  firestore: Firestore,
  assignment: Assignment,
  storeItems: StoreItem[],
): Promise<FieldQuotaPendingLine[]> {
  const list = storeItems || [];
  const ppeRef = collection(firestore, 'positions', assignment.positionId, 'ppe_requirements');
  const toolRef = collection(firestore, 'positions', assignment.positionId, 'tool_requirements');
  const [ppeSnap, toolSnap] = await Promise.all([getDocs(ppeRef), getDocs(toolRef)]);
  const ppe = ppeSnap.docs.map((d) => ({ ...d.data(), id: d.id } as PositionPPERequirement));
  const tools = toolSnap.docs.map((d) => ({ ...d.data(), id: d.id } as PositionToolRequirement));
  const fmap = await loadFulfillmentMap(firestore, assignment.id);
  const pendingLines: FieldQuotaPendingLine[] = [];

  for (const p of ppe) {
    if (!appliesPpeRequirement(p)) continue;
    const q = Number(p.quantityDefault || 1);
    const lid = fulfillmentLineDocId('ppe', p.id);
    const line = fmap.get(lid);
    if (fulfillmentLineSatisfied(q, line)) continue;
    pendingLines.push({
      kind: 'ppe',
      req: p,
      quantityRequired: q,
      quantityIssued: Number(line?.quantityIssued || 0),
      lineDocId: lid,
      defaultItem: pickDefaultStoreItemForPpe(p, list),
      candidateItems: listStoreItemsMatchingPpeRequirement(p, list),
    });
  }
  for (const t of tools) {
    if (!appliesToolRequirement(t)) continue;
    const q = Number(t.quantityDefault || 1);
    const lid = fulfillmentLineDocId('tool', t.id);
    const line = fmap.get(lid);
    if (fulfillmentLineSatisfied(q, line)) continue;
    pendingLines.push({
      kind: 'tool',
      req: t,
      quantityRequired: q,
      quantityIssued: Number(line?.quantityIssued || 0),
      lineDocId: lid,
      defaultItem: pickDefaultStoreItemForTool(t, list),
      candidateItems: listStoreItemsMatchingToolRequirement(t, list),
    });
  }

  return pendingLines;
}

export function resolveFieldLineStoreItem(
  line: FieldQuotaPendingLine,
  lineKey: string,
  skuIdByLineKey: Record<string, string>,
): StoreItem | undefined {
  const candidates =
    line.candidateItems && line.candidateItems.length > 0
      ? line.candidateItems
      : line.defaultItem
        ? [line.defaultItem]
        : [];
  if (candidates.length === 0) return undefined;
  const want = skuIdByLineKey[lineKey]?.trim();
  if (want && candidates.some((c) => c.id === want)) {
    return candidates.find((c) => c.id === want);
  }
  return line.defaultItem ?? candidates[0];
}

export async function loadFieldQuotaMobContext(
  firestore: Firestore,
  assignment: Assignment,
  storeItems: StoreItem[],
): Promise<FieldQuotaMobContext> {
  const posSnap = await getDoc(doc(firestore, 'positions', assignment.positionId));
  const position = posSnap.exists()
    ? ({ ...posSnap.data(), id: posSnap.id } as Position)
    : undefined;
  const pendingLines = await loadFieldQuotaPendingLines(firestore, assignment, storeItems);
  return { assignment, position, pendingLines };
}
