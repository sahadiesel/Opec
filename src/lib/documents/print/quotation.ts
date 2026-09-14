import type {
  Customer,
  Quotation,
  QuotationLine,
} from '@/lib/types';
import {
  formatStoredDateGregorian,
  formatYmdLocalThaiBE,
} from '@/lib/date-thai';
import { amountToThaiBahtText } from '@/lib/documents/thai-baht-text';
import { amountToEnglishBahtText } from '@/lib/documents/english-baht-text';
import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';
import { printT } from '@/lib/documents/document-print-i18n';
import {
  type CompanyProfilePrint,
  type StandardTotalsRow,
  assembleStandardPrintPageHtml,
  buildStandardDocumentHeaderHtml,
  buildStandardPartyBoxHtml,
  buildStandardSignFooterHtml,
  buildStandardTotalsWithNotesRowHtml,
  escapeHtmlDoc,
  formatCustomerPartyNameForPrint,
  formatIssueDateYmdForPrint,
} from './standard-html-primitives';

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
