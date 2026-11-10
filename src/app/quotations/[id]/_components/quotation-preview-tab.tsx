'use client';

import { useMemo } from 'react';
import type { Quotation, QuotationLine, Customer } from '@/lib/types';
import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';
import type { DocumentPrintMarks } from '@/lib/types/document-signature';
import {
  buildQuotationPrintHtml,
  wrapStandardPrintDocument,
} from '@/lib/documents/standard-document-print';

type CompanyDocumentProfile = {
  companyNameTh?: string;
  companyNameEn?: string;
  taxId?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  documentHeaderLogoUrl?: string;
};

interface Totals {
  subtotal: number;
  taxAmount: number;
  grandTotal: number;
  discountAmount: number;
  taxPercent: number;
}

interface QuotationPreviewTabProps {
  quotation: Quotation;
  companyProfile: CompanyDocumentProfile | null;
  /** ทะเบียนลูกค้า — แสดงที่อยู่เมื่อยังไม่ snapshot บนใบ */
  customer?: Customer | null;
  displayLines: QuotationLine[];
  editedHeader: Partial<Quotation>;
  totals: Totals;
  /** ภาษาเดียวกับปุ่มพิมพ์ — ให้พรีวิวตรงเอกสารที่พิมพ์ */
  printLocale?: PrintDocumentLocale;
  /** ลายเซ็น/ตรายางที่เลือกแนบ — ให้พรีวิวตรงกับตอนพิมพ์ */
  printMarks?: DocumentPrintMarks;
}

export function QuotationPreviewTab({
  quotation,
  companyProfile,
  customer,
  displayLines,
  editedHeader,
  totals,
  printLocale = 'th',
  printMarks,
}: QuotationPreviewTabProps) {
  const previewHtml = useMemo(() => {
    const headerSlice = { ...quotation, ...editedHeader } as Quotation;
    const body = buildQuotationPrintHtml({
      company: companyProfile ?? undefined,
      quotation: headerSlice,
      customer: customer ?? undefined,
      lines: displayLines,
      totalsOverride: {
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        grandTotal: totals.grandTotal,
        taxPercent: totals.taxPercent,
      },
      printedAtMs: Date.now(),
      locale: printLocale,
      printMarks,
    });
    return wrapStandardPrintDocument(quotation.quotationNo || 'quotation', body, {
      lang: printLocale,
    });
  }, [
    quotation,
    editedHeader,
    companyProfile,
    customer,
    displayLines,
    totals.subtotal,
    totals.discountAmount,
    totals.taxAmount,
    totals.grandTotal,
    totals.taxPercent,
    printLocale,
    printMarks,
  ]);

  return (
    <div className="mx-auto max-w-[210mm] overflow-hidden rounded-lg border bg-white shadow-xl print:shadow-none print:border-none">
      <iframe
        title={`quotation-preview-${quotation.quotationNo || quotation.id}`}
        className="w-full min-h-[min(1120px,85vh)] border-0 bg-white"
        srcDoc={previewHtml}
      />
    </div>
  );
}
