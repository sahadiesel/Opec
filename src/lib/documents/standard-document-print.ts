/**
 * มาตรฐานรูปแบบพิมพ์เอกสาร (Standard Document Print)
 * =====================================================
 * ทุกประเภทเอกสารที่ออกจากระบบควรใช้ชุดเดียวกันนี้:
 * - คลาส CSS prefix `sd-` จาก `STANDARD_DOCUMENT_PRINT_CSS`
 * - ฟังก์ชันประกอบ `buildStandard*` / `wrapStandardPrintDocument` / `escapeHtmlDoc`
 *
 * ประเภทที่ให้ยึดรูปแบบนี้ (อ้างอิง PO เป็นต้นแบบ):
 * - ใบสั่งซื้อ (Purchase Order) — ใช้แล้ว: `buildPurchaseOrderPrintHtml`
 * - ใบเสนอราคา (Quotation)
 * - รายการใบแจ้งหนี้ / ใบแจ้งหนี้ (commercial billing / Invoice)
 * - ใบกำกับภาษี (Tax invoice) / ใบเสร็จรับเงิน (Receipt) แยกเอกสาร
 * - ใบบันทึกเวลา (Timesheet) และเอกสารทางการค้าอื่นที่เพิ่มในอนาคต
 *
 * หลักการเลย์เอาต์:
 * - หัว: บริษัทซ้าย (~60% ความกว้าง, ชื่อบรรทัดเดียว, ที่อยู่เดียวตาม locale) | ชื่อเอกสาร + meta ขวา (~40%)
 * - กล่องคู่ค้า/ลูกค้า → ตารางรายการ → ยอดรวม + จำนวนเงินเป็นตัวอักษรไทย
 * - เนื้อหาเพิ่มเติมตามประเภทเอกสาร (เงื่อนไขชำระ ฯลฯ) ต่อท้ายแบบไหลธรรมชาติ ไม่ดันลายเซ็นไปชิดขอบล่างแบบ flex/min-height เต็มหน้า
 * - ฟุตเตอร์ลายเซ็น: `sd-sign-footer` มี break-inside: avoid
 */

import type {
  BillingNote,
  BillingNoteLine,
  CommercialInvoice,
  CommercialInvoiceLine,
  Customer,
  MainContract,
  Purchase,
  PurchaseRequest,
  PurchaseLine,
  PurchasePaymentMilestone,
  PurchaseOrder,
  Quotation,
  QuotationLine,
  TaxInvoice,
  MoneyReceipt,
  Vendor,
} from '@/lib/types';
import {
  formatDateThaiBE,
  formatDateTimeGregorian,
  formatDateTimeThaiBE,
  formatStoredDateGregorian,
  formatStoredDateRangeGregorian,
  formatStoredDateRangeThaiBE,
  formatStoredDateThaiBE,
  formatYmdLocalThaiBE,
} from '@/lib/date-thai';
import { amountToThaiBahtText } from '@/lib/documents/thai-baht-text';
import { amountToEnglishBahtText } from '@/lib/documents/english-baht-text';
import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';
import { printT } from '@/lib/documents/document-print-i18n';
import { translateCommercialLineDescriptionToEn, translateCommercialNotesToEn, translateCommercialWaveCodeToEn } from '@/lib/documents/commercial-line-description-en';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import { sumLineAmounts } from '@/lib/purchase/pr-totals';

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

