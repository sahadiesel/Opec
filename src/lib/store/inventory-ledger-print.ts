import type { Assignment, OfficeStaff, StoreItem, StoreTransaction, Wave, Worker } from '@/lib/types';
import { formatStoreItemLabel } from '@/lib/types';
import { formatTimeThaiBE, formatYmdLocalThaiBE } from '@/lib/date-thai';
import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';

export type LedgerPrintContext = {
  items: StoreItem[] | null | undefined;
  workers: Worker[] | null | undefined;
  assignments: Assignment[] | null | undefined;
  waves: Wave[] | null | undefined;
  officeStaffList: OfficeStaff[] | null | undefined;
};

export type LedgerPrintFilterSummary = {
  monthYyyyMm: string;
  itemSearch: string;
  holderLabel: string;
  typeFilter: string;
  categoryFilter: string;
};

const TYPE_LABELS: Record<string, string> = {
  RECEIVE: 'รับเข้า (RECEIVE)',
  ISSUE: 'เบิก (ISSUE)',
  RETURN: 'รับคืน (RETURN)',
  WRITEOFF: 'ตัดยอด (WRITEOFF)',
  DAMAGED: 'ชำรุด (DAMAGED)',
  LOST: 'สูญหาย (LOST)',
};

function requesterLabel(tx: StoreTransaction, ctx: LedgerPrintContext): string {
  const oid = (tx.officeStaffId || '').trim();
  if (oid) {
    const st = ctx.officeStaffList?.find((o) => o.id === oid);
    return (st?.fullName || '').trim() || oid;
  }
  const wid = (tx.workerId || '').trim();
  if (wid) {
    const w = ctx.workers?.find((x) => x.id === wid);
    return `${w?.firstName || ''} ${w?.lastName || ''}`.trim() || wid;
  }
  return '';
}

function detailLines(tx: StoreTransaction, ctx: LedgerPrintContext): string {
  const parts: string[] = [];
  const requester = requesterLabel(tx, ctx);
  if (requester) parts.push(requester);

  const oid = (tx.officeStaffId || '').trim();
  if (oid) {
    parts.push('พนักงานออฟฟิศ');
  } else {
    const asgn = ctx.assignments?.find((a) => a.id === tx.assignmentId);
    if (asgn?.projectName) parts.push(asgn.projectName);
    const wave = ctx.waves?.find((w) => w.id === tx.waveId);
    if (wave?.waveCode) parts.push(wave.waveCode);
  }

  if (tx.notes?.trim()) {
    parts.push(tx.notes.replace(/\s+/g, ' ').trim().slice(0, 100));
  }
  return parts.filter(Boolean).join(' · ');
}

function quantityDisplay(tx: StoreTransaction, unit: string): string {
  const outflow = tx.transactionType === 'ISSUE' || tx.transactionType === 'WRITEOFF';
  const sign = outflow ? '-' : '+';
  return `${sign}${tx.quantity} ${unit}`.trim();
}

export function ledgerBangkokYyyyMmNow(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
}

export function formatLedgerMonthLabel(yyyyMm: string): string {
  const parts = yyyyMm.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  if (!y || !m) return yyyyMm;
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}

