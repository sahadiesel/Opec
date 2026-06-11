import { escapeHtmlDoc } from '@/lib/documents/standard-document-print';
import type { Vendor, VendorType } from '@/lib/types';

export type VendorListPrintRow = {
  vendorCode: string;
  vendorName: string;
  vendorTypeLabel: string;
  contactLine: string;
  phoneLine: string;
  creditTermsLine: string;
  status: string;
  taxId: string;
};

export type VendorListPrintFilterSummary = {
  searchTerm: string;
  typeFilter: string;
  statusFilter: string;
};

const PRINT_ROW_LIMIT = 500;

const VENDOR_TYPE_LABELS: Record<VendorType, string> = {
  PPE_SUPPLIER: 'PPE Supplier',
  TOOL_SUPPLIER: 'Tool Supplier',
  SERVICE_PROVIDER: 'Service Provider',
  TRANSPORT: 'Transport',
  ACCOMMODATION: 'Accommodation',
  OFFICE_EXPENSE: 'Office Expense',
  GENERAL_SUPPLIER: 'General Supplier',
};

export function vendorTypeLabel(type: VendorType | string | undefined): string {
  if (!type) return '—';
  return VENDOR_TYPE_LABELS[type as VendorType] ?? String(type).replace(/_/g, ' ');
}

export function describeVendorListPrintFilters(f: VendorListPrintFilterSummary): string[] {
  const lines: string[] = [];
  if (f.typeFilter !== 'ALL') {
    lines.push(`ประเภท: ${vendorTypeLabel(f.typeFilter)}`);
  }
  if (f.statusFilter !== 'ALL') {
    lines.push(`สถานะ: ${f.statusFilter}`);
  }
  if (f.searchTerm.trim()) {
    lines.push(`ค้นหา: "${f.searchTerm.trim()}"`);
  }
  return lines;
}

export function mapVendorToListPrintRow(v: Vendor): VendorListPrintRow {
  const terms = (v.paymentTerms || '—').trim();
  const days = v.creditDays != null ? `${v.creditDays} วัน` : '—';
  return {
    vendorCode: v.vendorCode || v.id.substring(0, 6),
    vendorName: v.vendorName || '—',
    vendorTypeLabel: vendorTypeLabel(v.vendorType),
    contactLine: v.contactName?.trim() || '—',
    phoneLine: v.phone?.trim() || '—',
    creditTermsLine: `${terms} (${days})`,
    status: v.status || '—',
    taxId: v.taxId?.trim() || '—',
  };
}

export function buildVendorListPrintHtml(params: {
  rows: VendorListPrintRow[];
  scopeTitle: string;
  filterLines: string[];
  generatedAt: string;
  printedBy?: string;
  truncated?: boolean;
}): string {
  const { rows, scopeTitle, filterLines, generatedAt, printedBy, truncated } = params;

  const filterBlock =
    filterLines.length > 0
      ? `<ul class="vl-filters">${filterLines.map((l) => `<li>${escapeHtmlDoc(l)}</li>`).join('')}</ul>`
      : '<p class="vl-muted">ไม่มีตัวกรอง — แสดงทุกรายการในชุดข้อมูล</p>';

  const tableRows =
    rows.length === 0
      ? '<tr><td colspan="6" class="vl-empty">ไม่มีรายการ</td></tr>'
      : rows
          .map(
            (r) => `<tr>
              <td class="vl-mono">${escapeHtmlDoc(r.vendorCode)}</td>
              <td>${escapeHtmlDoc(r.vendorName)}${r.taxId !== '—' ? `<br /><span class="vl-sub">${escapeHtmlDoc(r.taxId)}</span>` : ''}</td>
              <td>${escapeHtmlDoc(r.vendorTypeLabel)}</td>
              <td>${escapeHtmlDoc(r.contactLine)}<br /><span class="vl-sub">${escapeHtmlDoc(r.phoneLine)}</span></td>
              <td>${escapeHtmlDoc(r.creditTermsLine)}</td>
              <td>${escapeHtmlDoc(r.status)}</td>
            </tr>`,
          )
          .join('');

  const truncateNote = truncated
    ? `<p class="vl-foot">แสดงสูงสุด ${PRINT_ROW_LIMIT} รายการ — ปรับตัวกรองเพื่อแยกชุดข้อมูล</p>`
    : '';

  return `
<style>
  .vl-wrap { font-family: Sarabun, sans-serif; font-size: 10pt; color: #111; }
  .vl-title { font-size: 16pt; font-weight: 800; margin: 0 0 4px; color: #0f3d5c; }
  .vl-meta { font-size: 9pt; color: #555; margin-bottom: 12px; }
  .vl-scope { font-weight: 700; margin-bottom: 6px; }
  .vl-filters { margin: 0 0 12px; padding-left: 18px; font-size: 9pt; color: #333; }
  .vl-muted { font-size: 9pt; color: #666; margin: 0 0 12px; }
  .vl-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .vl-table th, .vl-table td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }
  .vl-table th { background: #f3f4f6; font-weight: 700; text-align: left; }
  .vl-mono { font-family: ui-monospace, monospace; font-size: 8.5pt; }
  .vl-sub { font-size: 8pt; color: #666; font-family: ui-monospace, monospace; }
  .vl-empty { text-align: center; padding: 24px; color: #666; font-style: italic; }
  .vl-foot { margin-top: 10px; font-size: 8pt; color: #666; }
</style>
<div class="sd-list-report vl-wrap">
  <h1 class="vl-title">รายการคู่ค้า / ผู้ขาย (Vendors)</h1>
  <p class="vl-meta">พิมพ์เมื่อ ${escapeHtmlDoc(generatedAt)}${printedBy ? ` · โดย ${escapeHtmlDoc(printedBy)}` : ''}</p>
  <p class="vl-scope">${escapeHtmlDoc(scopeTitle)} — ${rows.length} รายการ</p>
  ${filterBlock}
  <table class="vl-table">
    <thead>
      <tr>
        <th>รหัส</th>
        <th>ชื่อคู่ค้า</th>
        <th>ประเภท</th>
        <th>ผู้ติดต่อ / โทร</th>
        <th>Credit Terms</th>
        <th>สถานะ</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  ${truncateNote}
  <p class="vl-foot">OPEC OpsFlow — ทะเบียนคู่ค้า / ผู้ขาย</p>
</div>`;
}

export function capVendorListPrintRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= PRINT_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, PRINT_ROW_LIMIT), truncated: true };
}
