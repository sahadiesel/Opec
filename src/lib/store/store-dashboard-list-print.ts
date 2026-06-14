import type { StoreItem, StoreTransaction } from '@/lib/types';
import { formatStoreItemLabel } from '@/lib/types';
import { formatYmdLocalThaiBE } from '@/lib/date-thai';
import type { StoreDemandRequirementRow } from '@/lib/store/store-demand-requirements';
import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type StoreDashboardPrintTab = 'alerts' | 'returns' | 'recent' | 'requirements';

const PRINT_ROW_LIMIT = 500;

const TAB_META: Record<
  StoreDashboardPrintTab,
  { title: string; footer: string; scopeDefault: string }
> = {
  alerts: {
    title: 'แจ้งเตือนสต็อก (Stock Alerts)',
    footer: 'OPEC OpsFlow — แจ้งเตือนสต็อก (Store)',
    scopeDefault: 'รายการที่คงเหลือ ≤ เกณฑ์ขั้นต่ำ',
  },
  returns: {
    title: 'รายการค้างคืน (Pending Returns)',
    footer: 'OPEC OpsFlow — รายการค้างคืน (Store)',
    scopeDefault: 'ยอดค้างจาก ISSUE หัก RETURN / DAMAGED / LOST',
  },
  recent: {
    title: 'ความเคลื่อนไหวล่าสุด (Recent Transactions)',
    footer: 'OPEC OpsFlow — ความเคลื่อนไหวล่าสุด (Store)',
    scopeDefault: 'เรียงจากรายการล่าสุดในระบบ',
  },
  requirements: {
    title: 'ความต้องการจัดซื้อ (Demand Requirements)',
    footer: 'OPEC OpsFlow — ความต้องการจัดซื้อ (Store)',
    scopeDefault: 'ความต้องการจาก mobilization ที่ยังเบิกไม่ครบ',
  },
};

const TAB_COLUMNS: Record<StoreDashboardPrintTab, string[]> = {
  alerts: ['รหัส', 'ชื่อหลัก', 'ขนาด/รุ่น', 'หมวดหมู่', 'คงเหลือ', 'เกณฑ์ขั้นต่ำ', 'จำนวนที่ขาด'],
  returns: ['ผู้ถือครอง', 'บริบท', 'รอบ / ประเภท', 'จำนวนค้าง'],
  recent: ['วันที่', 'ประเภท', 'อุปกรณ์', 'จำนวน', 'อ้างอิง / ผู้เบิก', 'ผู้ทำรายการ'],
  requirements: ['อุปกรณ์ (เมน)', 'ความต้องการ', 'สต็อกตามรุ่นย่อย', 'ขาดรวม', 'คำแนะนำ'],
};

const SDB_PRINT_STYLES = `
  @page { size: A4 landscape; margin: 8mm; }
  .sdb-wrap {
    font-family: Sarabun, sans-serif;
    font-size: 10pt;
    color: #111;
    width: 100%;
    max-width: 100%;
  }
  .sdb-head-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
  }
  .sdb-head-left { flex: 1 1 58%; min-width: 0; }
  .sdb-head-right {
    flex: 0 1 42%;
    margin: 0;
    font-size: 9pt;
    color: #555;
    text-align: right;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .sdb-title { font-size: 16pt; font-weight: 800; margin: 0; color: #0f3d5c; }
  .sdb-scope { font-weight: 700; margin: 0; }
  .sdb-table {
    width: 100%;
    max-width: 100%;
    border-collapse: collapse;
    font-size: 9pt;
    table-layout: fixed;
  }
  .sdb-table th, .sdb-table td {
    border: 1px solid #ccc;
    padding: 5px 6px;
    vertical-align: top;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    line-height: 1.25;
  }
  .sdb-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .sdb-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; }
  .sdb-num { text-align: center; font-weight: 700; white-space: nowrap; }
  .sdb-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .sdb-foot { margin-top: 4px; font-size: 8pt; color: #666; }
  @media print {
    .sdb-wrap { overflow: visible !important; }
    .sdb-title { font-size: 14pt; }
    .sdb-table { font-size: 8.5pt; }
    .sd-list-report.sdb-wrap .sdb-table th,
    .sd-list-report.sdb-wrap .sdb-table td {
      padding: 5px 6px;
      line-height: 1.38;
    }
    .sdb-mono { font-size: 8pt; }
    .sdb-foot {
      page-break-before: auto !important;
      break-before: auto !important;
    }
  }
`;

function capRows(rows: string[][]): { rows: string[][]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}

export function mapStockAlertPrintRows(items: StoreItem[]): string[][] {
  return items.map((item) => {
    const shortage = Math.max(0, (Number(item.minimumStock) || 0) - (Number(item.currentStock) || 0));
    return [
      item.itemCode || '—',
      (item.itemName || '').trim() || '—',
      (item.variantSpecification || '').trim() || '—',
      (item.category || '—').trim() || '—',
      `${item.currentStock} ${item.unit || ''}`.trim(),
      String(item.minimumStock ?? '—'),
      String(shortage),
    ];
  });
}

export type PendingReturnPrintRow =
  | {
      kind: 'field';
      workerName: string;
      projectName: string;
      waveCode: string;
      totalQty: number;
    }
  | {
      kind: 'office';
      staffName: string;
      totalQty: number;
    };

export function mapPendingReturnPrintRows(rows: PendingReturnPrintRow[]): string[][] {
  return rows.map((ret) => {
    if (ret.kind === 'field') {
      return [ret.workerName, ret.projectName, ret.waveCode, String(ret.totalQty)];
    }
    return [ret.staffName, 'พนักงานออฟฟิศ (ไม่ผูก mobilization)', 'Office', String(ret.totalQty)];
  });
}

