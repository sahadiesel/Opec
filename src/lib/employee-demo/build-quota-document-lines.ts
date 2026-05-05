import type { Firestore } from 'firebase/firestore';
import { collection, getDocs } from 'firebase/firestore';
import type {
  EmployeeQuotaDocumentLine,
  POLine,
  Position,
  PurchaseOrder,
} from '@/lib/types';

/**
 * รวมจำนวนตาม positionId จาก po_lines สถานะ active ของหลาย PO
 */
export async function buildQuotaDocumentLines(
  firestore: Firestore,
  purchaseOrderIds: string[],
  poById: Map<string, PurchaseOrder>,
  positionMap: Map<string, Position>,
): Promise<EmployeeQuotaDocumentLine[]> {
  type Agg = { total: number; contributions: Map<string, { poCode: string; qty: number }> };
  const aggByPosition = new Map<string, Agg>();

  for (const poId of purchaseOrderIds) {
    const po = poById.get(poId);
    if (!po) continue;
    const linesSnap = await getDocs(collection(firestore, 'purchase_orders', poId, 'po_lines'));
    linesSnap.forEach((d) => {
      const line = { id: d.id, ...d.data() } as POLine;
      if (line.status !== 'active') return;
      const qty = Number(line.quantity);
      if (!Number.isFinite(qty) || qty <= 0) return;
      const pid = line.positionId;
      if (!aggByPosition.has(pid)) {
        aggByPosition.set(pid, { total: 0, contributions: new Map() });
      }
      const bucket = aggByPosition.get(pid)!;
      bucket.total += qty;
      const prev = bucket.contributions.get(poId)?.qty ?? 0;
      bucket.contributions.set(poId, { poCode: po.poCode, qty: prev + qty });
    });
  }

  const lines: EmployeeQuotaDocumentLine[] = [...aggByPosition.entries()].map(([positionId, agg]) => {
    const pos = positionMap.get(positionId);
    const positionName = pos?.positionName?.trim() || pos?.positionNameTh || positionId;
    const contributions = [...agg.contributions.entries()].map(([poId, { poCode, qty }]) => ({
      poId,
      poCode,
      quantity: qty,
    }));
    contributions.sort((a, b) => a.poCode.localeCompare(b.poCode, undefined, { numeric: true }));
    return {
      positionId,
      positionName,
      quantity: agg.total,
      contributions,
    };
  });
  lines.sort((a, b) => a.positionName.localeCompare(b.positionName, 'th'));
  return lines;
}
