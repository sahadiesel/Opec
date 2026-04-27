'use client';

import { useMemo } from 'react';
import type { BillingNoteLine, CommercialInvoiceLine } from '@/lib/types';
import { sortBillingNoteLinesForDisplay } from '@/lib/documents/standard-document-print';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function TaxInvoiceLinesTable({
  lines,
  commercialLines,
  numberLocale,
  columnHeaders,
  emptyLabel,
  currency,
}: {
  lines: BillingNoteLine[] | null | undefined;
  /** ลำดับ/ข้อความเดียวกับใบเรียกเก็บ (ลูกค้า approve) — ถ้ามีจะแสดงแทนรายการใบวางบิล */
  commercialLines?: CommercialInvoiceLine[] | null;
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
  const sorted = useMemo(() => sortBillingNoteLinesForDisplay(lines), [lines]);
  const useCommercial = (commercialLines?.length ?? 0) > 0;
  const rows: Array<{ key: string; desc: string; q: number; up: number; am: number }> = useMemo(() => {
    if (useCommercial) {
      return (commercialLines ?? []).map((line, idx) => {
        const sub = line.workerName ? ` (${line.workerName})` : '';
        return {
          key: line.id || `c-${idx}`,
          desc: (line.description || '—') + sub,
          q: Number(line.quantity),
          up: Number(line.unitPrice),
          am: Number(line.amount ?? line.quantity * line.unitPrice),
        };
      });
    }
    return sorted.map((line) => ({
      key: line.id,
      desc: line.description || '—',
      q: Number(line.quantity),
      up: Number(line.unitPrice),
      am: Number(line.amount),
    }));
  }, [useCommercial, commercialLines, sorted]);

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
            rows.map((row, idx) => (
              <TableRow key={row.key}>
                <TableCell className="text-center tabular-nums text-muted-foreground">{idx + 1}</TableCell>
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