export function mapRecentTransactionPrintRows(params: {
  transactions: StoreTransaction[];
  items: StoreItem[] | null | undefined;
  workerNameById: Map<string, string>;
  officeNameById: Map<string, string>;
  isOpsOrHR: boolean;
}): string[][] {
  const { transactions, items, workerNameById, officeNameById, isOpsOrHR } = params;
  return transactions.map((tx) => {
    const item = items?.find((i) => i.id === tx.itemId);
    const itemLabel = item ? formatStoreItemLabel(item) : `ไม่พบในทะเบียน (${tx.itemId})`;
    const dateStr = formatYmdLocalThaiBE(tx.transactionDate, tx.transactionDate || '—');
    const wid = (tx.workerId || '').trim();
    const oid = (tx.officeStaffId || '').trim();
    const holderLabel =
      (oid ? officeNameById.get(oid) : undefined) ||
      (wid ? workerNameById.get(wid) : undefined) ||
      (tx.referenceId ? `Ref: ${tx.referenceId.substring(0, 8)}` : '') ||
      (isOpsOrHR ? '—' : 'Restricted');
    const holderSuffix = oid ? `${holderLabel} (Office borrow)` : holderLabel;
    return [
      dateStr,
      tx.transactionType || '—',
      itemLabel,
      String(tx.quantity ?? '—'),
      holderSuffix,
      tx.createdBy || '—',
    ];
  });
}

export function mapDemandRequirementPrintRows(rows: StoreDemandRequirementRow[]): string[][] {
  return rows.map((row) => {
    const variantText =
      row.variantStocks.length === 0
        ? 'ไม่พบ SKU ในคลัง'
        : [
            ...row.variantStocks.map((v) => `${v.label}: ${v.currentStock} ${v.unit}`),
            `รวมในคลัง ${row.totalAvailable} ${row.unit}`,
          ].join(' · ');
    const advice =
      row.aggregateShortage > 0 ? 'ตรวจสอบรุ่นย่อย / สั่งซื้อ' : 'สต็อกรวมพอ';
    const nameLine = row.itemCode
      ? `${row.displayName} (${row.itemCode})`
      : row.displayName;
    const demandLine =
      row.mobilizationHits > 0
        ? `${row.demand} ${row.unit} · ${row.mobilizationHits} mobilization`
        : `${row.demand} ${row.unit}`;
    return [
      nameLine,
      demandLine,
      variantText,
      row.aggregateShortage > 0 ? String(row.aggregateShortage) : '—',
      advice,
    ];
  });
}

export function buildStoreDashboardListPrintHtml(params: {
  tab: StoreDashboardPrintTab;
  rows: string[][];
  rowCount?: number;
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const { tab, rows, generatedAt, printedBy, truncated } = params;
  const meta = TAB_META[tab];
  const columns = TAB_COLUMNS[tab];
  const rowCount = params.rowCount ?? rows.length;
  const printedMeta = `พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}`;

  const tableRows =
    rows.length === 0
      ? `<tr><td colspan="${columns.length}" class="sdb-empty">ไม่มีรายการ</td></tr>`
      : rows
          .map(
            (cells) => `<tr>${cells
              .map((cell, idx) => {
                const cls =
                  idx === 0 && tab === 'alerts'
                    ? ' class="sdb-mono"'
                    : tab === 'returns' && idx === 3
                      ? ' class="sdb-num"'
                      : tab === 'recent' && idx === 3
                        ? ' class="sdb-num"'
                        : tab === 'requirements' && (idx === 1 || idx === 3)
                          ? ' class="sdb-num"'
                          : tab === 'alerts' && (idx === 4 || idx === 5 || idx === 6)
                            ? ' class="sdb-num"'
                            : '';
                return `<td${cls}>${escapeHtmlDoc(cell)}</td>`;
              })
              .join('')}</tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="sdb-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ดูรายละเอียดเพิ่มในระบบ</p>`
    : '';

  const colgroup = columns
    .map((_, i) => {
      const n = columns.length;
      const w = Math.floor(100 / n);
      return `<col style="width:${i === n - 1 && n > 4 ? w + 2 : w}%" />`;
    })
    .join('');

  return `
<style>${SDB_PRINT_STYLES}</style>
<div class="sd-list-report sdb-wrap">
  <div class="sdb-head-row">
    <h1 class="sdb-title sdb-head-left">${escapeHtmlDoc(meta.title)}</h1>
    <p class="sdb-head-right">${printedMeta}</p>
  </div>
  <div class="sdb-head-row">
    <p class="sdb-scope sdb-head-left">${escapeHtmlDoc(meta.scopeDefault)} — ${rowCount} รายการ</p>
    <p class="sdb-head-right">${escapeHtmlDoc(generatedAt)}</p>
  </div>
  <table class="sdb-table">
    <colgroup>${colgroup}</colgroup>
    <thead>
      <tr>${columns.map((c) => `<th>${escapeHtmlDoc(c)}</th>`).join('')}</tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="sdb-foot">${escapeHtmlDoc(meta.footer)}</p>
</div>`;
}

export function capStoreDashboardPrintRows(rows: string[][]): { rows: string[][]; truncated: boolean } {
  return capRows(rows);
}

export const STORE_DASHBOARD_PRINT_FILE: Record<StoreDashboardPrintTab, string> = {
  alerts: 'Store-Stock-Alerts',
  returns: 'Store-Pending-Returns',
  recent: 'Store-Recent-Movements',
  requirements: 'Store-Demand-Requirements',
};
