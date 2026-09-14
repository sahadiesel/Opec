import type {
  PurchaseRequest,
  Vendor,
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
  buildStandardTotalsBlockHtml,
  escapeHtmlDoc,
  formatDocumentNotesForPrint,
  formatIssueDateYmdForPrint,
} from './standard-html-primitives';
import { purchaseTypeEn, purchaseTypeTh } from './purchase-order';

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
