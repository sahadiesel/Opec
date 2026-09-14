import type { Firestore } from 'firebase/firestore';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { StoreItem, StoreTransaction } from '@/lib/types';

export type StoreCatalogDisplayRow =
  | { kind: 'group'; header: StoreItem; children: StoreItem[] }
  | { kind: 'standalone'; item: StoreItem };

export function matchesStoreCatalogSearch(item: StoreItem, qRaw: string): boolean {
  const q = qRaw.trim().toLowerCase();
  if (!q) return true;
  return (
    (item.itemName || '').toLowerCase().includes(q) ||
    (item.itemCode || '').toLowerCase().includes(q) ||
    (item.variantSpecification || '').toLowerCase().includes(q) ||
    (item.variantGroupKey || '').toLowerCase().includes(q)
  );
}

export function matchesStoreCatalogCategory(item: StoreItem, categoryFilter: string): boolean {
  if (categoryFilter === 'all') return true;
  return (item.category || '') === categoryFilter;
}

export function buildStoreCatalogDisplayRows(items: StoreItem[]): StoreCatalogDisplayRow[] {
  const headers = items.filter((i) => i.catalogGroupRole === 'header');
  const lines = items.filter((i) => i.catalogGroupRole === 'line');
  const standalones = items.filter(
    (i) => i.catalogGroupRole !== 'header' && i.catalogGroupRole !== 'line',
  );
  const byParent = new Map<string, StoreItem[]>();
  for (const line of lines) {
    const pid = line.parentStoreItemId || '';
    if (!pid) continue;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(line);
  }
  for (const [, arr] of byParent) {
    arr.sort((a, b) =>
      (a.variantSpecification || '').localeCompare(b.variantSpecification || '', 'th'),
    );
  }

  const rows: StoreCatalogDisplayRow[] = [];
  for (const h of headers) {
    rows.push({ kind: 'group', header: h, children: byParent.get(h.id) || [] });
  }
  for (const it of standalones) {
    rows.push({ kind: 'standalone', item: it });
  }
  rows.sort((a, b) => {
    const nameA = a.kind === 'group' ? a.header.itemName || '' : a.item.itemName || '';
    const nameB = b.kind === 'group' ? b.header.itemName || '' : b.item.itemName || '';
    return nameA.localeCompare(nameB, 'th');
  });
  return rows;
}

export function filterStoreCatalogDisplayRows(
  rows: StoreCatalogDisplayRow[],
  searchQuery: string,
  categoryFilter: string,
): StoreCatalogDisplayRow[] {
  const out: StoreCatalogDisplayRow[] = [];
  for (const row of rows) {
    if (row.kind === 'standalone') {
      const it = row.item;
      if (!matchesStoreCatalogCategory(it, categoryFilter)) continue;
      if (!matchesStoreCatalogSearch(it, searchQuery)) continue;
      out.push(row);
      continue;
    }
    const { header, children } = row;
    const catOk =
      categoryFilter === 'all' ||
      matchesStoreCatalogCategory(header, categoryFilter) ||
      children.some((c) => matchesStoreCatalogCategory(c, categoryFilter));
    if (!catOk) continue;

    if (!searchQuery.trim()) {
      out.push(row);
      continue;
    }

    const headMatch = matchesStoreCatalogSearch(header, searchQuery);
    const matchingChildren = children.filter((c) => matchesStoreCatalogSearch(c, searchQuery));
    if (headMatch) out.push(row);
    else if (matchingChildren.length) out.push({ kind: 'group', header, children: matchingChildren });
  }
  return out;
}

export function sumChildStock(children: StoreItem[]): number {
  return children.reduce((s, c) => s + (Number(c.currentStock) || 0), 0);
}

/** Net ISSUE − RETURN for an item; used to block delete while tools are still out. */
export async function toolIssueOutstanding(firestore: Firestore, itemId: string): Promise<number> {
  const snap = await getDocs(
    query(collection(firestore, 'store_transactions'), where('itemId', '==', itemId)),
  );
  let netOut = 0;
  snap.forEach((d) => {
    const tx = d.data() as StoreTransaction;
    if (tx.transactionType === 'ISSUE') netOut += tx.quantity;
    else if (tx.transactionType === 'RETURN') netOut -= tx.quantity;
  });
  return netOut;
}
