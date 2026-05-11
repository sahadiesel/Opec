'use client';

import { useMemo } from 'react';
import type { BillingNoteLine, CommercialInvoiceLine } from '@/lib/types';
import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';
import { translateCommercialLineDescriptionToEn } from '@/lib/documents/commercial-line-description-en';
import {
  invoiceLineSequenceNumberFromDisplayOrder,
  sortBillingNoteLinesForDisplay,
  sortCommercialInvoiceLinesForDisplay,
} from '@/lib/documents/standard-document-print';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function TaxInvoiceLinesTable({
  lines,
  commercialLines,
  documentLocale = 'th',
  numberLocale,
  columnHeaders,
  emptyLabel,
  currency,
}: {
  lines: BillingNoteLine[] | null | undefined;
  /** ลำดับ/ข้อความเดียวกับใบเรียกเก็บ (ลูกค้า approve) — ถ้ามีจะแสดงแทนรายการใบวางบิล */
  commercialLines?: CommercialInvoiceLine[] | null;
  /** ภาษาตัวอย่างบนหน้าจอ — EN + รายการจากใบเรียกเก็บ ให้คำอธิบายตรงกับตอนพิมพ์ (`translateCommercialLineDescriptionToEn`) */
  documentLocale?: PrintDocumentLocale;
  numberLocale: string;
  columnHeaders: {
    no: string;
    description: string;
    qty: string;
    unitPrice: string;
    amount: string;
  };
  emptyLabel: string;
  currency: string;
}) {
  const sortedBilling = useMemo(() => sortBillingNoteLinesForDisplay(lines), [lines]);
  const useCommercial = (commercialLines?.length ?? 0) > 0;
  const sortedCommercial = useMemo(
    () => sortCommercialInvoiceLinesForDisplay(commercialLines),
    [commercialLines],
  );
  const rows: Array<{ key: string; lineNo: number; desc: string; q: number; up: number; am: number }> = useMemo(() => {
    if (useCommercial) {
      return sortedCommercial.map((line, idx) => {
        const sub = line.workerName ? ` (${line.workerName})` : '';
        const rawDesc = (line.description || '—') + sub;
        const desc =
          documentLocale === 'en' ? translateCommercialLineDescriptionToEn(rawDesc) : rawDesc;
        return {
          key: line.id || `c-${idx}`,
          lineNo: invoiceLineSequenceNumberFromDisplayOrder(line.displayOrder, idx),
          desc,
          q: Number(line.quantity),
          up: Number(line.unitPrice),
          am: Number(line.amount ?? line.quantity * line.unitPrice),
        };
      });
    }
    return sortedBilling.map((line, idx) => ({
      key: line.id,
      lineNo: invoiceLineSequenceNumberFromDisplayOrder(line.displayOrder, idx),
      desc: line.description || '—',
      q: Number(line.quantity),
      up: Number(line.unitPrice),
      am: Number(line.amount),
    }));
  }, [useCommercial, sortedCommercial, sortedBilling, documentLocale]);

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-center font-semibold">{columnHeaders.no}</TableHead>
            <TableHead className="font-semibold min-w-[12rem]">{columnHeaders.description}</TableHead>
            <TableHead className="text-right font-semibold w-20">{columnHeaders.qty}</TableHead>
            <TableHead className="text-right font-semibold w-24">{columnHeaders.unitPrice}</TableHead>
            <TableHead className="text-right font-semibold w-28">{columnHeaders.amount}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-6">
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="text-center tabular-nums text-muted-foreground">{row.lineNo}</TableCell>
                <TableCell>{row.desc}</TableCell>
                <TableCell className="text-right tabular-nums">{row.q.toLocaleString(numberLocale)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {currency} {row.up.toLocaleString(numberLocale, { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {currency} {row.am.toLocaleString(numberLocale, { minimumFractionDigits: 2 })}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
