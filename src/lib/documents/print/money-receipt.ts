import type {
  Customer,
  MoneyReceipt,
  TaxInvoice,
} from '@/lib/types';
import { amountToThaiBahtText } from '@/lib/documents/thai-baht-text';
import { amountToEnglishBahtText } from '@/lib/documents/english-baht-text';
import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';
import { printT } from '@/lib/documents/document-print-i18n';
import {
  type CompanyProfilePrint,
  assembleStandardPrintPageHtml,
  buildStandardDocumentHeaderHtml,
  buildStandardPartyBoxHtml,
  buildStandardSignFooterHtml,
  customerPartyDetailLines,
  escapeHtmlDoc,
  formatCustomerPartyNameForPrint,
  formatIssueDateYmdForPrint,
} from './standard-html-primitives';
import {
  type TaxInvoicePrintSheet,
  taxInvoiceSheetSubtitleForPrintLocale,
} from './tax-invoice';

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
