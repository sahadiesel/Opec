'use client';

import { useMemo } from 'react';
import type { BillingNoteLine } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function TaxInvoiceLinesTable({
  lines,
  numberLocale,
  columnHeaders,
  emptyLabel,
  currency,
}: {
  lines: BillingNoteLine[] | null | undefined;
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
  const sorted = useMemo(
    () => [...(lines || [])].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    [lines],
  );

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
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-6">
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((line, idx) => {
              const sub = line.workerName ? ` (${line.workerName})` : '';
              return (
                <TableRow key={line.id}>
                  <TableCell className="text-center tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell>
                    {line.description || '—'}
                    {sub}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(line.quantity).toLocaleString(numberLocale)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {currency}{' '}
                    {Number(line.unitPrice).toLocaleString(numberLocale, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {currency}{' '}
                    {Number(line.amount).toLocaleString(numberLocale, { minimumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
