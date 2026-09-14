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
 *
 * Implementation is split under `./print/`; this file re-exports the public API.
 */

export type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';

export type {
  CompanyProfilePrint,
  PartyBranchFields,
  StandardDocMetaRow,
  StandardTotalsRow,
} from './print/standard-html-primitives';

export {
  formatPartyBranchParenLabel,
  appendPartyBranchParenToName,
  formatCustomerPartyNameForPrint,
  escapeHtmlDoc,
  formatDocumentNotesForPrint,
  sanitizePrintFileBaseName,
  sortBillingNoteLinesForDisplay,
  sortCommercialInvoiceLinesForDisplay,
  invoiceLineSequenceNumberFromDisplayOrder,
  STANDARD_DOCUMENT_PRINT_CSS,
  companyProfileAddressForPrintLocale,
  buildStandardCompanyColumnHtml,
  buildStandardTitleColumnHtml,
  buildStandardDocumentHeaderHtml,
  buildStandardPartyBoxHtml,
  buildStandardPrintStampHtml,
  buildStandardTotalsBlockHtml,
  buildStandardTotalsWithNotesRowHtml,
  buildStandardSignFooterHtml,
  assembleStandardPrintPageHtml,
  wrapStandardPrintDocument,
  openStandardPrintWindow,
} from './print/standard-html-primitives';

export { buildCommercialInvoicePrintHtml } from './print/commercial-invoice';

export type { TaxInvoicePrintSheet } from './print/tax-invoice';
export {
  taxInvoiceSheetSubtitleForPrintLocale,
  buildTaxInvoicePrintHtml,
} from './print/tax-invoice';

export {
  resolveQuotationCustomerBillingAddress,
  buildQuotationPrintHtml,
} from './print/quotation';

export { buildPurchaseOrderPrintHtml } from './print/purchase-order';

export type { PurchaseRequestPrintLine } from './print/purchase-request';
export { buildPurchaseRequestPrintHtml } from './print/purchase-request';

export { buildMoneyReceiptPrintHtml } from './print/money-receipt';
