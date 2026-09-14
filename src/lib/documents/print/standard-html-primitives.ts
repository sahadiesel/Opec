/**
 * มาตรฐานรูปแบบพิมพ์เอกสาร — shared HTML/CSS primitives
 * =====================================================
 * คลาส CSS prefix `sd-` จาก `STANDARD_DOCUMENT_PRINT_CSS`
 * ฟังก์ชันประกอบ `buildStandard*` / `wrapStandardPrintDocument` / `escapeHtmlDoc`
 */

import type {
  BillingNoteLine,
  CommercialInvoiceLine,
  Customer,
} from '@/lib/types';
import {
  formatStoredDateGregorian,
  formatStoredDateThaiBE,
} from '@/lib/date-thai';
import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';
import { printT } from '@/lib/documents/document-print-i18n';

export type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';

export type CompanyProfilePrint = {
  companyNameTh?: string;
  companyNameEn?: string;
  taxId?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  /** จาก Document Header Profile — แสดงท้ายชื่อบริษัทบนเอกสาร */
  branchType?: 'head_office' | 'branch';
  branchNo?: string;
};

/** ฟิลด์สาขาที่ใช้ต่อท้ายชื่อบริษัท/ลูกค้าบนเอกสาร */
export type PartyBranchFields = {
  branchType?: 'head_office' | 'branch' | string | null;
  branchNo?: string | null;
};

/**
 * ข้อความวงเล็บสาขา ตามภาษาเอกสาร
 * TH: `(สำนักงานใหญ่)` / `(สาขา 00004)`
 * EN: `(HEAD OFFICE)` / `(BRANCH NO. 00004)`
 */
export function formatPartyBranchParenLabel(
  party: PartyBranchFields | null | undefined,
  locale: PrintDocumentLocale = 'th',
): string {
  if (!party) return '';
  const isBranch = String(party.branchType || '').trim() === 'branch';
  if (!isBranch) {
    return locale === 'en' ? '(HEAD OFFICE)' : '(สำนักงานใหญ่)';
  }
  const no = String(party.branchNo || '').trim();
  if (locale === 'en') return no ? `(BRANCH NO. ${no})` : '(BRANCH NO.)';
  return no ? `(สาขา ${no})` : '(สาขา)';
}

const BRANCH_PAREN_ALREADY_RE =
  /\((?:สำนักงานใหญ่|สาขา\s*[^)]+|HEAD OFFICE|Head Office|BRANCH NO\.?\s*[^)]*|Branch\s*[^)]+)\)\s*$/i;

/** ต่อท้ายชื่อด้วยวงเล็บสาขา — ไม่ซ้ำถ้ามีอยู่แล้ว */
export function appendPartyBranchParenToName(
  name: string,
  party: PartyBranchFields | null | undefined,
  locale: PrintDocumentLocale = 'th',
): string {
  const base = String(name || '').trim();
  if (!base || base === '—') return base || '—';
  if (BRANCH_PAREN_ALREADY_RE.test(base)) return base;
  const label = formatPartyBranchParenLabel(party, locale);
  if (!label) return base;
  return `${base} ${label}`;
}

/** ชื่อลูกค้าบนเอกสารพิมพ์ + วงเล็บสาขาจากทะเบียนลูกค้า */
export function formatCustomerPartyNameForPrint(
  customer: Pick<Customer, 'name' | 'branchType' | 'branchNo'> | null | undefined,
  overrideName?: string | null,
  locale: PrintDocumentLocale = 'th',
): string {
  const raw = customer?.name?.trim() || String(overrideName || '').trim() || '—';
  if (!customer) return raw;
  return appendPartyBranchParenToName(raw, customer, locale);
}

/** แถว meta คอลัมน์ขวา: คู่ label–value หรือบรรทัดเต็ม (จัดชิดขวา) */
export type StandardDocMetaRow = { label: string; value: string } | { line: string };

export function escapeHtmlDoc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** จัดหมายเหตุเอกสารให้ขึ้นบรรทัดตาม textarea (รองรับข้อมูลเก่าที่บันทึกเป็นบรรทัดเดียว) */
export function formatDocumentNotesForPrint(notes: string): string {
  const normalized = notes.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  if (normalized.includes('\n')) return normalized;
  const fromCommercial = normalized
    .replace(/\s+(?=(?:Job Assignment No\.|Project Name\s*:|Subcontact No\s*:))/gi, '\n')
    .trim();
  if (fromCommercial.includes('\n')) return fromCommercial;
  /** รายการเลขที่พิมพ์ติดกันในบรรทัดเดียว เช่น "1.aaa 2.bbb 3.ccc" */
  if (/(?:^|\s)\d+[.)]\S/.test(normalized) || /(?:^|\s)\d+[.)]\s+\S/.test(normalized)) {
    return normalized.replace(/\s+(?=\d+[.)])/g, '\n').trim();
  }
  return fromCommercial;
}

/**
 * Chrome/Edge use `document.title` as the default "Save as" name for Print → PDF.
 * Strip characters invalid on common filesystems.
 */
