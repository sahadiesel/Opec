'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Paperclip } from 'lucide-react';
import { whtTaxStatusLabel } from '@/lib/payroll/payroll-wht-tax-payment-model';
import type { WhtTaxPaymentProofAttachment } from '@/lib/types';

export function fmtBaht(n: number): string {
  return `฿${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function mergeUniqueProofAttachments(
  fromRows: WhtTaxPaymentProofAttachment[],
  session: WhtTaxPaymentProofAttachment[],
): WhtTaxPaymentProofAttachment[] {
  const map = new Map<string, WhtTaxPaymentProofAttachment>();
  for (const a of fromRows) map.set(a.id, a);
  for (const a of session) map.set(a.id, a);
  return Array.from(map.values()).sort((a, b) => b.uploadedAt - a.uploadedAt);
}

export function ProofAttachmentZone({
  attachments,
  onRemove,
  removableIds,
  label = 'เอกสารแนบการโอน (ภงด.1)',
}: {
  attachments: WhtTaxPaymentProofAttachment[];
  onRemove?: (id: string) => void;
  removableIds?: Set<string>;
  label?: string;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mb-4 rounded-md border border-amber-300/80 bg-amber-50/90 px-3 py-2.5 dark:border-amber-700/60 dark:bg-amber-950/30">
      <p className="text-xs font-semibold text-amber-900 dark:text-amber-100 mb-2">{label}</p>
      <ul className="space-y-1.5">
        {attachments.map((a) => (
          <li key={a.id} className="flex items-center gap-2 min-w-0 text-sm">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-amber-800 dark:text-amber-200" />
            <a
              href={a.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate text-primary hover:underline"
              title={a.fileName}
            >
              {a.fileName}
            </a>
            {onRemove && removableIds?.has(a.id) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={() => onRemove(a.id)}
              >
                ลบ
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function renderWageStatusBadge(label: string, wagePaid: boolean) {
  return (
    <Badge
      variant={wagePaid ? 'default' : 'secondary'}
      className={wagePaid ? 'bg-blue-600 hover:bg-blue-600 text-white border-transparent' : undefined}
    >
      {label}
    </Badge>
  );
}

export function renderTaxStatusBadge(wagePaid: boolean, taxPaid: boolean) {
  const label = whtTaxStatusLabel(wagePaid, taxPaid);
  if (!wagePaid) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (taxPaid) {
    return <Badge className="bg-red-600 hover:bg-red-600 text-white border-transparent">{label}</Badge>;
  }
  return (
    <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50">
      {label}
    </Badge>
  );
}

export const WHT_LIST_TABLE_COLGROUP = (showSelect: boolean) => (
  <colgroup>
    {showSelect ? <col className="w-[44px]" /> : null}
    <col className="w-[13%]" />
    <col className="w-[22%]" />
    <col className="w-[10%]" />
    <col className="w-[11%]" />
    <col className="w-[9%]" />
    <col className="w-[11%]" />
    <col className="w-[9%]" />
    <col className="w-[72px]" />
  </colgroup>
);

export const VENDOR_WHT_LIST_TABLE_COLGROUP = (showSelect: boolean) => (
  <colgroup>
    {showSelect ? <col className="w-[44px]" /> : null}
    <col className="w-[12%]" />
    <col className="w-[20%]" />
    <col className="w-[10%]" />
    <col className="w-[10%]" />
    <col className="w-[9%]" />
    <col className="w-[10%]" />
    <col className="w-[14%]" />
    <col className="w-[72px]" />
  </colgroup>
);
