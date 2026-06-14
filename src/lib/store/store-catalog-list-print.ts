import type { StoreItem } from '@/lib/types';
import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type StoreCatalogDisplayRow =
  | { kind: 'group'; header: StoreItem; children: StoreItem[] }
  | { kind: 'standalone'; item: StoreItem };

export type StoreCatalogListPrintRow = {
  itemCode: string;
  nameLabel: string;
  variantLabel: string;
  categoryLabel: string;
  stockLabel: string;
  statusLabel: string;
  rowClass?: string;
};

export type StoreCatalogPrintVariant = 'equipment' | 'ppe';

const PRINT_ROW_LIMIT = 500;

const TITLES: Record<StoreCatalogPrintVariant, string> = {
  equipment: 'ทะเบียนอุปกรณ์ (ไม่รวม PPE)',
  ppe: 'ทะเบียน PPE (Store)',
};

const FOOTERS: Record<StoreCatalogPrintVariant, string> = {
  equipment: 'OPEC OpsFlow — ทะเบียนอุปกรณ์ (Store)',
  ppe: 'OPEC OpsFlow — ทะเบียน PPE (Store)',
};

function statusLabel(active: boolean | undefined): string {
  return active !== false ? 'Active' : 'Inactive';
}

function stockLine(stock: number, unit: string, suffix?: string): string {
  const u = (unit || 'Unit').trim();
  const base = `${stock} ${u}`;
  return suffix ? `${base} ${suffix}` : base;
}

function sumChildStock(children: StoreItem[]): number {
  return children.reduce((s, c) => s + (Number(c.currentStock) || 0), 0);
}

export function flattenStoreCatalogDisplayRows(rows: StoreCatalogDisplayRow[]): StoreCatalogListPrintRow[] {
  const out: StoreCatalogListPrintRow[] = [];
  for (const row of rows) {
    if (row.kind === 'standalone') {
      const it = row.item;
      out.push({
        itemCode: it.itemCode || '—',
        nameLabel: it.itemName || '—',
        variantLabel: (it.variantSpecification || '').trim() || '—',
        categoryLabel: (it.category || '—').trim() || '—',
        stockLabel: stockLine(Number(it.currentStock) || 0, it.unit || 'Unit'),
        statusLabel: statusLabel(it.active),
      });
      continue;
    }
    const { header, children } = row;
    out.push({
      itemCode: header.itemCode || '—',
      nameLabel: `${header.itemName || '—'} (เมน)`,
      variantLabel: '—',
      categoryLabel: (header.category || '—').trim() || '—',
      stockLabel: stockLine(sumChildStock(children), header.unit || 'Unit', '(รวมรุ่นย่อย)'),
      statusLabel: statusLabel(header.active),
      rowClass: 'scl-row-menu',
    });
    for (const child of children) {
      out.push({
        itemCode: child.itemCode || '—',
        nameLabel: `${header.itemName || '—'} (รุ่นย่อย)`,
        variantLabel: (child.variantSpecification || '').trim() || '—',
        categoryLabel: (child.category || header.category || '—').trim() || '—',
        stockLabel: stockLine(Number(child.currentStock) || 0, child.unit || header.unit || 'Unit'),
        statusLabel: statusLabel(child.active),
        rowClass: 'scl-row-child',
      });
    }
  }
  return out;
}

export function describeStoreCatalogPrintFilters(searchQuery: string, categoryFilter: string): string[] {
  const lines: string[] = [];
  if (categoryFilter !== 'all') {
    lines.push(`หมวดหมู่: ${categoryFilter}`);
  }
  if (searchQuery.trim()) {
    lines.push(`ค้นหา: "${searchQuery.trim()}"`);
  }
  return lines;
}

export function capStoreCatalogListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}

