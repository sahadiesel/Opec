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
  fieldQuotaLineCanIssueMore,
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
  /** เคยกดไม่ประสงค์เบิก — เบิกเพิ่มได้จนครบโควต้า */
  wasWaived?: boolean;
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
  opts?: { mode?: 'queue' | 'topup' },
): Promise<FieldQuotaPendingLine[]> {
  const mode = opts?.mode ?? 'queue';
  const list = storeItems || [];
  const ppeRef = collection(firestore, 'positions', assignment.positionId, 'ppe_requirements');
  const toolRef = collection(firestore, 'positions', assignment.positionId, 'tool_requirements');
  const [ppeSnap, toolSnap] = await Promise.all([getDocs(ppeRef), getDocs(toolRef)]);
  const ppe = ppeSnap.docs.map((d) => ({ ...d.data(), id: d.id } as PositionPPERequirement));
  const tools = toolSnap.docs.map((d) => ({ ...d.data(), id: d.id } as PositionToolRequirement));
  const fmap = await loadFulfillmentMap(firestore, assignment.id);
  const pendingLines: FieldQuotaPendingLine[] = [];

  const includeLine = (
    q: number,
    line: ReturnType<typeof fmap.get>,
  ): boolean => {
    if (mode === 'topup') return fieldQuotaLineCanIssueMore(q, line);
    return !fulfillmentLineSatisfied(q, line);
  };

  const pushLine = (
    kind: PositionRequirementKind,
    req: PositionPPERequirement | PositionToolRequirement,
    q: number,
    lid: string,
    line: ReturnType<typeof fmap.get>,
    defaultItem: StoreItem | undefined,
    candidateItems: StoreItem[],
  ) => {
    pendingLines.push({
      kind,
      req,
      quantityRequired: q,
      quantityIssued: Number(line?.quantityIssued || 0),
      lineDocId: lid,
      defaultItem,
      candidateItems,
      wasWaived: line?.status === 'WAIVED',
    });
  };

  for (const p of ppe) {
    if (!appliesPpeRequirement(p)) continue;
    const q = Number(p.quantityDefault || 1);
    const lid = fulfillmentLineDocId('ppe', p.id);
    const line = fmap.get(lid);
    if (!includeLine(q, line)) continue;
    pushLine(
      'ppe',
      p,
      q,
      lid,
      line,
      pickDefaultStoreItemForPpe(p, list),
      listStoreItemsMatchingPpeRequirement(p, list),
    );
  }
  for (const t of tools) {
    if (!appliesToolRequirement(t)) continue;
    const q = Number(t.quantityDefault || 1);
    const lid = fulfillmentLineDocId('tool', t.id);
    const line = fmap.get(lid);
    if (!includeLine(q, line)) continue;
    pushLine(
      'tool',
      t,
      q,
      lid,
      line,
      pickDefaultStoreItemForTool(t, list),
      listStoreItemsMatchingToolRequirement(t, list),
    );
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
  opts?: { mode?: 'queue' | 'topup' },
): Promise<FieldQuotaMobContext> {
  const posSnap = await getDoc(doc(firestore, 'positions', assignment.positionId));
  const position = posSnap.exists()
    ? ({ ...posSnap.data(), id: posSnap.id } as Position)
    : undefined;
  const pendingLines = await loadFieldQuotaPendingLines(firestore, assignment, storeItems, opts);
  return { assignment, position, pendingLines };
}
