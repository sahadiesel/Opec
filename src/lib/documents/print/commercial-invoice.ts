import type {
  CommercialInvoice,
  CommercialInvoiceLine,
  Customer,
  MainContract,
  PurchaseOrder,
  Quotation,
} from '@/lib/types';
import {
  formatDateTimeGregorian,
  formatDateTimeThaiBE,
  formatStoredDateRangeGregorian,
  formatStoredDateRangeThaiBE,
} from '@/lib/date-thai';
import { amountToThaiBahtText } from '@/lib/documents/thai-baht-text';
import { amountToEnglishBahtText } from '@/lib/documents/english-baht-text';
import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';
import { printT } from '@/lib/documents/document-print-i18n';
import {
  translateCommercialLineDescriptionToEn,
  translateCommercialNotesToEn,
  translateCommercialWaveCodeToEn,
} from '@/lib/documents/commercial-line-description-en';
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
  sortCommercialInvoiceLinesForDisplay,
} from './standard-html-primitives';

/** Portal print: single title — status is shown in the app table, not in the document header */
function commercialInvoiceDocTitles(): { th: string; en: string } {
  return { th: 'ใบแจ้งหนี้', en: 'Invoice' };
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