const SCL_PRINT_STYLES = `
  @page { size: A4 landscape; margin: 8mm; }
  .scl-wrap {
    font-family: Sarabun, sans-serif;
    font-size: 10pt;
    color: #111;
    width: 100%;
    max-width: 100%;
  }
  .scl-head-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
  }
  .scl-head-left { flex: 1 1 58%; min-width: 0; }
  .scl-head-right {
    flex: 0 1 42%;
    margin: 0;
    font-size: 9pt;
    color: #555;
    text-align: right;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .scl-title { font-size: 16pt; font-weight: 800; margin: 0; color: #0f3d5c; }
  .scl-scope { font-weight: 700; margin: 0; }
  .scl-filters { margin: 0 0 8px; padding-left: 18px; font-size: 9pt; color: #333; }
  .scl-table {
    width: 100%;
    max-width: 100%;
    border-collapse: collapse;
    font-size: 9pt;
    table-layout: fixed;
  }
  .scl-table th, .scl-table td {
    border: 1px solid #ccc;
    padding: 5px 6px;
    vertical-align: top;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    line-height: 1.25;
  }
  .scl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .scl-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; }
  .scl-num { text-align: center; font-weight: 700; white-space: nowrap; }
  .scl-row-menu td { background: #f8fafc; }
  .scl-row-child td:first-child { padding-left: 10px; }
  .scl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .scl-foot { margin-top: 4px; font-size: 8pt; color: #666; }
  @media print {
    .scl-wrap { overflow: visible !important; }
    .scl-title { font-size: 14pt; }
    .scl-table { font-size: 8.5pt; }
    .sd-list-report.scl-wrap .scl-table th,
    .sd-list-report.scl-wrap .scl-table td {
      padding: 5px 6px;
      line-height: 1.38;
    }
    .scl-mono { font-size: 8pt; }
    .scl-foot {
      page-break-before: auto !important;
      break-before: auto !important;
    }
  }
`;

function buildSclFilterBlock(filterLines: string[]): {
  filterBlock: string;
  scopeRight?: string;
} {
  if (filterLines.length === 0) {
    return {
      filterBlock: '',
      scopeRight: 'ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล',
    };
  }
  if (filterLines.length === 1) {
    return { filterBlock: '', scopeRight: filterLines[0] };
  }
  return {
    filterBlock: `<ul class="scl-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`,
    scopeRight: `ตัวกรอง ${filterLines.length} รายการ`,
  };
}

function buildSclHeader(params: {
  title: string;
  scopeTitle: string;
  rowCount: number;
  generatedAt: string;
  printedBy?: string;
  scopeRight?: string;
  filterBlock: string;
}): string {
  const printedMeta = `พิมพ์เมื่อ ${escapeHtmlDoc(params.generatedAt)}${params.printedBy ? ` · โดย ${escapeHtmlDoc(params.printedBy)}` : ''}`;
  return `
  <div class="scl-head-row">
    <h1 class="scl-title scl-head-left">${escapeHtmlDoc(params.title)}</h1>
    <p class="scl-head-right">${printedMeta}</p>
  </div>
  <div class="scl-head-row">
    <p class="scl-scope scl-head-left">${escapeHtmlDoc(params.scopeTitle)} — ${params.rowCount} รายการ</p>
    ${params.scopeRight ? `<p class="scl-head-right">${escapeHtmlDoc(params.scopeRight)}</p>` : '<span class="scl-head-right" aria-hidden="true"></span>'}
  </div>
  ${params.filterBlock}`;
}

export function buildStoreCatalogListPrintHtml(params: {
  variant: StoreCatalogPrintVariant;
  rows: StoreCatalogListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const { variant, rows, scopeTitle, filterLines, generatedAt, printedBy, truncated } = params;
  const { filterBlock, scopeRight } = buildSclFilterBlock(filterLines);

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="6" class="scl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr class="${r.rowClass || ''}">
              <td class="scl-mono">${escapeHtmlDoc(r.itemCode)}</td>
              <td>${escapeHtmlDoc(r.nameLabel)}</td>
              <td>${escapeHtmlDoc(r.variantLabel)}</td>
              <td>${escapeHtmlDoc(r.categoryLabel)}</td>
              <td class="scl-num">${escapeHtmlDoc(r.stockLabel)}</td>
              <td>${escapeHtmlDoc(r.statusLabel)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="scl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} แถว — ปรับตัวกรองเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>${SCL_PRINT_STYLES}</style>
<div class="sd-list-report scl-wrap">
  ${buildSclHeader({
    title: TITLES[variant],
    scopeTitle,
    rowCount: rows.length,
    generatedAt,
    printedBy,
    scopeRight,
    filterBlock,
  })}
  <table class="scl-table">
    <colgroup>
      <col style="width:11%" />
      <col style="width:24%" />
      <col style="width:18%" />
      <col style="width:12%" />
      <col style="width:15%" />
      <col style="width:10%" />
    </colgroup>
    <thead>
      <tr>
        <th>รหัส</th>
        <th>ชื่อหลัก</th>
        <th>ขนาด/รุ่น</th>
        <th>หมวดหมู่</th>
        <th class="scl-num">คงเหลือ</th>
        <th>สถานะ</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="scl-foot">${escapeHtmlDoc(FOOTERS[variant])}</p>
</div>`;
}
