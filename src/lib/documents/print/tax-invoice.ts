import type {
  BillingNote,
  BillingNoteLine,
  CommercialInvoice,
  CommercialInvoiceLine,
  Customer,
  TaxInvoice,
} from '@/lib/types';
import { amountToThaiBahtText } from '@/lib/documents/thai-baht-text';
import { amountToEnglishBahtText } from '@/lib/documents/english-baht-text';
import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';
import { printT } from '@/lib/documents/document-print-i18n';
import { translateCommercialLineDescriptionToEn } from '@/lib/documents/commercial-line-description-en';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import {
  type CompanyProfilePrint,
  type StandardTotalsRow,
  assembleStandardPrintPageHtml,
  buildStandardDocumentHeaderHtml,
  buildStandardPartyBoxHtml,
  buildStandardSignFooterHtml,
  buildStandardTotalsWithNotesRowHtml,
  customerPartyDetailLines,
  escapeHtmlDoc,
  formatCustomerPartyNameForPrint,
  formatIssueDateYmdForPrint,
  invoiceLineSequenceNumberFromDisplayOrder,
  sortBillingNoteLinesForDisplay,
  sortCommercialInvoiceLinesForDisplay,
} from './standard-html-primitives';

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