export function ledgerMonthSelectOptions(countBack = 36): { value: string; label: string }[] {
  const now = ledgerBangkokYyyyMmNow();
  const parts = now.split('-').map(Number);
  let y = parts[0] ?? new Date().getFullYear();
  let m = parts[1] ?? 1;
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i <= countBack; i++) {
    const value = `${y}-${String(m).padStart(2, '0')}`;
    out.push({ value, label: formatLedgerMonthLabel(value) });
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export function storeTransactionInLedgerMonth(tx: StoreTransaction, yyyyMm: string): boolean {
  const ymd = (tx.transactionDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return ymd.slice(0, 7) === yyyyMm;
  }
  if (tx.createdAt) {
    const bangkokYmd = new Date(tx.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    return bangkokYmd.slice(0, 7) === yyyyMm;
  }
  return false;
}

export function describeLedgerPrintFilters(f: LedgerPrintFilterSummary): string[] {
  const lines: string[] = [];
  lines.push(`เดือน: ${formatLedgerMonthLabel(f.monthYyyyMm)}`);
  if (f.itemSearch.trim()) lines.push(`อุปกรณ์: "${f.itemSearch.trim()}"`);
  if (f.holderLabel.trim()) lines.push(`ผู้เบิก/ผู้ถือครอง: ${f.holderLabel.trim()}`);
  if (f.typeFilter !== 'ALL') {
    lines.push(`ประเภท: ${TYPE_LABELS[f.typeFilter] ?? f.typeFilter}`);
  }
  if (f.categoryFilter !== 'ALL') lines.push(`หมวดหมู่: ${f.categoryFilter}`);
  return lines;
}

export function buildInventoryLedgerPrintHtml(params: {
  rows: StoreTransaction[];
  ctx: LedgerPrintContext;
  scopeTitle: string;
  filterLines: string[];
  generatedAt: string;
  printedBy?: string;
}): string {
  const { rows, ctx, scopeTitle, filterLines, generatedAt, printedBy } = params;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="il-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="il-muted">ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล</p>';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="7" class="il-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map((tx) => {
            const item = ctx.items?.find((i) => i.id === tx.itemId);
            const itemLabel = item ? formatStoreItemLabel(item) : 'Unknown Item';
            const itemCode = item?.itemCode || 'N/A';
            const unit = item?.unit || '';
            const dateStr = formatYmdLocalThaiBE(tx.transactionDate, tx.transactionDate || '—');
            const timeStr = formatTimeThaiBE(tx.createdAt);
            const typeLabel = TYPE_LABELS[tx.transactionType] ?? tx.transactionType;
            const refType = tx.referenceType || 'Direct';
            const refId = tx.referenceId?.substring(0, 12) || '—';

            return `<tr>
              <td>${escapeHtmlDoc(dateStr)}<br/><span class="il-sub">${escapeHtmlDoc(timeStr)}</span></td>
              <td>${escapeHtmlDoc(typeLabel)}</td>
              <td><strong>${escapeHtmlDoc(itemLabel)}</strong><br/><span class="il-sub">${escapeHtmlDoc(itemCode)}</span></td>
              <td class="il-num">${escapeHtmlDoc(quantityDisplay(tx, unit))}</td>
              <td>${escapeHtmlDoc(refType)}<br/><span class="il-sub">${escapeHtmlDoc(refId)}</span></td>
              <td>${escapeHtmlDoc(detailLines(tx, ctx) || '—')}</td>
              <td>${escapeHtmlDoc(tx.createdBy || '—')}</td>
            </tr>`;
          })
          .join('');

  return `
<style>
  .il-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .il-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .il-meta { font-size: 9pt; color: #555; margin-bottom: 12px; }
  .il-scope { font-weight: 700; margin-bottom: 6px; }
  .il-filters { margin: 0 0 12px; padding-left: 18px; font-size: 9pt; color: #333; }
  .il-muted { font-size: 9pt; color: #666; margin: 0 0 12px; }
  .il-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .il-table th, .il-table td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }
  .il-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .il-num { text-align: center; font-weight: 700; white-space: nowrap; }
  .il-sub { font-size: 8pt; color: #666; }
  .il-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .il-foot { margin-top: 10px; font-size: 8pt; color: #666; }
</style>
<div class="il-wrap">
  <h1 class="il-title">ประวัติการเคลื่อนไหวสินค้า (Inventory Ledger)</h1>
  <p class="il-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="il-scope">${escapeHtmlDoc(scopeTitle)} — ${rows.length} รายการ</p>
  ${filterBlock}
  <table class="il-table">
    <thead>
      <tr>
        <th>วันที่ / เวลา</th>
        <th>ประเภท</th>
        <th>อุปกรณ์</th>
        <th>จำนวน</th>
        <th>อ้างอิง</th>
        <th>ผู้เบิก / รายละเอียด</th>
        <th>ผู้บันทึก</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  <p class="il-foot">OPEC OpsFlow — สมุดบัญชีสินค้าคลัง (ข้อมูลจากระบบ ไม่รวมรายการที่เกินขีดจำกัดการดึงข้อมูลล่าสุด)</p>
</div>`;
}