export function sanitizePrintFileBaseName(raw: string): string {
  let s = raw
    .trim()
    .replace(/[/\\:*?"<>|]+/g, '-')
    .replace(/[\x00-\x1f\x7f]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/[. ]+$/g, '')
    .trim();
  if (s.length > 180) s = s.slice(0, 180).replace(/[. ]+$/g, '').trim();
  return s || 'document';
}

/** คัดลอกแบบ synchronous ใน user gesture — textarea ต้องโฟกัสได้จริง มิฉะนั้น Edge มักคืน true แต่คลิปบอร์ดว่าง */
function copyTextToClipboardSync(text: string): boolean {
  if (!text) return false;
  const onCopy = (e: ClipboardEvent) => {
    e.clipboardData?.setData('text/plain', text);
    e.preventDefault();
  };
  let ta: HTMLTextAreaElement | null = null;
  try {
    document.addEventListener('copy', onCopy, true);
    ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText =
      'position:fixed;top:4px;left:4px;width:min(90vw,420px);height:44px;opacity:0.12;z-index:2147483647;font:12px system-ui,monospace;padding:6px;border:1px solid #888;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.removeEventListener('copy', onCopy, true);
    ta?.remove();
  }
}

async function copyPrintFileNameBestEffort(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof window !== 'undefined' && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through */
    }
  }
  return copyTextToClipboardSync(text);
}

/** ลำดับรายการใบวางบิล: เอา displayOrder (เดียวกับลำดับใบเรียกเก็บ) ก่อน แล้วค่อย createdAt + id */
export function sortBillingNoteLinesForDisplay(
  lines: BillingNoteLine[] | null | undefined,
): BillingNoteLine[] {
  return [...(lines || [])].sort((a, b) => {
    const ao = a.displayOrder;
    const bo = b.displayOrder;
    if (ao != null && bo != null) return ao - bo;
    if (ao != null) return -1;
    if (bo != null) return 1;
    const t = (a.createdAt ?? 0) - (b.createdAt ?? 0);
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });
}

/** ลำดับแสดงใบเรียกเก็บ — สอดคล้องใบวางบิล / พิมพ์ใบกำกับ */
export function sortCommercialInvoiceLinesForDisplay(
  lines: CommercialInvoiceLine[] | null | undefined,
): CommercialInvoiceLine[] {
  return [...(lines || [])].sort((a, b) => {
    const ao = a.displayOrder;
    const bo = b.displayOrder;
    if (ao != null && bo != null) return ao - bo;
    if (ao != null) return -1;
    if (bo != null) return 1;
    return (a.id || '').localeCompare(b.id || '');
  });
}

/** เลขลำดับบนเอกสาร (1-based) — `displayOrder` จากระบบเป็น 0-based */
export function invoiceLineSequenceNumberFromDisplayOrder(
  displayOrder: number | undefined | null,
  sortedIndexZeroBased: number,
): number {
  if (displayOrder != null && Number.isFinite(Number(displayOrder))) {
    return Number(displayOrder) + 1;
  }
  return sortedIndexZeroBased + 1;
}

export function formatIssueDateYmdForPrint(issueYmd: string | undefined, locale: PrintDocumentLocale): string {
  if (!issueYmd?.trim()) return '—';
  return locale === 'en' ? formatStoredDateGregorian(issueYmd) : formatStoredDateThaiBE(issueYmd);
}

/** สี teal หลัก — ให้สอดคล้องธีมเอกสารเรียบ (ใกล้เคียงตัวอย่างใบกำกับ) */
const ACCENT = '#0d9488';

