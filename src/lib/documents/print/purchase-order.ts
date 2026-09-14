import type {
  Purchase,
  PurchaseLine,
  PurchasePaymentMilestone,
  PurchaseRequest,
  Vendor,
} from '@/lib/types';
import {
  formatDateThaiBE,
  formatStoredDateGregorian,
} from '@/lib/date-thai';
import { amountToThaiBahtText } from '@/lib/documents/thai-baht-text';
import { amountToEnglishBahtText } from '@/lib/documents/english-baht-text';
import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';
import { printT } from '@/lib/documents/document-print-i18n';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import { sumLineAmounts } from '@/lib/purchase/pr-totals';
import {
  type CompanyProfilePrint,
  assembleStandardPrintPageHtml,
  buildStandardDocumentHeaderHtml,
  buildStandardPartyBoxHtml,
  buildStandardSignFooterHtml,
  buildStandardTotalsBlockHtml,
  escapeHtmlDoc,
  formatDocumentNotesForPrint,
} from './standard-html-primitives';

export function purchaseTypeTh(t: string | undefined): string {
  if (t === 'CASH') return 'เงินสด';
  if (t === 'CREDIT') return 'เครดิต';
  return t ? String(t) : '—';
}

export function purchaseTypeEn(t: string | undefined): string {
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
