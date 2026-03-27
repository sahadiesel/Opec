'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Quotation, QuotationLine } from '@/lib/types';

type CompanyDocumentProfile = {
  companyNameTh?: string;
  companyNameEn?: string;
  taxId?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
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
  displayLines: QuotationLine[];
  editedHeader: Partial<Quotation>;
  totals: Totals;
}

export function QuotationPreviewTab({ quotation, companyProfile, displayLines, editedHeader, totals }: QuotationPreviewTabProps) {
  return (
    <div className="bg-white border rounded-lg shadow-xl max-w-[21cm] mx-auto p-8 space-y-6 font-serif text-slate-900 overflow-hidden print-container print:shadow-none print:border-none">
      <div className="flex justify-between items-start border-b-4 border-primary pb-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-black text-primary tracking-tight">
            {companyProfile?.companyNameEn || companyProfile?.companyNameTh || 'OPEC OpsFlow'}
          </h2>
          <p className="text-[10px] text-slate-500">
            {(companyProfile?.addressLine1 || '')} {(companyProfile?.addressLine2 || '')}
          </p>
          <p className="text-[10px] text-slate-500">
            Tax ID: {companyProfile?.taxId || '-'} | Tel: {companyProfile?.phone || '-'}
          </p>
        </div>
        <div className="text-right space-y-1">
          <h3 className="text-xl font-black uppercase text-slate-800">Quotation</h3>
          <p className="font-mono text-sm font-bold text-primary">{quotation.quotationNo}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8 text-sm">
        <div className="space-y-3">
          <p className="font-black text-xs uppercase tracking-widest text-slate-400 border-b pb-1">Issued To:</p>
          <div className="space-y-1">
            <p className="font-bold text-lg">{quotation.customerNameSnapshot}</p>
            <p className="text-slate-600 leading-relaxed text-xs">{quotation.billingAddressSnapshot || 'N/A'}</p>
            <p className="text-slate-600">Contact: {quotation.contactPerson || '-'}</p>
          </div>
        </div>
        <div className="space-y-3">
          <p className="font-black text-xs uppercase tracking-widest text-slate-400 border-b pb-1">Document Dates:</p>
          <div className="grid grid-cols-2 gap-2">
            <span className="text-slate-500">Date Issued:</span>
            <span className="font-bold text-right">{editedHeader.issueDate || quotation.issueDate}</span>
            <span className="text-slate-500">Valid Until:</span>
            <span className="font-bold text-right text-red-600">{editedHeader.validUntilDate || quotation.validUntilDate}</span>
            <span className="text-slate-500">Currency:</span>
            <span className="font-bold text-right">{editedHeader.currency || quotation.currency}</span>
          </div>
        </div>
      </div>

      <div className="bg-slate-50 p-3 border rounded">
        <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Subject / Project Title:</p>
        <p className="font-bold text-base text-primary">{editedHeader.projectTitle || quotation.projectTitle}</p>
      </div>

      <div className="space-y-2">
        <Table className="border-collapse">
          <TableHeader className="bg-slate-100 border-y-2 border-slate-300">
            <TableRow className="hover:bg-transparent border-none">
              <TableHead className="font-black text-slate-800 py-2 h-auto">Item Description</TableHead>
              <TableHead className="text-right font-black text-slate-800 w-[80px] h-auto">Qty</TableHead>
              <TableHead className="text-center font-black text-slate-800 w-[80px] h-auto">Unit</TableHead>
              <TableHead className="text-right font-black text-slate-800 w-[120px] h-auto">Unit Price</TableHead>
              <TableHead className="text-right font-black text-slate-800 w-[120px] h-auto">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayLines.map(line => (
              <TableRow key={line.id} className="border-b border-slate-100 hover:bg-transparent">
                <TableCell className="py-2">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">{line.description}</span>
                    {line.remarks && <span className="text-[10px] text-slate-500 italic mt-0.5">{line.remarks}</span>}
                  </div>
                </TableCell>
                <TableCell className="text-right font-bold">{line.quantity}</TableCell>
                <TableCell className="text-center text-[10px] uppercase font-bold text-slate-500">{line.unit}</TableCell>
                <TableCell className="text-right">฿{(line.unitPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                <TableCell className="text-right font-bold text-slate-800">฿{(line.lineTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end pt-3">
        <div className="w-[300px] space-y-2 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal:</span>
            <span className="font-bold text-slate-800">฿{totals.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
          {(totals.discountAmount || 0) > 0 && (
            <div className="flex justify-between text-red-600 font-bold">
              <span>Discount:</span>
              <span>- ฿{totals.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
          )}
          <div className="flex justify-between text-slate-600">
            <span>VAT ({totals.taxPercent}%):</span>
            <span className="font-bold text-slate-800">฿{totals.taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between text-xl border-t-2 border-slate-800 pt-2">
            <span className="font-black text-primary">Grand Total:</span>
            <span className="font-black text-primary underline decoration-double">฿{totals.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      <div className="pt-4 space-y-2">
        <p className="text-xs font-black uppercase text-slate-400 border-b pb-1 tracking-widest">Notes & Conditions:</p>
        <p className="text-xs text-slate-600 leading-relaxed italic whitespace-pre-line bg-slate-50 p-4 rounded border-l-4 border-slate-300">
          {editedHeader.notes || quotation.notes || 'No special conditions mentioned. This quotation is subject to standard manpower supply terms and conditions of OPEC.'}
        </p>
      </div>

      <div className="pt-8 grid grid-cols-2 gap-16">
        <div className="border-t border-slate-300 pt-4 text-center space-y-1">
          <p className="font-black text-[10px] uppercase text-slate-400 mb-12">Authorized Signature (Issuer)</p>
          <p className="font-bold text-sm text-slate-800">{quotation.createdBy}</p>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">OPEC Sales Management</p>
        </div>
        <div className="border-t border-slate-300 pt-4 text-center space-y-1">
          <p className="font-black text-[10px] uppercase text-slate-400 mb-12">Customer Acceptance</p>
          <div className="h-4" />
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Seal & Signature</p>
        </div>
      </div>
    </div>
  );
}