export const STANDARD_DOCUMENT_PRINT_CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: 'Sarabun', 'Prompt', system-ui, -apple-system, sans-serif;
    color: #171717;
    margin: 0;
    padding: 4mm 12mm 22mm 12mm;
    font-size: 10pt;
    line-height: 1.35;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sd-page {
    max-width: 21cm;
    margin: 0 auto;
    position: relative;
  }
  .sd-status-watermark {
    position: absolute;
    inset: 18% 8% 22% 8%;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 5;
    overflow: hidden;
  }
  .sd-status-watermark-text {
    font-size: 72pt;
    font-weight: 900;
    letter-spacing: 0.12em;
    color: #737373;
    opacity: 0.5;
    transform: rotate(-32deg);
    user-select: none;
    white-space: nowrap;
    line-height: 1;
  }
  .sd-status-watermark--cancel .sd-status-watermark-text {
    color: #b91c1c;
    opacity: 0.48;
  }
  .sd-cancel-reason {
    margin: 6px 0 8px;
    padding: 6px 8px;
    border: 1px solid #fecaca;
    background: #fef2f2;
    font-size: 9pt;
    color: #7f1d1d;
  }
  .sd-replace-notice {
    margin: 0 0 8px;
    font-size: 9pt;
    color: #525252;
  }
  @media print {
    .sd-page + .sd-page {
      page-break-before: always;
    }
  }
  .sd-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
    padding-bottom: 5px;
    border-bottom: 1.5px solid ${ACCENT};
    margin-bottom: 6px;
  }
  .sd-company-col {
    flex: 0 1 60%;
    max-width: 60%;
    min-width: 0;
  }
  .sd-company-name {
    font-weight: 800;
    font-size: 10.5pt;
    margin: 0 0 2px 0;
    white-space: nowrap;
    line-height: 1.2;
  }
  .sd-company-line { margin: 0; color: #404040; font-size: 8pt; line-height: 1.25; }
  .sd-company-addr { white-space: normal; overflow-wrap: break-word; word-wrap: break-word; }
  .sd-doc-title {
    margin: 0;
    font-size: 13pt;
    font-weight: 800;
    color: ${ACCENT};
    text-align: right;
    line-height: 1.15;
  }
  .sd-doc-subtitle {
    margin: 2px 0 0 0;
    font-size: 9pt;
    font-weight: 700;
    color: #404040;
    text-align: right;
    line-height: 1.2;
  }
  .sd-doc-title-en {
    display: block;
    margin-top: 2px;
    font-size: 9.5pt;
    font-weight: 600;
    color: #525252;
    text-align: right;
  }
  .sd-title-col { flex: 1; min-width: 0; max-width: 40%; text-align: right; }
  .sd-meta-rows { margin-top: 4px; display: block; width: 100%; }
  .sd-meta-row {
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.15em 0.5em;
    width: 100%;
    font-size: 8.5pt;
    line-height: 1.25;
  }
  .sd-meta-row + .sd-meta-row { margin-top: 1px; }
  .sd-meta-lbl { flex: 0 0 auto; max-width: 52%; text-align: right; font-weight: 700; }
  .sd-meta-val {
    flex: 0 1 auto;
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .sd-meta-line {
    width: 100%;
    text-align: right;
    font-size: 8.5pt;
    line-height: 1.25;
  }
  .sd-meta-line + .sd-meta-line { margin-top: 2px; }
  .sd-party {
    border: 1px solid #d4d4d8;
    border-radius: 3px;
    padding: 5px 8px;
    margin-bottom: 6px;
  }
  .sd-party-label {
    margin: 0 0 2px 0;
    font-size: 8pt;
    font-weight: 700;
    color: ${ACCENT};
  }
  .sd-party-name { margin: 0; font-weight: 700; font-size: 9.5pt; line-height: 1.25; }
  .sd-party-line { margin: 1px 0 0 0; font-size: 8pt; color: #404040; white-space: pre-wrap; line-height: 1.25; }
  .sd-table { width: 100%; border-collapse: collapse; margin: 6px 0; }
  .sd-table thead { display: table-header-group; }
  .sd-table th {
    background: #f4f4f5;
    border: 1px solid #d4d4d8;
    padding: 4px 5px;
    font-size: 8.5pt;
    font-weight: 700;
    text-align: left;
  }
  .sd-table th.sd-num, .sd-table td.sd-num { text-align: center; width: 28px; }
  .sd-table th.sd-right, .sd-table td.sd-right { text-align: right; }
  .sd-table td {
    border: 1px solid #e4e4e7;
    padding: 4px 5px;
    font-size: 9pt;
    vertical-align: top;
  }
  .sd-line-desc {
    white-space: pre-line;
    line-height: 1.25;
  }
  .sd-line-remarks {
    margin-top: 2px;
    font-size: 8pt;
    color: #64748b;
    white-space: pre-line;
    line-height: 1.25;
    font-style: italic;
  }
  .sd-totals-wrap { display: flex; justify-content: flex-end; margin-top: 8px; }
  .sd-totals-notes-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px 24px;
    margin-top: 8px;
    align-items: start;
  }
  .sd-totals-notes-row .sd-totals-wrap { margin-top: 0; }
  /** คอลัมน์ซ้าย — กล่อง TERMS & NOTES กว้างเต็ม ไม่ถูกบีบด้วยข้อความจำนวนเงิน */
  .sd-notes-col {
    min-width: 0;
    width: 100%;
  }
  .sd-notes-box {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid #bae6fd;
    border-radius: 4px;
    padding: 8px 10px;
    min-height: 72px;
    font-size: 9.5pt;
    color: #404040;
  }
  .sd-notes-box-title {
    margin: 0 0 6px 0;
    font-size: 8pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748b;
  }
  .sd-notes-box-body {
    margin: 0;
    white-space: pre-line;
    line-height: 1.45;
  }
  .sd-totals { width: 280px; font-size: 10pt; }
  .sd-totals-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f4f4f5; }
  .sd-totals-row.sd-grand { border-bottom: none; margin-top: 6px; padding-top: 8px; }
  .sd-totals-row.sd-grand .sd-total-label { font-weight: 800; }
  .sd-totals-row.sd-grand .sd-total-val {
    font-weight: 800;
    font-size: 11pt;
    color: ${ACCENT};
  }
  .sd-amount-words {
    text-align: right;
    font-size: 9pt;
    color: #525252;
    margin-top: 6px;
    font-style: italic;
  }
  /** ซ้อน: แถว notes+totals แล้วตามด้วยจำนวนเงินเป็นคำเต็มความกว้าง แถวเดียว */
  .sd-totals-notes-stack {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
    width: 100%;
  }
  .sd-totals-notes-stack > .sd-totals-notes-row {
    margin-top: 0;
  }
  .sd-amount-words.sd-amount-words--under-notes {
    display: block;
    width: 100%;
    max-width: 100%;
    margin: 0;
    text-align: right;
    font-size: 8.5pt;
    line-height: 1.35;
    color: #525252;
    font-style: italic;
    white-space: nowrap;
  }
  @media print {
    .sd-amount-words.sd-amount-words--under-notes {
      font-size: 8pt;
    }
  }
  .sd-section-title {
    margin: 20px 0 8px 0;
    font-size: 10.5pt;
    font-weight: 800;
    color: #262626;
  }
  .sd-terms { margin: 0; padding-left: 18px; font-size: 9.5pt; color: #404040; }
  .sd-terms li { margin-bottom: 4px; }
  .sd-notes {
    font-size: 9.5pt;
    color: #404040;
    margin-top: 10px;
    white-space: pre-line;
    line-height: 1.45;
  }
  .sd-wht { font-size: 9.5pt; color: #404040; margin-top: 8px; }
  .sd-sign-footer {
    margin-top: 10mm;
    margin-bottom: 4mm;
    padding-top: 5mm;
    border-top: 1px solid #e4e4e7;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .sd-signatures {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 48px;
    margin-top: 0;
    padding-top: 0;
    border-top: none;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .sd-sign-block { text-align: center; }
  .sd-sign-line {
    border-top: 1px dotted #737373;
    margin: 48px 12px 8px 12px;
    height: 0;
  }
  .sd-sign-role { font-size: 9pt; color: #525252; margin: 0; }
  .sd-sign-name { font-size: 10.5pt; font-weight: 700; margin: 4px 0 0 0; }
  .sd-approval-notice {
    margin-top: 12px;
    font-size: 9pt;
    color: #404040;
    text-align: center;
    line-height: 1.4;
    padding-bottom: 2mm;
  }
  .sd-purchase-type-line {
    margin: 0 0 4px 0;
    font-size: 8.5pt;
    color: #404040;
    line-height: 1.25;
  }
  .sd-doc-ref {
    border: 1px solid #d4d4d8;
    border-radius: 4px;
    padding: 8px 12px;
    margin-bottom: 12px;
    font-size: 9.5pt;
    color: #404040;
  }
  .sd-doc-ref-title {
    margin: 0 0 6px 0;
    font-size: 10pt;
    font-weight: 700;
    color: ${ACCENT};
  }
  .sd-doc-ref-line { margin: 2px 0 0 0; line-height: 1.4; }
  .sd-doc-ref--inline .sd-doc-ref-title { margin: 0 0 4px 0; }
  .sd-doc-ref-cols {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px 12px;
    align-items: start;
    line-height: 1.35;
    font-size: 9pt;
  }
  .sd-doc-ref-cell { word-break: break-word; }
  .sd-doc-ref--inline {
    container-type: inline-size;
    container-name: docref;
  }
  .sd-doc-ref-lbl--compact {
    display: none;
  }
  .sd-doc-ref-lbl--full {
    display: inline;
  }
  /** ความกว้างบล็อกอ้างอิงไม่เกิน ~960px (เช่น A4) — ใช้ป้ายย่อ */
  @container docref (max-width: 960px) {
    .sd-doc-ref-lbl--full {
      display: none !important;
    }
    .sd-doc-ref-lbl--compact {
      display: inline !important;
    }
  }
  @supports not (container-type: inline-size) {
    @media print {
      .sd-doc-ref-lbl--full {
        display: none !important;
      }
      .sd-doc-ref-lbl--compact {
        display: inline !important;
      }
    }
  }
  /** ใบแจ้งหนี้เรียกเก็บ — กระชับพื้นที่ ให้ลายเซ็นอยู่หน้าเดียวได้บ่อยขึ้น */
  .sd-page--commercial .sd-party {
    margin-bottom: 10px;
    padding: 8px 10px;
  }
  .sd-page--commercial .sd-doc-ref {
    margin-bottom: 10px;
    padding: 6px 10px;
  }
  .sd-page--commercial .sd-table {
    margin: 8px 0;
  }
  .sd-page--commercial .sd-table th {
    padding: 5px 5px;
    font-size: 9pt;
  }
  .sd-page--commercial .sd-table td {
    padding: 4px 5px;
    font-size: 9.5pt;
    line-height: 1.32;
  }
  .sd-page--commercial .sd-totals-wrap { margin-top: 4px; }
  .sd-page--commercial .sd-totals-notes-row { margin-top: 4px; }
  .sd-page--commercial .sd-notes { margin-top: 6px; }
  .sd-page--commercial .sd-sign-footer {
    margin-top: 10mm;
    margin-bottom: 3mm;
    padding-top: 6mm;
  }
  .sd-page--commercial .sd-sign-line {
    margin: 52px 10px 6px 10px;
  }
  .sd-page--commercial .sd-approval-notice {
    margin-top: 6px;
    padding-bottom: 0;
  }
  /** ใบสั่งซื้อ (และเอกสารที่ใช้ variant เดียวกัน) — ลดระยะหัวข้อเงื่อนไข/งวดจ่ายให้ลายเซ็นอยู่หน้าเดียวได้บ่อยขึ้น */
  .sd-page--commercial .sd-header {
    padding-bottom: 6px;
    margin-bottom: 8px;
  }
  .sd-page--commercial .sd-section-title {
    margin: 8px 0 4px 0;
    font-size: 10pt;
  }
  .sd-page--commercial .sd-terms {
    font-size: 9pt;
    padding-left: 15px;
    margin: 0;
    line-height: 1.35;
  }
  .sd-page--commercial .sd-terms li {
    margin-bottom: 2px;
  }
  .sd-page--commercial .sd-wht {
    margin-top: 4px;
    font-size: 9pt;
    line-height: 1.35;
  }
  .sd-page--commercial .sd-purchase-type-line {
    margin: 0 0 4px 0;
    font-size: 9pt;
  }
  @media print {
    body:has(.sd-page--commercial) {
      padding: 5mm 11mm 16mm 11mm;
      font-size: 10pt;
    }
    .sd-page--commercial .sd-sign-line {
      margin: 32px 10px 4px 10px;
    }
    .sd-page--commercial .sd-sign-footer {
      margin-top: 6mm;
      padding-top: 2mm;
    }
  }
  /** รายงานรายการ (list print) — ไม่ใช้ sd-page; ลด padding; หลีกเลี่ยง page-break-after:avoid ที่ทำให้เกิดหน้าว่าง */
  body:has(.sd-list-report) {
    padding: 8mm 10mm 8mm 10mm;
    line-height: 1.35;
  }
  @media print {
    html:has(.sd-list-report),
    body:has(.sd-list-report) {
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      overflow: visible !important;
    }
    body:has(.sd-list-report) {
      padding: 0 !important;
      margin: 0 !important;
    }
    body:has(.sd-list-report) script,
    body:has(.sd-list-report) textarea {
      display: none !important;
      height: 0 !important;
      overflow: hidden !important;
      visibility: hidden !important;
    }
    .sd-list-report {
      page-break-after: auto;
      break-after: auto;
      overflow: visible !important;
      max-height: none !important;
    }
    .sd-list-report > :last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .sd-list-report [class$="-wrap"] {
      overflow: visible !important;
      max-height: none !important;
    }
    /** ตาราง list print — ห้าม break-inside:avoid บน tr (Chrome สร้างหน้าว่างคั่น) */
    .sd-list-report table,
    .sd-list-report thead,
    .sd-list-report tbody,
    .sd-list-report tfoot,
    .sd-list-report tr,
    .sd-list-report td,
    .sd-list-report th {
      page-break-inside: auto !important;
      break-inside: auto !important;
    }
    .sd-list-report thead {
      display: table-header-group;
    }
    .sd-list-report [class$="-totals"] {
      gap: 6px;
      margin-bottom: 8px;
    }
    .sd-list-report [class$="-total-box"] {
      padding: 4px 8px;
      min-width: 0;
    }
    .sd-list-report [class$="-table"] {
      font-size: 8pt;
    }
    .sd-list-report [class$="-table"] th,
    .sd-list-report [class$="-table"] td {
      padding: 3px 5px;
    }
    .sd-list-report [class$="-foot"] {
      margin-top: 4px;
      page-break-before: auto;
      break-before: auto;
    }
  }
`;

/**
 * ที่อยู่บริษัทชุดเดียวตามภาษาเอกสารพิมพ์ — อังกฤษ = addressLine1 ก่อน, ไทย = addressLine2 ก่อน (fallback อีกภาษาเมื่อข้างหนึ่งว่าง)
 * ใช้ร่วมกับ `buildStandardCompanyColumnHtml` และพรีวิวหน้าเว็บให้ตรงกับหน้าพิมพ์
 */
export function companyProfileAddressForPrintLocale(
  company: Pick<CompanyProfilePrint, 'addressLine1' | 'addressLine2'> | null | undefined,
  locale: PrintDocumentLocale = 'th',
): string {
  const addrEn = (company?.addressLine1 || '').trim();
  const addrTh = (company?.addressLine2 || '').trim();
  return (locale === 'en' ? addrEn || addrTh : addrTh || addrEn) || '';
}

/** คอลัมน์ซ้าย: ชื่อ (บรรทัดเดียว) + ที่อยู่ **ชุดเดียว** ตาม locale — ความกว้าง ~60% หน้า */
export function buildStandardCompanyColumnHtml(
  company: CompanyProfilePrint | null | undefined,
  locale: PrintDocumentLocale = 'th',
): string {
  const nameTh = company?.companyNameTh?.trim();
  const nameEn = company?.companyNameEn?.trim();
  const baseName = locale === 'en' ? nameEn || nameTh || '—' : nameTh || nameEn || '—';
  const cn = appendPartyBranchParenToName(baseName, company, locale);
  const L = locale;
  const singleAddr = companyProfileAddressForPrintLocale(company, L);
  const ph = (company?.phone || '').trim();
  const phoneP = ph
    ? `<p class="sd-company-line">${escapeHtmlDoc(printT(L, 'tel'))} ${escapeHtmlDoc(ph)}</p>`
    : '';
  let addrBlock = '';
  if (singleAddr) {
    /** หนึ่งบล็อก `<p>` — ให้ตัดบรรทัดตามความกว้างคอลัมน์ ไม่บังคับแยกที่จุลภาคสุดท้ายเป็น `<p>` คู่ */
    const normalizedAddr = singleAddr.replace(/\s+/g, ' ').trim();
    addrBlock = `<p class="sd-company-line sd-company-addr">${escapeHtmlDoc(normalizedAddr)}</p>`;
  }

  return `<div>
      <p class="sd-company-name">${escapeHtmlDoc(cn)}</p>
      ${addrBlock}
      ${phoneP}
      ${company?.email ? `<p class="sd-company-line">${escapeHtmlDoc(printT(L, 'email'))} ${escapeHtmlDoc(company.email)}</p>` : ''}
      ${company?.taxId ? `<p class="sd-company-line">${escapeHtmlDoc(printT(L, 'taxId'))} ${escapeHtmlDoc(company.taxId)}</p>` : ''}
    </div>`;
}

/** คอลัมน์ขวา: ไทย = หัวไทย + หัวอังกฤษย่อย | อังกฤษ = หัวอังกฤษอย่างเดียว */
export function buildStandardTitleColumnHtml(params: {
  documentTitleTh: string;
  documentTitleEn?: string;
  /** แสดงใต้ h1 (เช่น ต้นฉบับ / Original) */
  subtitleUnderTitle?: string;
  metaRows: StandardDocMetaRow[];
  locale?: PrintDocumentLocale;
}): string {
  const locale = params.locale ?? 'th';
  const sub = params.subtitleUnderTitle?.trim();
  const subHtml = sub ? `<p class="sd-doc-subtitle">${escapeHtmlDoc(sub)}</p>` : '';
  const rowHtml = params.metaRows
    .map((r) => {
      if ('line' in r) {
        return `<div class="sd-meta-line">${escapeHtmlDoc(r.line)}</div>`;
      }
      return `<div class="sd-meta-row"><span class="sd-meta-lbl">${escapeHtmlDoc(r.label)}</span><span class="sd-meta-val">${escapeHtmlDoc(r.value)}</span></div>`;
    })
    .join('');
  const rows = rowHtml ? `<div class="sd-meta-rows">${rowHtml}</div>` : '';
  if (locale === 'en') {
    const main = (params.documentTitleEn?.trim() || params.documentTitleTh).trim();
    return `<div class="sd-title-col">
      <h1 class="sd-doc-title">${escapeHtmlDoc(main)}</h1>
      ${subHtml}
      ${rows}
    </div>`;
  }
  /** ไทย: หัวเอกสารไทยเท่านั้น — ไม่แสดงคู่ EN บนหน้าเดียวกัน */
  return `<div class="sd-title-col">
      <h1 class="sd-doc-title">${escapeHtmlDoc(params.documentTitleTh)}</h1>
      ${subHtml}
      ${rows}
    </div>`;
}

/** `<header class="sd-header">` ครบสองคอลัมน์ */
export function buildStandardDocumentHeaderHtml(params: {
  company: CompanyProfilePrint | null | undefined;
  documentTitleTh: string;
  documentTitleEn?: string;
  subtitleUnderTitle?: string;
  metaRows: StandardDocMetaRow[];
  locale?: PrintDocumentLocale;
}): string {
  const locale = params.locale ?? 'th';
  return `<header class="sd-header">
    <div class="sd-company-col">${buildStandardCompanyColumnHtml(params.company, locale)}</div>
    ${buildStandardTitleColumnHtml({
      documentTitleTh: params.documentTitleTh,
      documentTitleEn: params.documentTitleEn,
      subtitleUnderTitle: params.subtitleUnderTitle,
      metaRows: params.metaRows,
      locale,
    })}
  </header>`;
}

/** กล่องข้อมูลคู่ค้า / ลูกค้า */
export function buildStandardPartyBoxHtml(params: {
  boxLabel: string;
  partyName: string;
  detailLines?: string[];
}): string {
  const lines = (params.detailLines || [])
    .filter((x) => x.trim())
    .map((line) => `<p class="sd-party-line">${escapeHtmlDoc(line)}</p>`)
    .join('');
  return `<div class="sd-party">
    <p class="sd-party-label">${escapeHtmlDoc(params.boxLabel)}</p>
    <p class="sd-party-name">${escapeHtmlDoc(params.partyName || '—')}</p>
    ${lines}
  </div>`;
}

/** Kept for API compatibility; print documents no longer render a print date/time stamp. */
export function buildStandardPrintStampHtml(_printedAtMs?: number, _locale: PrintDocumentLocale = 'th'): string {
  return '';
}

/** บล็อกยอดรวมขวาล่าง (แถวธรรมดา + แถวยอดสุทธิ teal + ตัวอักษรเงินไทย) */
export type StandardTotalsRow = { label: string; value: string; grand?: boolean };

export function buildStandardTotalsBlockHtml(params: {
  rows: StandardTotalsRow[];
  /** จาก amountToThaiBahtText แล้ว */
  amountInWords?: string;
  /**
   * default = ตัวอักษรเงินใต้ยอดรวมขวา
   * underNotes = ไม่ใส่ในบล็อกยอด (ให้ `buildStandardTotalsWithNotesRowHtml` วางใต้ TERMS & NOTES)
   */
  amountInWordsLayout?: 'default' | 'underNotes' | 'taxFullLine';
}): string {
  const body = params.rows
    .map((r) => {
      const cls = r.grand ? 'sd-totals-row sd-grand' : 'sd-totals-row';
      const lab = r.grand
        ? `<span class="sd-total-label">${escapeHtmlDoc(r.label)}</span>`
        : `<span>${escapeHtmlDoc(r.label)}</span>`;
      const val = r.grand
        ? `<span class="sd-total-val">${escapeHtmlDoc(r.value)}</span>`
        : `<span>${escapeHtmlDoc(r.value)}</span>`;
      return `<div class="${cls}">${lab}${val}</div>`;
    })
    .join('');
  const w = params.amountInWords?.trim();
  /** underNotes / taxFullLine (legacy alias) — ไม่ใส่คำใต้ยอด รวมให้คอลัมน์ซ้ายจัดการ */
  if (
    params.amountInWordsLayout === 'underNotes' ||
    params.amountInWordsLayout === 'taxFullLine'
  ) {
    return `<div class="sd-totals-wrap">
    <div class="sd-totals">
      ${body}
    </div>
  </div>`;
  }
  const words = w ? `<p class="sd-amount-words">${escapeHtmlDoc(w)}</p>` : '';
  return `<div class="sd-totals-wrap">
    <div class="sd-totals">
      ${body}
      ${words}
    </div>
  </div>`;
}

/** ยอดรวมขวา + กล่องหมายเหตุซ้าย (ใบแจ้งหนี้เรียกเก็บ / ใบกำกับภาษี) */
export function buildStandardTotalsWithNotesRowHtml(params: {
  totalsParams: Parameters<typeof buildStandardTotalsBlockHtml>[0];
  notes?: string;
  notesTitle?: string;
}): string {
  const layout = params.totalsParams.amountInWordsLayout;
  const wordsRaw = (params.totalsParams.amountInWords || '').trim();
  const placeWordsUnderNotes =
    !!wordsRaw && (layout === 'underNotes' || layout === 'taxFullLine');

  const totalsHtml = buildStandardTotalsBlockHtml({
    ...params.totalsParams,
    amountInWords: placeWordsUnderNotes ? undefined : params.totalsParams.amountInWords,
    amountInWordsLayout: placeWordsUnderNotes ? 'underNotes' : layout,
  });

  const notesTrim = formatDocumentNotesForPrint(params.notes ?? '');
  const wordsHtml = placeWordsUnderNotes
    ? `<p class="sd-amount-words sd-amount-words--under-notes">${escapeHtmlDoc(wordsRaw)}</p>`
    : '';

  if (!notesTrim && !placeWordsUnderNotes) return totalsHtml;

  const notesBox = notesTrim
    ? `<div class="sd-notes-box">
    <p class="sd-notes-box-title">${escapeHtmlDoc(params.notesTitle ?? 'Notes')}</p>
    <p class="sd-notes-box-body">${escapeHtmlDoc(notesTrim)}</p>
  </div>`
    : '';

  const leftCol = notesBox ? `<div class="sd-notes-col">${notesBox}</div>` : `<div class="sd-notes-col"></div>`;
  const rowHtml = `<div class="sd-totals-notes-row">
    ${leftCol}
    ${totalsHtml}
  </div>`;

  if (!placeWordsUnderNotes) {
    return rowHtml;
  }

  return `<div class="sd-totals-notes-stack">
    ${rowHtml}
    ${wordsHtml}
  </div>`;
}

/** ฟุตเตอร์ลายเซ็นสองฝั่ง + ข้อความกลาง (ถ้ามี) — ห้ามแยกออกจาก sd-sign-footer เมื่อแบ่งหน้า */
export function buildStandardSignFooterHtml(params: {
  left: { roleLine: string; name: string };
  right: { roleLine: string; name: string };
  belowHtml?: string;
}): string {
  const below = params.belowHtml ?? '';
  return `<footer class="sd-sign-footer">
  <div class="sd-signatures">
    <div class="sd-sign-block">
      <div class="sd-sign-line"></div>
      <p class="sd-sign-role">${escapeHtmlDoc(params.left.roleLine)}</p>
      <p class="sd-sign-name">${escapeHtmlDoc(params.left.name || '—')}</p>
    </div>
    <div class="sd-sign-block">
      <div class="sd-sign-line"></div>
      <p class="sd-sign-role">${escapeHtmlDoc(params.right.roleLine)}</p>
      <p class="sd-sign-name">${escapeHtmlDoc(params.right.name || '—')}</p>
    </div>
  </div>
  ${below}
  </footer>`;
}

/**
 * ห่อเนื้อหาในหน้าเดียว: header + main + footer
 * ใช้เมื่อสร้างเอกสารประเภทใหม่ — ส่ง `mainHtml` เป็นตาราง/ยอด/เงื่อนไขของแต่ละชนิด
 */
export function assembleStandardPrintPageHtml(params: {
  printedAtMs?: number;
  headerHtml: string;
  mainHtml: string;
  footerHtml: string;
  locale?: PrintDocumentLocale;
  /** ใบแจ้งหนี้เรียกเก็บ — เลย์เอาต์กระชับ (ตาราง / ลายเซ็น) */
  pageVariant?: 'default' | 'commercial';
  /** HTML ประทับสถานะ (DRAFT / CANCEL) — วางทับกลางหน้า */
  watermarkHtml?: string;
}): string {
  const locale = params.locale ?? 'th';
  const pageClass =
    params.pageVariant === 'commercial' ? 'sd-page sd-page--commercial' : 'sd-page';
  const watermark = params.watermarkHtml?.trim() ? params.watermarkHtml : '';
  return `
<div class="${pageClass}">
  ${watermark}
  ${buildStandardPrintStampHtml(params.printedAtMs, locale)}
  ${params.headerHtml}
  ${params.mainHtml}
  ${params.footerHtml}
</div>
`;
}

/** ย้าย `<style>` นำหน้าใน bodyInnerHtml ของ list print ไป `<head>` — ลดหน้าว่างจาก Chrome print */
function hoistLeadingBodyStyleTag(bodyHtml: string): { bodyHtml: string; extraHeadCss: string } {
  const trimmed = bodyHtml.trimStart();
  const styleMatch = trimmed.match(/^<style>\s*([\s\S]*?)\s*<\/style>\s*/i);
  if (!styleMatch) {
    return { bodyHtml, extraHeadCss: '' };
  }
  return {
    bodyHtml: trimmed.slice(styleMatch[0].length),
    extraHeadCss: styleMatch[1],
  };
}

export function wrapStandardPrintDocument(
  title: string,
  bodyHtml: string,
  options?: { lang?: PrintDocumentLocale },
): string {
  const lang = options?.lang === 'en' ? 'en' : 'th';
  const safeTitle = sanitizePrintFileBaseName(title);
  const isListReport = bodyHtml.includes('sd-list-report');
  const { bodyHtml: normalizedBodyHtml, extraHeadCss } = hoistLeadingBodyStyleTag(bodyHtml);
  /** รายงานรายการ: ไม่ใส่สคริปต์ท้าย body (beforeprint + textarea ทำให้ Chrome นับหน้าว่าง) — ชื่อไฟล์ตั้งใน openStandardPrintWindow แล้ว */
  const titleHoldScript = isListReport
    ? ''
    : `<script>(function(){var base=${JSON.stringify(safeTitle)};var fn=base+".pdf";function docTitle(){try{document.title=base}catch(e){}}function syncCopy(){try{var ta=document.createElement("textarea");ta.value=fn;ta.readOnly=true;ta.style.cssText="position:fixed;top:4px;left:4px;width:280px;height:44px;opacity:0.1;z-index:2147483647;font:12px monospace;padding:6px;border:1px solid #999";document.body.appendChild(ta);ta.focus();ta.select();if(ta.setSelectionRange)ta.setSelectionRange(0,fn.length);document.execCommand("copy");document.body.removeChild(ta);}catch(e){}}docTitle();addEventListener("beforeprint",function(){docTitle();syncCopy();},{capture:true});})();</script>`;
  const extraCssBlock = extraHeadCss ? `\n    <style>${extraHeadCss}</style>` : '';
  return `<!DOCTYPE html><html lang="${lang}"><head>
    <meta charset="utf-8"/>
    <title>${escapeHtmlDoc(safeTitle)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com"/>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap" rel="stylesheet"/>
    <style>${STANDARD_DOCUMENT_PRINT_CSS}</style>${extraCssBlock}
  </head><body>${normalizedBodyHtml}${titleHoldScript}</body></html>`;
}

/**
 * เปิดหน้าต่างพิมพ์แบบเดียวกับเมนูจัดซื้อ: HTML มาตรฐานเต็มหน้า (ไม่พิมพ์ shell ของแอป)
 * เปิดหน้าต่างว่างและเขียน HTML แบบ synchronous ก่อน `await` ใดๆ เพื่อไม่ให้ถูกบล็อกป๊อปอัป
 * @returns true ถ้าเปิดหน้าต่างได้
 */
export async function openStandardPrintWindow(params: {
  windowTitle: string;
  /**
   * Suggested PDF filename (Chrome/Edge use document title). Defaults to `windowTitle`.
   * Use the app document number when `windowTitle` is a longer human-readable label.
   */
  suggestedFileName?: string;
  /**
   * Microsoft Print to PDF บน Windows มักไม่เติมชื่อไฟล์จากหน้าเว็บ — ระบบจะพยายามคัดลอก `ชื่อ.pdf` ลงคลิปบอร์ด
   * และเรียก callback นี้เมื่อคัดลอกสำเร็จ (เช่น แสดง toast)
   */
  onClipboardFilenameCopied?: (fileNameWithPdfExt: string) => void;
  bodyInnerHtml: string;
  /** ภาษาของหน้า HTML พิมพ์ (ส่งต่อจาก locale เอกสาร) */
  htmlLang?: PrintDocumentLocale;
}): Promise<boolean> {
  const printFileTitle = sanitizePrintFileBaseName(params.suggestedFileName ?? params.windowTitle);
  const clipName = `${printFileTitle}.pdf`;
  const html = wrapStandardPrintDocument(printFileTitle, params.bodyInnerHtml, {
    lang: params.htmlLang ?? 'th',
  });
  const w = window.open('', '_blank');
  if (!w) {
    return false;
  }
  let didPrint = false;
  const scheduleClose = () => {
    window.setTimeout(() => {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }, 500);
  };
  const runPrint = () => {
    if (didPrint || w.closed) return;
    didPrint = true;
    const doPrint = () => {
      if (w.closed) return;
      try {
        w.document.title = printFileTitle;
        w.focus();
        w.print();
      } finally {
        scheduleClose();
      }
    };
    const fontsReady = w.document.fonts?.ready;
    if (fontsReady) {
      fontsReady.then(() => window.setTimeout(doPrint, 80)).catch(() => doPrint());
    } else {
      window.setTimeout(doPrint, 150);
    }
  };
  try {
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.document.title = printFileTitle;
  } catch {
    scheduleClose();
    return false;
  }

  const copied =
    (await copyPrintFileNameBestEffort(clipName)) || copyTextToClipboardSync(clipName);
  if (copied) {
    params.onClipboardFilenameCopied?.(clipName);
  }

  const raf = w.requestAnimationFrame?.bind(w) ?? ((cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
  raf(() => raf(() => runPrint()));
  return true;
}

/** ที่อยู่ใน Firestore บางเจ้ารวมหลายบรรทัด/บริษัท — ฉบับพิมพ์สาธารณะ: เอาเป็นหนึ่งบรรทัด ไม่รั่วจาก billing ก่อน registered (เคยทำฉบับ TH กับ EN สลับลำดะต่างกันจนไม่ตรง Invoice) */
export function normalizePrintPartyAddress(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .join(' ');
}

export function customerPartyDetailLines(
  c: Customer | null | undefined,
  locale: PrintDocumentLocale,
): string[] {
  if (!c) return [];
  const lines: string[] = [];
  const raw = (c.registeredAddress || c.billingAddress || '').trim();
  const addr = normalizePrintPartyAddress(raw);
  if (addr) lines.push(addr);
  if (c.taxId?.trim()) lines.push(`${printT(locale, 'taxId')} ${c.taxId.trim()}`);
  if (c.phone?.trim()) lines.push(`${printT(locale, 'tel')} ${c.phone.trim()}`);
  return lines;
}