function formatIssueDateYmdForPrint(issueYmd: string | undefined, locale: PrintDocumentLocale): string {
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

/** Portal print: single title — status is shown in the app table, not in the document header */
function commercialInvoiceDocTitles(): { th: string; en: string } {
  return { th: 'ใบแจ้งหนี้', en: 'Invoice' };
}

/** ที่อยู่ใน Firestore บางเจ้ารวมหลายบรรทัด/บริษัท — ฉบับพิมพ์สาธารณะ: เอาเป็นหนึ่งบรรทัด ไม่รั่วจาก billing ก่อน registered (เคยทำฉบับ TH กับ EN สลับลำดะต่างกันจนไม่ตรง Invoice) */
function normalizePrintPartyAddress(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .join(' ');
}

function customerPartyDetailLines(
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

const DOC_REF_EMPTY = '—';

const QUOTATION_PO_WAVE_ID = '__quotation_po__';

function formatQuotationRefForPrint(q: Quotation, locale: PrintDocumentLocale): string {
  const no = (q.quotationNo || '').trim();
  const ext = (q.referenceNo || '').trim();
  if (!no && !ext) return DOC_REF_EMPTY;
  if (ext && ext !== no) {
    return locale === 'en' ? `${no || ext} (Ref. ${ext})` : `${no || ext} (อ้างอิง ${ext})`;
  }
  return no || ext || DOC_REF_EMPTY;
}

function isTripBillingWaveRef(invoice: CommercialInvoice): boolean {
  if (invoice.sourceTripBillingBatchId) return true;
  const w = invoice.waveCode?.trim() || '';
  if (w.startsWith('รอบเดินทาง')) return true;
  return /^Trip cycle\b/i.test(translateCommercialWaveCodeToEn(w));
}

/** Wave/Trip บนหน้าพิมพ์ — แสดงเฉพาะช่วงวันที่รอบ (ไม่มี M1 / ชื่อพนักงาน) */
function formatTripBillingWaveRefForPrint(
  invoice: CommercialInvoice,
  locale: PrintDocumentLocale,
): string {
  const range =
    locale === 'en'
      ? formatStoredDateRangeGregorian(invoice.periodStart, invoice.periodEnd)
      : formatStoredDateRangeThaiBE(invoice.periodStart, invoice.periodEnd);
  return range && range !== '—' ? range : DOC_REF_EMPTY;
}

function resolveCommercialPrintDocumentRef(
  invoice: CommercialInvoice,
  purchaseOrder: PurchaseOrder | null | undefined,
  mainContract: MainContract | null | undefined,
  quotation: Quotation | null | undefined,
  locale: PrintDocumentLocale,
): { firstRowIsQuotation: boolean; firstValue: string; customerPo: string; wave: string; waveIsTripPeriod?: boolean } {
  const customerPo =
    purchaseOrder?.customerPONumber?.trim() ||
    purchaseOrder?.poCode?.trim() ||
    DOC_REF_EMPTY;

  const isQuotationPo =
    invoice.waveId === QUOTATION_PO_WAVE_ID || (purchaseOrder?.poType || 'contract') === 'quotation';

  if (isQuotationPo) {
    const firstValue = quotation ? formatQuotationRefForPrint(quotation, locale) : DOC_REF_EMPTY;
    return {
      firstRowIsQuotation: true,
      firstValue,
      customerPo,
      wave: printT(locale, 'docRefWaveQuotationPlaceholder'),
    };
  }

  const contractNo = mainContract?.contractNumber?.trim() || DOC_REF_EMPTY;
  let wave =
    invoice.waveCode?.trim() ||
    (invoice.waveId && invoice.waveId !== QUOTATION_PO_WAVE_ID ? invoice.waveId.trim() : '') ||
    DOC_REF_EMPTY;
  let waveIsTripPeriod = false;
  if (wave === QUOTATION_PO_WAVE_ID) wave = DOC_REF_EMPTY;
  else if (isTripBillingWaveRef(invoice)) {
    wave = formatTripBillingWaveRefForPrint(invoice, locale);
    waveIsTripPeriod = true;
  } else if (locale === 'en') wave = translateCommercialWaveCodeToEn(wave);

  return {
    firstRowIsQuotation: false,
    firstValue: contractNo,
    customerPo,
    wave,
    waveIsTripPeriod,
  };
}

function buildCommercialDocumentReferenceHtml(
  L: PrintDocumentLocale,
  ref: {
    firstRowIsQuotation: boolean;
    firstValue: string;
    customerPo: string;
    wave: string;
    waveIsTripPeriod?: boolean;
  },
): string {
  const l1 = printT(L, ref.firstRowIsQuotation ? 'docRefLine1Quotation' : 'docRefLine1');
  const l2 = printT(L, 'docRefLine2');
  const l3 = printT(L, ref.waveIsTripPeriod ? 'docRefLine3Period' : 'docRefLine3');
  const c1 = printT(L, ref.firstRowIsQuotation ? 'docRefLine1QuotationCompact' : 'docRefLine1Compact');
  const c2 = printT(L, 'docRefLine2Compact');
  const c3 = printT(L, ref.waveIsTripPeriod ? 'docRefLine3PeriodCompact' : 'docRefLine3Compact');
  const lab = (full: string, compact: string) =>
    `<strong class="sd-doc-ref-lbl sd-doc-ref-lbl--full">${escapeHtmlDoc(full)}</strong><strong class="sd-doc-ref-lbl sd-doc-ref-lbl--compact">${escapeHtmlDoc(compact)}</strong>`;
  return `<div class="sd-doc-ref sd-doc-ref--inline">
    <p class="sd-doc-ref-title">${escapeHtmlDoc(printT(L, 'documentRefTitle'))}</p>
    <div class="sd-doc-ref-cols">
      <div class="sd-doc-ref-cell">${lab(l1, c1)} ${escapeHtmlDoc(ref.firstValue)}</div>
      <div class="sd-doc-ref-cell">${lab(l2, c2)} ${escapeHtmlDoc(ref.customerPo)}</div>
      <div class="sd-doc-ref-cell">${lab(l3, c3)} ${escapeHtmlDoc(ref.wave)}</div>
    </div>
  </div>`;
}

/** ใบแจ้งหนี้เรียกเก็บ (commercial) — ร่าง / รอลูกค้า / ออกแล้ว */
export function buildCommercialInvoicePrintHtml(params: {
  company: CompanyProfilePrint | null | undefined;
  invoice: CommercialInvoice;
  customer: Customer | null | undefined;
  /** ถ้าไม่มี Customer ใน Firestore (เช่น พอร์ทัล) ให้ส่งชื่อลูกค้าที่แสดงบนเอกสาร */
  customerPartyNameOverride?: string;
  /** สำหรับบล็อกอ้างอิงเอกสาร (เลขที่สัญญา / PO ลูกค้า) — โหลดจาก Firestore ถ้ามี */
  purchaseOrder?: PurchaseOrder | null;
  mainContract?: MainContract | null;
  /** PO สายใบเสนอราคา — ใช้แสดงเลขที่ QT แทนเลขที่สัญญาในเอกสารพิมพ์ */
  quotation?: Quotation | null;
  lines: CommercialInvoiceLine[];
  amountBeforeTax: number;
  vatAmount: number;
  totalAmount: number;
  printedAtMs?: number;
  /** ภาษาของข้อความบนเอกสารพิมพ์ (ค่าเริ่มต้น ไทย) */
  locale?: PrintDocumentLocale;
}): string {
  const {
    company,
    invoice,
    customer,
    lines,
    amountBeforeTax,
    vatAmount,
    totalAmount,
    printedAtMs,
    purchaseOrder,
    mainContract,
  } = params;
  const locale = params.locale ?? 'th';
  const L = locale;
  const titles = commercialInvoiceDocTitles();
  const issueStr = formatIssueDateYmdForPrint(invoice.issueDate, L);
  const docRef = resolveCommercialPrintDocumentRef(
    invoice,
    purchaseOrder,
    mainContract,
    params.quotation ?? null,
    L,
  );
  const docRefHtml = buildCommercialDocumentReferenceHtml(L, docRef);

  const partyName = formatCustomerPartyNameForPrint(
    customer,
    params.customerPartyNameOverride,
    L,
  );
  const partyHtml = buildStandardPartyBoxHtml({
    boxLabel: printT(L, 'customerInfo'),
    partyName,
    detailLines: customerPartyDetailLines(customer, L),
  });

  const sortedCommercialForPrint = sortCommercialInvoiceLinesForDisplay(lines);
  const lineRows = sortedCommercialForPrint
    .map((line, idx) => {
      const sub = line.workerName ? ` (${line.workerName})` : '';
      const rawDesc = (line.description || '—') + sub;
      const descText = L === 'en' ? translateCommercialLineDescriptionToEn(rawDesc) : rawDesc;
      const desc = escapeHtmlDoc(descText);
      const qty = Number(line.quantity).toLocaleString(L === 'en' ? 'en-GB' : 'th-TH');
      const up = Number(line.unitPrice).toLocaleString(L === 'en' ? 'en-GB' : 'th-TH', { minimumFractionDigits: 2 });
      const amt = Number(line.amount ?? line.quantity * line.unitPrice).toLocaleString(L === 'en' ? 'en-GB' : 'th-TH', {
        minimumFractionDigits: 2,
      });
      const seq = invoiceLineSequenceNumberFromDisplayOrder(line.displayOrder, idx);
      return `<tr>
        <td class="sd-num">${seq}</td>
        <td>${desc}</td>
        <td class="sd-right">${qty}</td>
        <td class="sd-right">${up}</td>
        <td class="sd-right">${amt}</td>
      </tr>`;
    })
    .join('');

  const vatPct = Number(invoice.vatPercent) || 0;
  const vatLabel =
    vatPct > 0
      ? L === 'en'
        ? `${printT(L, 'vat')} ${vatPct}%`
        : `${printT(L, 'vat')} ${vatPct}%`
      : printT(L, 'vat');
  const totalRows: StandardTotalsRow[] = [
    {
      label: printT(L, 'subtotal'),
      value: amountBeforeTax.toLocaleString(L === 'en' ? 'en-GB' : 'th-TH', { minimumFractionDigits: 2 }),
    },
    {
      label: vatLabel,
      value: vatAmount.toLocaleString(L === 'en' ? 'en-GB' : 'th-TH', { minimumFractionDigits: 2 }),
    },
  ];
  if ((invoice.withholdingTaxAmount ?? 0) > 0.005) {
    totalRows.push({
      label: printT(L, 'wht'),
      value: `-${invoice.withholdingTaxAmount!.toLocaleString(L === 'en' ? 'en-GB' : 'th-TH', { minimumFractionDigits: 2 })}`,
    });
  }
  totalRows.push({
    label: printT(L, 'grandTotal'),
    value: `฿ ${totalAmount.toLocaleString(L === 'en' ? 'en-GB' : 'th-TH', { minimumFractionDigits: 2 })}`,
    grand: true,
  });

  const totalWords = L === 'en' ? amountToEnglishBahtText(totalAmount) : amountToThaiBahtText(totalAmount);
  /** Portal: single title “Invoice” / “ใบแจ้งหนี้” only; status is in the app list, not on the paper */
  const headerHtml = buildStandardDocumentHeaderHtml({
    company,
    documentTitleTh: L === 'en' ? titles.en : titles.th,
    documentTitleEn: undefined,
    metaRows: [
      { line: `${printT(L, 'dateIssued')} ${issueStr}` },
      { line: `${printT(L, 'docNo')}: ${invoice.invoiceNo}` },
    ],
    locale: L,
  });
  const emptyLines = printT(L, 'noLines');
  const tableHtml = `<table class="sd-table sd-table--commercial-lines">
    <thead>
      <tr>
        <th class="sd-num">${escapeHtmlDoc(printT(L, 'colNo'))}</th>
        <th>${escapeHtmlDoc(printT(L, 'description'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'qty'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'unitPrice'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'amount'))}</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows || `<tr><td colspan="5" style="text-align:center;color:#737373">${escapeHtmlDoc(emptyLines)}</td></tr>`}
    </tbody>
  </table>`;
  const notesForPrint =
    L === 'en' && invoice.notes?.trim()
      ? translateCommercialNotesToEn(invoice.notes)
      : invoice.notes;
  const totalsHtml = buildStandardTotalsWithNotesRowHtml({
    totalsParams: {
      rows: totalRows,
      amountInWords: totalWords,
    },
    notes: notesForPrint,
    notesTitle: printT(L, 'termsNotes'),
  });
  const statusNote =
    invoice.status === 'VOID'
      ? `<p class="sd-notes"><strong>${escapeHtmlDoc(printT(L, 'status'))}:</strong> ${escapeHtmlDoc(printT(L, 'voidedDoc'))}</p>`
      : `<p class="sd-notes" style="font-size:9pt">${escapeHtmlDoc(printT(L, 'commercialNotTaxInvoice'))}</p>`;
  const mainHtml = `${partyHtml}
  ${docRefHtml}
  ${tableHtml}
  ${totalsHtml}
  ${statusNote}`;
  const rightSignName =
    invoice.status === 'ISSUED' && invoice.customerApprovedByName?.trim()
      ? invoice.customerApprovedByName.trim()
      : '—';
  const confirmLine =
    invoice.status === 'ISSUED' && invoice.customerApprovedAt
      ? `<p class="sd-approval-notice">${escapeHtmlDoc(printT(L, 'confirmedTotals'))} ${escapeHtmlDoc(L === 'en' ? formatDateTimeGregorian(invoice.customerApprovedAt) : formatDateTimeThaiBE(invoice.customerApprovedAt))}</p>`
      : '';
  const footerHtml = buildStandardSignFooterHtml({
    left: { roleLine: printT(L, 'signPreparedBy'), name: invoice.createdByName || '—' },
    right: { roleLine: printT(L, 'signCustomerConfirm'), name: rightSignName },
    belowHtml: confirmLine,
  });
  return assembleStandardPrintPageHtml({
    printedAtMs,
    headerHtml,
    mainHtml,
    footerHtml,
    locale: L,
    pageVariant: 'commercial',
  });
}

/**
 * รายการตารางแบบใบเรียกเก็บ (ลูกค้า approve) — ใช้ซ้ำกับฉบับใบกำกับเพื่อให้ข้อความ/ลำดับตรงกัน
 */
function buildCommercialLinesTableRowsForPrint(
  lines: CommercialInvoiceLine[] | null | undefined,
  L: PrintDocumentLocale,
): string {
  const loc = L === 'en' ? 'en-GB' : 'th-TH';
  const sorted = sortCommercialInvoiceLinesForDisplay(lines);
  return sorted
    .map((line, idx) => {
      const sub = line.workerName ? ` (${line.workerName})` : '';
      const rawDesc = (line.description || '—') + sub;
      const descText = L === 'en' ? translateCommercialLineDescriptionToEn(rawDesc) : rawDesc;
      const desc = escapeHtmlDoc(descText);
      const qty = Number(line.quantity).toLocaleString(loc);
      const up = Number(line.unitPrice).toLocaleString(loc, { minimumFractionDigits: 2 });
      const amt = Number(line.amount ?? line.quantity * line.unitPrice).toLocaleString(loc, { minimumFractionDigits: 2 });
      const seq = invoiceLineSequenceNumberFromDisplayOrder(line.displayOrder, idx);
      return `<tr>
        <td class="sd-num">${seq}</td>
        <td>${desc}</td>
        <td class="sd-right">${qty}</td>
        <td class="sd-right">${up}</td>
        <td class="sd-right">${amt}</td>
      </tr>`;
    })
    .join('');
}

/** แผ่นพิมพ์ใบกำกับ — ต้นฉบับ / สำเนา (ตามภาษาที่เลือกพิมพ์ TH/EN) */
export type TaxInvoicePrintSheet = 'original' | 'copy';

export function taxInvoiceSheetSubtitleForPrintLocale(
  sheet: TaxInvoicePrintSheet,
  locale: PrintDocumentLocale,
): string {
  return sheet === 'copy' ? printT(locale, 'docCopy') : printT(locale, 'docOriginal');
}

/** ใบกำกับภาษี — รายการจากใบวางบิล / หรือสอดคล้องใบเรียกเก็บเดิม (ลูกค้า approve) */
export function buildTaxInvoicePrintHtml(params: {
  company: CompanyProfilePrint | null | undefined;
  invoice: TaxInvoice;
  billingNote: BillingNote | null | undefined;
  billingLines: BillingNoteLine[] | null | undefined;
  customer: Customer | null | undefined;
  customerPartyNameOverride?: string;
  /** ใบเรียกเก็บต้นทาง — ถ้าระบุและตรง sourceCommercialInvoiceId ฉบับพิมพ์ใช้ชื่อ/ที่อยู่+รายการเดียวกับที่ลูกค้า approve */
  sourceCommercialInvoice?: CommercialInvoice | null;
  printedAtMs?: number;
  locale?: PrintDocumentLocale;
  /**
   * ลำดับแผ่นพิมพ์ — ต้นฉบับ/สำเนา แต่ละรายการ = 1 หน้า
   * ฝั่งลูกค้า/ผู้ใช้ทั่วไป: ใช้ค่าเริ่มต้น `['original']` เท่านั้น
   */
  sheets?: TaxInvoicePrintSheet[];
}): string {
  const { sheets, ...rest } = params;
  const sheetList: TaxInvoicePrintSheet[] = sheets?.length ? sheets : ['original'];
  return sheetList
    .map((sheetKind) => buildTaxInvoicePrintHtmlSinglePage({ ...rest, sheetKind }))
    .join('');
}

function buildTaxInvoicePrintHtmlSinglePage(params: {
  company: CompanyProfilePrint | null | undefined;
  invoice: TaxInvoice;
  billingNote: BillingNote | null | undefined;
  billingLines: BillingNoteLine[] | null | undefined;
  customer: Customer | null | undefined;
  customerPartyNameOverride?: string;
  sourceCommercialInvoice?: CommercialInvoice | null;
  printedAtMs?: number;
  locale?: PrintDocumentLocale;
  sheetKind: TaxInvoicePrintSheet;
}): string {
  const { company, invoice, billingNote, billingLines, customer, customerPartyNameOverride, printedAtMs } = params;
  const L = params.locale ?? 'th';
  const loc = L === 'en' ? 'en-GB' : 'th-TH';
  const issueStr = formatIssueDateYmdForPrint(invoice.issueDate, L);
  /** ชื่อบริษัทใน Firestore ก่อน — ค่อย override (เช่น ไม่มี customer record) หลีกเลี่ยงชื่อ user portal ทับลูกค้า */
  const partyName = formatCustomerPartyNameForPrint(customer, customerPartyNameOverride, L);
  const com = params.sourceCommercialInvoice;
  const useCommercialMirror =
    !!invoice.sourceCommercialInvoiceId &&
    !!com &&
    com.id === invoice.sourceCommercialInvoiceId &&
    (com.lines?.length ?? 0) > 0;
  const partyLines = customerPartyDetailLines(customer, L);
  const lineRows = useCommercialMirror
    ? buildCommercialLinesTableRowsForPrint(com.lines, L)
    : (() => {
        const sortedLines = sortBillingNoteLinesForDisplay(billingLines);
        return sortedLines
          .map((line, idx) => {
            const desc = escapeHtmlDoc(line.description || '—');
            const qty = Number(line.quantity).toLocaleString(loc);
            const up = Number(line.unitPrice).toLocaleString(loc, { minimumFractionDigits: 2 });
            const amt = Number(line.amount).toLocaleString(loc, { minimumFractionDigits: 2 });
            const seq = invoiceLineSequenceNumberFromDisplayOrder(line.displayOrder, idx);
            return `<tr>
        <td class="sd-num">${seq}</td>
        <td>${desc}</td>
        <td class="sd-right">${qty}</td>
        <td class="sd-right">${up}</td>
        <td class="sd-right">${amt}</td>
      </tr>`;
          })
          .join('');
      })();

  const vatPct = billingNote ? Number(billingNote.vatPercent) || 0 : 7;
  const vatRowLabel =
    vatPct > 0 ? `${printT(L, 'vat')} ${vatPct}%` : printT(L, 'vat');
  const whtAmt = Number(invoice.withholdingTaxAmount) || 0;
  const rateDoc = Number(invoice.withholdingTaxRatePercentOnDocument ?? 3);
  const showWhtOnDoc = invoice.showWithholdingOnDocument === true && whtAmt > 0.005;
  const netPayable = roundMoney2(invoice.totalAmount - whtAmt);

  const totalRows: StandardTotalsRow[] = [
    {
      label: printT(L, 'taxableBase'),
      value: invoice.taxableAmount.toLocaleString(loc, { minimumFractionDigits: 2 }),
    },
    {
      label: vatRowLabel,
      value: invoice.vatAmount.toLocaleString(loc, { minimumFractionDigits: 2 }),
    },
  ];
  if (showWhtOnDoc) {
    totalRows.push({
      label: printT(L, 'invoiceTotalInclVat'),
      value: `฿ ${invoice.totalAmount.toLocaleString(loc, { minimumFractionDigits: 2 })}`,
      grand: true,
    });
    totalRows.push({
      label: `${printT(L, 'wht')} (${rateDoc}%)`,
      value: `-${whtAmt.toLocaleString(loc, { minimumFractionDigits: 2 })}`,
    });
    totalRows.push({
      label: printT(L, 'netPayableAfterWht'),
      value: `฿ ${netPayable.toLocaleString(loc, { minimumFractionDigits: 2 })}`,
    });
  } else {
    totalRows.push({
      label: printT(L, 'grandTotal'),
      value: `฿ ${invoice.totalAmount.toLocaleString(loc, { minimumFractionDigits: 2 })}`,
      grand: true,
    });
  }
  const amountForWords = invoice.totalAmount;
  const totalWords =
    L === 'en' ? amountToEnglishBahtText(amountForWords) : amountToThaiBahtText(amountForWords);
  const isDraft = invoice.status === 'DRAFT';
  const isCancelled = invoice.status === 'CANCELLED';
  const taxNo = String(invoice.taxInvoiceNo || '').trim();
  const docNoDisplay = taxNo
    ? taxNo
    : isDraft
      ? printT(L, 'awaitingDocNo')
      : '—';
  const issueDateDisplay =
    isDraft && !taxNo ? (L === 'en' ? '(assigned when issued)' : '(กำหนดเมื่อออกฉบับจริง)') : issueStr;
  const headerHtml = buildStandardDocumentHeaderHtml({
    company,
    documentTitleTh: 'ใบกำกับภาษี',
    documentTitleEn: 'Tax Invoice',
    subtitleUnderTitle: taxInvoiceSheetSubtitleForPrintLocale(params.sheetKind, L),
    metaRows: [
      { line: `${printT(L, 'dateIssued')} ${issueDateDisplay}` },
      { line: `${printT(L, 'docNo')}: ${docNoDisplay}` },
      { line: printT(L, 'docIssuedAsSet') },
    ],
    locale: L,
  });
  const partyHtml = buildStandardPartyBoxHtml({
    boxLabel: printT(L, 'customerBuyer'),
    partyName,
    detailLines: partyLines,
  });
  const emptyLines = printT(L, 'noLines');
  const tableHtml = `<table class="sd-table">
    <thead>
      <tr>
        <th class="sd-num">${escapeHtmlDoc(printT(L, 'colNo'))}</th>
        <th>${escapeHtmlDoc(printT(L, 'description'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'qty'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'unitPrice'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'amount'))}</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows || `<tr><td colspan="5" style="text-align:center;color:#737373">${escapeHtmlDoc(emptyLines)}</td></tr>`}
    </tbody>
  </table>`;
  const totalsHtml = buildStandardTotalsWithNotesRowHtml({
    totalsParams: {
      rows: totalRows,
      amountInWords: totalWords,
      amountInWordsLayout: 'underNotes',
    },
    notes: invoice.notes,
    notesTitle: printT(L, 'termsNotes'),
  });
  const cancelReason = String(invoice.cancellationReason || '').trim();
  const cancelReasonHtml =
    isCancelled && cancelReason
      ? `<div class="sd-cancel-reason"><strong>${escapeHtmlDoc(printT(L, 'cancellationReasonLabel'))}:</strong> ${escapeHtmlDoc(cancelReason)}</div>`
      : '';
  const replaceBits: string[] = [];
  if (invoice.replacesTaxInvoiceNo) {
    replaceBits.push(
      `${printT(L, 'replacesNotice')} ${invoice.replacesTaxInvoiceNo}`,
    );
  }
  if (invoice.replacedByTaxInvoiceNo) {
    replaceBits.push(
      `${printT(L, 'replacementNotice')} ${invoice.replacedByTaxInvoiceNo}`,
    );
  }
  const replaceNoticeHtml = replaceBits.length
    ? `<p class="sd-replace-notice">${escapeHtmlDoc(replaceBits.join(' · '))}</p>`
    : '';
  const mainHtml = `${replaceNoticeHtml}${cancelReasonHtml}${partyHtml}
  ${tableHtml}
  ${totalsHtml}`;
  const preparedAccountingName = (() => {
    const fromIssued = (invoice.issuedByName || '').trim();
    if (fromIssued) return fromIssued;
    const fromCreated = (invoice.createdByName || '').trim();
    if (fromCreated) return fromCreated;
    const fromBillingNote = (billingNote?.createdBy || '').trim();
    if (fromBillingNote) return fromBillingNote;
    return '—';
  })();
  const footerHtml = buildStandardSignFooterHtml({
    left: { roleLine: printT(L, 'signPreparedAccounting'), name: preparedAccountingName },
    right: { roleLine: printT(L, 'signCustomerAuth'), name: '—' },
    belowHtml: '',
  });
  let watermarkHtml = '';
  if (isDraft) {
    watermarkHtml = `<div class="sd-status-watermark" aria-hidden="true"><span class="sd-status-watermark-text">${escapeHtmlDoc(printT(L, 'docDraft'))}</span></div>`;
  } else if (isCancelled) {
    watermarkHtml = `<div class="sd-status-watermark sd-status-watermark--cancel" aria-hidden="true"><span class="sd-status-watermark-text">${escapeHtmlDoc(printT(L, 'docCancelled'))}</span></div>`;
  }
  return assembleStandardPrintPageHtml({
    printedAtMs,
    headerHtml,
    mainHtml,
    footerHtml,
    locale: L,
    pageVariant: 'commercial',
    watermarkHtml,
  });
}

/**
 * ที่อยู่วางบิลบนใบเสนอราคา — ใช้ snapshot บนใบก่อน ถ้าไม่มีค่อยดึงจากทะเบียนลูกค้า (billing → registered)
 */
export function resolveQuotationCustomerBillingAddress(
  quotation: Pick<Quotation, 'billingAddressSnapshot'>,
  customer?: Pick<Customer, 'billingAddress' | 'registeredAddress'> | null,
): string {
  const snap = quotation.billingAddressSnapshot?.trim();
  if (snap) return snap;
  const bill = customer?.billingAddress?.trim();
  if (bill) return bill;
  return customer?.registeredAddress?.trim() || '';
}

/** ใบเสนอราคา */
export function buildQuotationPrintHtml(params: {
  company: CompanyProfilePrint | null | undefined;
  quotation: Quotation;
  lines: QuotationLine[];
  /** ทะเบียนลูกค้า — ใช้เติมที่อยู่เมื่อยังไม่มี billingAddressSnapshot บนใบ */
  customer?: Pick<Customer, 'name' | 'billingAddress' | 'registeredAddress' | 'branchType' | 'branchNo'> | null;
  /** ใช้เมื่อพิมพ์จากหน้าแก้ไข — ยอดที่คำนวณจากรายการบนหน้าจอ */
  totalsOverride?: {
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
    grandTotal: number;
    taxPercent: number;
  };
  printedAtMs?: number;
  locale?: PrintDocumentLocale;
}): string {
  const { company, quotation, lines, totalsOverride, printedAtMs } = params;
  const L = params.locale ?? 'th';
  const loc = L === 'en' ? 'en-GB' : 'th-TH';
  const q = quotation;
  const sorted = [...lines].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  const issueStr = formatIssueDateYmdForPrint(q.issueDate, L);
  const validStr =
    L === 'en' ? formatStoredDateGregorian(q.validUntilDate) : formatYmdLocalThaiBE(q.validUntilDate);
  const addressBlock = resolveQuotationCustomerBillingAddress(q, params.customer ?? null);
  const partyLines: string[] = [];
  for (const segment of addressBlock.split(/\r\n|\r|\n/)) {
    const t = segment.trim();
    if (t) partyLines.push(t);
  }
  if (q.contactPerson?.trim()) partyLines.push(`${printT(L, 'contact')}: ${q.contactPerson.trim()}`);
  if (q.referenceNo?.trim()) partyLines.push(`${printT(L, 'reference')}: ${q.referenceNo.trim()}`);

  const lineRows = sorted
    .map((line, idx) => {
      const descBody = escapeHtmlDoc((line.description || '—').replace(/\r\n/g, '\n'));
      const rem = line.remarks?.trim();
      const remHtml = rem
        ? `<div class="sd-line-remarks">${escapeHtmlDoc(rem.replace(/\r\n/g, '\n'))}</div>`
        : '';
      const qty = Number(line.quantity).toLocaleString(loc);
      const unit = escapeHtmlDoc((line.unit || '—').trim() || '—');
      const up = Number(line.unitPrice).toLocaleString(loc, { minimumFractionDigits: 2 });
      const lt = Number(line.lineTotal).toLocaleString(loc, { minimumFractionDigits: 2 });
      return `<tr>
        <td class="sd-num">${idx + 1}</td>
        <td class="sd-line-desc">${descBody}${remHtml}</td>
        <td class="sd-right">${qty}</td>
        <td class="sd-right">${unit}</td>
        <td class="sd-right">${up}</td>
        <td class="sd-right">${lt}</td>
      </tr>`;
    })
    .join('');

  const subtotal = totalsOverride?.subtotal ?? (Number(q.subtotal) || 0);
  const disc = totalsOverride?.discountAmount ?? (Number(q.discountAmount) || 0);
  const taxAmt = totalsOverride?.taxAmount ?? (Number(q.taxAmount) || 0);
  const grand = totalsOverride?.grandTotal ?? (Number(q.grandTotal) || 0);
  const taxPct = totalsOverride?.taxPercent ?? (Number(q.taxPercent) || 7);
  const totalRows: StandardTotalsRow[] = [
    { label: printT(L, 'subtotal'), value: subtotal.toLocaleString(loc, { minimumFractionDigits: 2 }) },
  ];
  if (disc > 0.005) {
    totalRows.push({
      label: printT(L, 'discount'),
      value: `-${disc.toLocaleString(loc, { minimumFractionDigits: 2 })}`,
    });
  }
  totalRows.push({
    label: taxPct > 0 ? `${printT(L, 'vat')} ${taxPct}%` : printT(L, 'vat'),
    value: taxAmt.toLocaleString(loc, { minimumFractionDigits: 2 }),
  });
  totalRows.push({
    label: printT(L, 'grandTotal'),
    value: `฿ ${grand.toLocaleString(loc, { minimumFractionDigits: 2 })}`,
    grand: true,
  });
  const totalWords = L === 'en' ? amountToEnglishBahtText(grand) : amountToThaiBahtText(grand);
  const headerHtml = buildStandardDocumentHeaderHtml({
    company,
    documentTitleTh: 'ใบเสนอราคา',
    documentTitleEn: 'Quotation',
    metaRows: [
      { line: `${printT(L, 'dateIssued')} ${issueStr}` },
      { line: `${printT(L, 'validUntil')}: ${validStr}` },
      { line: `${printT(L, 'docNo')}: ${q.quotationNo}` },
      { line: `${printT(L, 'currency')}: ${q.currency || 'THB'}` },
    ],
    locale: L,
  });
  const partyHtml = buildStandardPartyBoxHtml({
    boxLabel: printT(L, 'customerInfo'),
    partyName: params.customer
      ? formatCustomerPartyNameForPrint(
          {
            name: params.customer.name || q.customerNameSnapshot || '',
            branchType: params.customer.branchType,
            branchNo: params.customer.branchNo,
          },
          q.customerNameSnapshot,
          L,
        )
      : q.customerNameSnapshot?.trim() || '—',
    detailLines: partyLines,
  });
  const projectBlock = q.projectTitle?.trim()
    ? `<p class="sd-purchase-type-line"><strong>${escapeHtmlDoc(printT(L, 'projectTitle'))}:</strong> ${escapeHtmlDoc(q.projectTitle.trim())}</p>`
    : '';
  const emptyLines = printT(L, 'noLines');
  const tableHtml = `<table class="sd-table">
    <thead>
      <tr>
        <th class="sd-num">${escapeHtmlDoc(printT(L, 'colNo'))}</th>
        <th>${escapeHtmlDoc(printT(L, 'description'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'qty'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'unit'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'unitPrice'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'amount'))}</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows || `<tr><td colspan="6" style="text-align:center;color:#737373">${escapeHtmlDoc(emptyLines)}</td></tr>`}
    </tbody>
  </table>`;
  const totalsHtml = buildStandardTotalsWithNotesRowHtml({
    totalsParams: {
      rows: totalRows,
      amountInWords: totalWords,
    },
    notes: q.notes,
    notesTitle: printT(L, 'termsNotes'),
  });
  const mainHtml = `${partyHtml}
  ${projectBlock}
  ${tableHtml}
  ${totalsHtml}`;
  const footerHtml = buildStandardSignFooterHtml({
    left: { roleLine: printT(L, 'signPreparedSales'), name: q.createdBy || '—' },
    right: { roleLine: printT(L, 'quotationPartyFooter'), name: '—' },
    belowHtml: `<p class="sd-approval-notice">${escapeHtmlDoc(printT(L, 'signAcceptQuotation'))}</p>`,
  });
  return assembleStandardPrintPageHtml({
    printedAtMs,
    headerHtml,
    mainHtml,
    footerHtml,
    locale: L,
  });
}

function purchaseTypeTh(t: string | undefined): string {
  if (t === 'CASH') return 'เงินสด';
  if (t === 'CREDIT') return 'เครดิต';
  return t ? String(t) : '—';
}

function purchaseTypeEn(t: string | undefined): string {
  if (t === 'CASH') return 'Cash';
  if (t === 'CREDIT') return 'Credit';
  return t ? String(t) : '—';
}

/**
 * ใบสั่งซื้อ — ประกอบจากบล็อกมาตรฐาน (อ้างอิงสำหรับเอกสารอื่น)
 */
export function buildPurchaseOrderPrintHtml(params: {
  company: CompanyProfilePrint | null | undefined;
  purchase: Purchase;
  vendor: Vendor | null | undefined;
  lines: PurchaseLine[] | null | undefined;
  milestones: PurchasePaymentMilestone[] | null | undefined;
  /** เมื่อ PO อ้าง PR — ชื่อผู้อนุมัติบนปะหน้าต้องเป็นผู้จัดการที่อนุมัติ PR (`decidedByName`) ไม่ใช่ผู้ที่กดยืนยัน PO */
  linkedPurchaseRequest?: Pick<PurchaseRequest, 'decidedByName' | 'status'> | null;
  printedAtMs?: number;
  locale?: PrintDocumentLocale;
}): string {
  const { company, purchase, vendor, lines, milestones, printedAtMs, linkedPurchaseRequest } = params;
  const L = params.locale ?? 'th';
  const loc = L === 'en' ? 'en-GB' : 'th-TH';
  const ymd = purchase.purchaseDate?.trim();
  const poDateIso = ymd ? `${ymd}T12:00:00` : '';
  const poDateStr =
    (L === 'en' ? formatStoredDateGregorian(poDateIso, '') : formatDateThaiBE(poDateIso)) || '—';
  const ms = [...(milestones || [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  const amountBeforeTaxN = Number(purchase.amountBeforeTax ?? 0);
  const vatAmountN = Number(purchase.vatAmount ?? 0);
  const totalAmountN = Number(purchase.totalAmount ?? 0);
  const discountN = Math.max(0, roundMoney2(Number(purchase.discountAmount) || 0));
  const lineSumN = sumLineAmounts((lines || []).map((l) => ({ amount: Number(l.amount) || 0 })));

  const totalRows: { label: string; value: string; grand?: boolean }[] = [];
  if (discountN > 0) {
    totalRows.push({
      label: printT(L, 'lineSubtotal'),
      value: lineSumN.toLocaleString(loc, { minimumFractionDigits: 2 }),
    });
    totalRows.push({
      label: printT(L, 'discount'),
      value: `− ${discountN.toLocaleString(loc, { minimumFractionDigits: 2 })}`,
    });
  }
  totalRows.push(
    {
      label: printT(L, 'subtotal'),
      value: amountBeforeTaxN.toLocaleString(loc, { minimumFractionDigits: 2 }),
    },
    {
      label: L === 'en' ? `${printT(L, 'vat')} 7%` : 'ภาษีมูลค่าเพิ่ม 7%',
      value: vatAmountN.toLocaleString(loc, { minimumFractionDigits: 2 }),
    },
    {
      label: printT(L, 'grandTotal'),
      value: `฿ ${totalAmountN.toLocaleString(loc, { minimumFractionDigits: 2 })}`,
      grand: true,
    },
  );

  const lineRows = (lines || [])
    .map((line, idx) => {
      const desc = escapeHtmlDoc(line.itemDescription || '—');
      const qtyN = Number(line.quantity ?? 0);
      const upN = Number(line.unitPrice ?? 0);
      const amN = Number(line.amount ?? 0);
      const qty = qtyN.toLocaleString(loc);
      const up = upN.toLocaleString(loc, { minimumFractionDigits: 2 });
      const am = amN.toLocaleString(loc, { minimumFractionDigits: 2 });
      return `<tr>
        <td class="sd-num">${idx + 1}</td>
        <td>${desc}</td>
        <td class="sd-right">${qty}</td>
        <td class="sd-right">${up}</td>
        <td class="sd-right">${am}</td>
      </tr>`;
    })
    .join('');

  const termsItems = ms
    .map((m) => {
      let due = '';
      if (m.dueDate) {
        const ds =
          L === 'en'
            ? formatStoredDateGregorian(`${m.dueDate}T12:00:00`)
            : formatDateThaiBE(`${m.dueDate}T12:00:00`);
        due = ` (${printT(L, 'milestoneDue')} ${ds})`;
      }
      const amt = Number(m.amount ?? 0);
      return `<li>${printT(L, 'milestoneLabel')} ${m.sequence ?? '—'}: ${escapeHtmlDoc(m.label || '—')} — ฿${amt.toLocaleString(loc, { minimumFractionDigits: 2 })}${due}</li>`;
    })
    .join('');

  const whtLine =
    purchase.supplierWithholdingEnabled && (purchase.supplierWithholdingRatePercent ?? 0) > 0
      ? `<p class="sd-wht"><strong>${escapeHtmlDoc(printT(L, 'wht'))}:</strong> ${purchase.supplierWithholdingRatePercent}% ${escapeHtmlDoc(printT(L, 'whtRateNote'))}</p>`
      : `<p class="sd-wht"><strong>${escapeHtmlDoc(printT(L, 'wht'))}:</strong> ${escapeHtmlDoc(printT(L, 'whtNoneThisDoc'))}</p>`;

  const notesBlock = purchase.notes?.trim()
    ? `<p class="sd-notes"><strong>${escapeHtmlDoc(printT(L, 'notes'))}:</strong> ${escapeHtmlDoc(formatDocumentNotesForPrint(purchase.notes))}</p>`
    : '';

  const totalWords =
    L === 'en' ? amountToEnglishBahtText(totalAmountN) : amountToThaiBahtText(totalAmountN);

  const showElectronicApprovalNotice = ['APPROVED', 'ISSUED', 'COMPLETED'].includes(purchase.status);
  const approvalNotice = showElectronicApprovalNotice
    ? `<p class="sd-approval-notice">${escapeHtmlDoc(printT(L, 'approvedElectronically'))}</p>`
    : '';

  const headerHtml = buildStandardDocumentHeaderHtml({
    company,
    documentTitleTh: 'ใบสั่งซื้อ',
    documentTitleEn: 'Purchase Order',
    metaRows: [
      { line: `${printT(L, 'docDate')}: ${poDateStr}` },
      { line: `${printT(L, 'docNo')}: ${purchase.purchaseNo || '—'}` },
    ],
    locale: L,
  });

  const partyHtml = buildStandardPartyBoxHtml({
    boxLabel: printT(L, 'vendorInfo'),
    partyName: vendor?.vendorName || '—',
    detailLines: [
      ...(vendor?.address ? [vendor.address] : []),
      ...(vendor?.phone ? [`${printT(L, 'tel')} ${vendor.phone}`] : []),
      ...(vendor?.taxId ? [`${printT(L, 'taxId')} ${vendor.taxId}`] : []),
    ],
  });

  const emptyLines = printT(L, 'noLines');
  const tableHtml = `<table class="sd-table">
    <thead>
      <tr>
        <th class="sd-num">${escapeHtmlDoc(printT(L, 'colNo'))}</th>
        <th>${escapeHtmlDoc(printT(L, 'description'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'qty'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'unitPrice'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'amount'))}</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows || `<tr><td colspan="5" style="text-align:center;color:#737373">${escapeHtmlDoc(emptyLines)}</td></tr>`}
    </tbody>
  </table>`;

  const totalsHtml = buildStandardTotalsBlockHtml({
    rows: totalRows,
    amountInWords: totalWords,
  });

  const purchaseTypeLabel = L === 'en' ? purchaseTypeEn(purchase.purchaseType) : purchaseTypeTh(purchase.purchaseType);
  const mainHtml = `${partyHtml}
  ${tableHtml}
  ${totalsHtml}
  <h2 class="sd-section-title">${escapeHtmlDoc(printT(L, 'paymentTerms'))}</h2>
  <p class="sd-purchase-type-line"><strong>${escapeHtmlDoc(printT(L, 'purchaseType'))}:</strong> ${escapeHtmlDoc(purchaseTypeLabel)}</p>
  ${ms.length ? `<ol class="sd-terms">${termsItems}</ol>` : `<p class="sd-notes" style="margin-top:0">${escapeHtmlDoc(printT(L, 'noMilestones'))}</p>`}
  ${whtLine}
  ${notesBlock}`;

  const prApproverDisplay =
    purchase.purchaseRequestId?.trim() &&
    (linkedPurchaseRequest?.status === 'APPROVED' ||
      linkedPurchaseRequest?.status === 'PO_ISSUED') &&
    linkedPurchaseRequest.decidedByName?.trim()
      ? linkedPurchaseRequest.decidedByName.trim()
      : purchase.approvalDecisionByName?.trim() || '';

  const footerHtml = buildStandardSignFooterHtml({
    left: { roleLine: printT(L, 'signPreparedPurchasing'), name: purchase.createdByName || '—' },
    right: { roleLine: printT(L, 'signApproverOps'), name: prApproverDisplay || '—' },
    belowHtml: approvalNotice,
  });

  return assembleStandardPrintPageHtml({
    printedAtMs,
    headerHtml,
    mainHtml,
    footerHtml,
    locale: L,
    /** เลย์เอาต์กระชับ — เดียวกับใบแจ้งหนี้เรียกเก็บ (ตาราง/ลายเซ็น/ขอบกระดาษ) เพื่อให้ PO สั้นๆ พอดีหนึ่งหน้า */
    pageVariant: 'commercial',
  });
}

export type PurchaseRequestPrintLine = {
  itemDescription?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  amount?: number;
};

/** ใบขอสั่งซื้อ (PR) — รูปแบบเดียวกับใบสั่งซื้อ */
export function buildPurchaseRequestPrintHtml(params: {
  company: CompanyProfilePrint | null | undefined;
  request: PurchaseRequest;
  vendor: Vendor | null | undefined;
  lines: PurchaseRequestPrintLine[] | null | undefined;
  printedAtMs?: number;
  locale?: PrintDocumentLocale;
}): string {
  const { company, request, vendor, lines, printedAtMs } = params;
  const L = params.locale ?? 'th';
  const loc = L === 'en' ? 'en-GB' : 'th-TH';
  const needByStr = formatIssueDateYmdForPrint(request.needByDate, L);
  const amountBeforeTaxN = Number(request.amountBeforeTax ?? 0);
  const vatAmountN = Number(request.vatAmount ?? 0);
  const totalAmountN = Number(request.totalAmount ?? request.estimatedAmount ?? 0);

  const totalRows: { label: string; value: string; grand?: boolean }[] = [
    {
      label: printT(L, 'subtotal'),
      value: amountBeforeTaxN.toLocaleString(loc, { minimumFractionDigits: 2 }),
    },
    {
      label: L === 'en' ? `${printT(L, 'vat')} 7%` : 'ภาษีมูลค่าเพิ่ม 7%',
      value: vatAmountN.toLocaleString(loc, { minimumFractionDigits: 2 }),
    },
    {
      label: printT(L, 'grandTotal'),
      value: `฿ ${totalAmountN.toLocaleString(loc, { minimumFractionDigits: 2 })}`,
      grand: true,
    },
  ];

  const lineRows = (lines || [])
    .map((line, idx) => {
      const desc = escapeHtmlDoc(line.itemDescription || '—');
      const qtyN = Number(line.quantity ?? 0);
      const upN = Number(line.unitPrice ?? 0);
      const amN = Number(line.amount ?? 0);
      return `<tr>
        <td class="sd-num">${idx + 1}</td>
        <td>${desc}</td>
        <td class="sd-right">${qtyN.toLocaleString(loc)}</td>
        <td class="sd-right">${upN.toLocaleString(loc, { minimumFractionDigits: 2 })}</td>
        <td class="sd-right">${amN.toLocaleString(loc, { minimumFractionDigits: 2 })}</td>
      </tr>`;
    })
    .join('');

  const notesBlock = request.notes?.trim()
    ? `<p class="sd-notes"><strong>${escapeHtmlDoc(printT(L, 'notes'))}:</strong> ${escapeHtmlDoc(formatDocumentNotesForPrint(request.notes))}</p>`
    : '';

  const titleBlock = request.title?.trim()
    ? `<p class="sd-notes" style="margin-top:0"><strong>${escapeHtmlDoc(L === 'en' ? 'Subject' : 'หัวข้อ')}:</strong> ${escapeHtmlDoc(request.title.trim())}</p>`
    : '';

  const totalWords =
    L === 'en' ? amountToEnglishBahtText(totalAmountN) : amountToThaiBahtText(totalAmountN);

  const showElectronicApprovalNotice =
    request.status === 'APPROVED' || request.status === 'PO_ISSUED';
  const approvalNotice = showElectronicApprovalNotice
    ? `<p class="sd-approval-notice">${escapeHtmlDoc(printT(L, 'approvedElectronically'))}</p>`
    : '';

  const headerHtml = buildStandardDocumentHeaderHtml({
    company,
    documentTitleTh: 'ใบขอสั่งซื้อ',
    documentTitleEn: 'Purchase Request',
    metaRows: [
      { line: `${printT(L, 'docNo')}: ${request.requestNo || '—'}` },
      ...(needByStr && needByStr !== '—'
        ? [{ line: `${L === 'en' ? 'Required date' : 'วันที่ต้องการของ'}: ${needByStr}` }]
        : []),
    ],
    locale: L,
  });

  const partyHtml = buildStandardPartyBoxHtml({
    boxLabel: printT(L, 'vendorInfo'),
    partyName: vendor?.vendorName || '—',
    detailLines: [
      ...(vendor?.address ? [vendor.address] : []),
      ...(vendor?.phone ? [`${printT(L, 'tel')} ${vendor.phone}`] : []),
      ...(vendor?.taxId ? [`${printT(L, 'taxId')} ${vendor.taxId}`] : []),
    ],
  });

  const emptyLines = printT(L, 'noLines');
  const tableHtml = `<table class="sd-table">
    <thead>
      <tr>
        <th class="sd-num">${escapeHtmlDoc(printT(L, 'colNo'))}</th>
        <th>${escapeHtmlDoc(printT(L, 'description'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'qty'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'unitPrice'))}</th>
        <th class="sd-right">${escapeHtmlDoc(printT(L, 'amount'))}</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows || `<tr><td colspan="5" style="text-align:center;color:#737373">${escapeHtmlDoc(emptyLines)}</td></tr>`}
    </tbody>
  </table>`;

  const totalsHtml = buildStandardTotalsBlockHtml({
    rows: totalRows,
    amountInWords: totalWords,
  });

  const payType = request.purchasePaymentType;
  const purchaseTypeLabel = L === 'en' ? purchaseTypeEn(payType) : purchaseTypeTh(payType);
  const prWhtLine =
    request.lineEntryMode === 'SERVICE' || request.supplierWithholdingEnabled
      ? request.supplierWithholdingEnabled && (request.supplierWithholdingRatePercent ?? 0) > 0
        ? `<p class="sd-wht"><strong>${escapeHtmlDoc(printT(L, 'wht'))}:</strong> ${request.supplierWithholdingRatePercent}% ${escapeHtmlDoc(printT(L, 'whtRateNote'))}</p>`
        : `<p class="sd-wht"><strong>${escapeHtmlDoc(printT(L, 'wht'))}:</strong> ${escapeHtmlDoc(printT(L, 'whtNoneThisDoc'))}</p>`
      : '';
  const mainHtml = `${partyHtml}
  ${titleBlock}
  ${tableHtml}
  ${totalsHtml}
  <h2 class="sd-section-title">${escapeHtmlDoc(printT(L, 'paymentTerms'))}</h2>
  <p class="sd-purchase-type-line"><strong>${escapeHtmlDoc(printT(L, 'purchaseType'))}:</strong> ${escapeHtmlDoc(purchaseTypeLabel)}</p>
  ${prWhtLine}
  ${notesBlock}`;

  const footerHtml = buildStandardSignFooterHtml({
    left: { roleLine: printT(L, 'signPreparedPurchasing'), name: request.requestedByName || '—' },
    right: {
      roleLine: printT(L, 'signApproverOps'),
      name:
        request.status === 'APPROVED' || request.status === 'PO_ISSUED' || request.status === 'REJECTED'
          ? request.decidedByName?.trim() || '—'
          : '—',
    },
    belowHtml: approvalNotice,
  });

  return assembleStandardPrintPageHtml({
    printedAtMs,
    headerHtml,
    mainHtml,
    footerHtml,
    locale: L,
    pageVariant: 'commercial',
  });
}

export function buildMoneyReceiptPrintHtml(params: {
  company: CompanyProfilePrint | null | undefined;
  receipt: MoneyReceipt;
  taxInvoice: Pick<TaxInvoice, 'taxInvoiceNo' | 'totalAmount' | 'currency' | 'issueDate'>;
  customer: Customer | null | undefined;
  printedAtMs?: number;
  locale?: PrintDocumentLocale;
  /** ลำดับแผ่นพิมพ์ — ต้นฉบับ/สำเนา; ค่าเริ่มต้น ['original'] */
  sheets?: TaxInvoicePrintSheet[];
}): string {
  const { sheets, ...rest } = params;
  const sheetList: TaxInvoicePrintSheet[] = sheets?.length ? sheets : ['original'];
  return sheetList
    .map((sheetKind) => buildMoneyReceiptPrintHtmlSinglePage({ ...rest, sheetKind }))
    .join('');
}

function buildMoneyReceiptPrintHtmlSinglePage(params: {
  company: CompanyProfilePrint | null | undefined;
  receipt: MoneyReceipt;
  taxInvoice: Pick<TaxInvoice, 'taxInvoiceNo' | 'totalAmount' | 'currency' | 'issueDate'>;
  customer: Customer | null | undefined;
  printedAtMs?: number;
  locale?: PrintDocumentLocale;
  sheetKind: TaxInvoicePrintSheet;
}): string {
  const { company, receipt, taxInvoice, customer, printedAtMs } = params;
  const L = params.locale ?? 'th';
  const loc = L === 'en' ? 'en-GB' : 'th-TH';
  const issueStr = formatIssueDateYmdForPrint(receipt.receiptDate, L);
  const partyName = formatCustomerPartyNameForPrint(customer, null, L);
  const refNoLabel = L === 'en' ? 'Tax invoice no.' : 'อ้างอิงใบกำกับภาษี';
  const refDateLabel = L === 'en' ? 'Tax invoice date' : 'วันที่ออกใบกำกับ';
  const taxInvIssueStr = formatIssueDateYmdForPrint(taxInvoice.issueDate, L);
  const lineItemTitle =
    L === 'en' ? 'Payment received for goods/services per referenced tax invoice' : 'รับเงินค่าสินค้า/บริการ ตามใบกำกับภาษีอ้างอิง';
  const lineDescriptionHtml = `<strong>${escapeHtmlDoc(lineItemTitle)}</strong>
    <div class="sd-receipt-tax-ref" style="margin-top:5px;font-size:9.5pt;font-weight:normal;line-height:1.35">
      ${escapeHtmlDoc(refNoLabel)}: ${escapeHtmlDoc(taxInvoice.taxInvoiceNo)}<br/>
      ${escapeHtmlDoc(refDateLabel)}: ${escapeHtmlDoc(taxInvIssueStr)}
    </div>`;
  const headerHtml = buildStandardDocumentHeaderHtml({
    company,
    documentTitleTh: 'ใบเสร็จรับเงิน',
    documentTitleEn: 'Receipt',
    subtitleUnderTitle: taxInvoiceSheetSubtitleForPrintLocale(params.sheetKind, L),
    metaRows: [
      { line: `${printT(L, 'dateIssued')} ${issueStr}` },
      { line: `${printT(L, 'docNo')}: ${receipt.receiptNo}` },
      { line: printT(L, 'docIssuedAsSet') },
    ],
    locale: L,
  });
  const partyHtml = buildStandardPartyBoxHtml({
    boxLabel: printT(L, 'customerBuyer'),
    partyName,
    detailLines: customerPartyDetailLines(customer, L),
  });
  const amountWords = L === 'en' ? amountToEnglishBahtText(receipt.amount) : amountToThaiBahtText(receipt.amount);
  const mainHtml = `${partyHtml}
  <table class="sd-table"><tbody>
    <tr><td class="sd-num">1</td><td>${lineDescriptionHtml}</td>
    <td class="sd-right">1</td>
    <td class="sd-right">—</td>
    <td class="sd-right">${receipt.amount.toLocaleString(loc, { minimumFractionDigits: 2 })}</td></tr>
  </tbody></table>
  <div class="sd-totals">
    <p class="sd-grand"><strong>${escapeHtmlDoc(printT(L, 'grandTotal'))}:</strong> ${receipt.currency} ${receipt.amount.toLocaleString(loc, { minimumFractionDigits: 2 })}</p>
    <p class="sd-words">${escapeHtmlDoc(amountWords)}</p>
  </div>`;
  const footerHtml = buildStandardSignFooterHtml({
    left: { roleLine: L === 'en' ? 'Receiver (Accounting)' : 'ผู้รับเงิน (บัญชี)', name: receipt.createdByName || '—' },
    right: { roleLine: printT(L, 'signCustomerAuth'), name: '—' },
  });
  return assembleStandardPrintPageHtml({
    printedAtMs,
    headerHtml,
    mainHtml,
    footerHtml,
    locale: L,
  });
}
