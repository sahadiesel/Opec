'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, ChevronDown } from 'lucide-react';
import type { StoreItem } from '@/lib/types';
import { formatStoreItemLabel } from '@/lib/types';
import {
  storeCatalogHeaders,
  storeCatalogStandalone,
  variantLinesForParent,
} from '@/lib/store/receive-stock-select';
import { cn } from '@/lib/utils';

function itemSearchHaystack(item: StoreItem): string {
  return [
    item.itemCode,
    item.itemName,
    item.variantSpecification,
    formatStoreItemLabel(item),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function StoreStockSearchSelect({
  items,
  value,
  onPick,
  variantParentId,
  placeholder = 'พิมพ์ค้นหาแล้วเลือกสินค้า…',
  disabled,
  className,
}: {
  items: StoreItem[];
  value?: string;
  onPick: (storeItemId: string) => void;
  /** จำกัดรายการเป็นรุ่นย่อยของเมนูหลัก */
  variantParentId?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const selected = useMemo(() => items.find((i) => i.id === value), [items, value]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();

    if (variantParentId) {
      const variants = variantLinesForParent(variantParentId, items);
      const list = variants.map((v) => ({
        kind: 'variant' as const,
        id: v.id,
        label: `↳ ${formatStoreItemLabel(v)} (${v.itemCode})`,
        haystack: itemSearchHaystack(v),
      }));
      if (!qq) return list;
      return list.filter((e) => e.haystack.includes(qq));
    }

    type Entry =
      | { kind: 'standalone'; id: string; label: string; haystack: string }
      | { kind: 'header'; id: string; label: string; haystack: string }
      | { kind: 'variant'; id: string; label: string; haystack: string; groupLabel: string };

    const entries: Entry[] = [];

    for (const i of storeCatalogStandalone(items)) {
      entries.push({
        kind: 'standalone',
        id: i.id,
        label: `${i.itemCode} | ${formatStoreItemLabel(i)}`,
        haystack: itemSearchHaystack(i),
      });
    }

    for (const h of storeCatalogHeaders(items)) {
      const variants = variantLinesForParent(h.id, items);
      if (variants.length === 0) continue;
      entries.push({
        kind: 'header',
        id: h.id,
        label: `${h.itemCode} | ${h.itemName} (เลือกรุ่นย่อย)`,
        haystack: itemSearchHaystack(h),
      });
      for (const v of variants) {
        entries.push({
          kind: 'variant',
          id: v.id,
          label: `↳ ${formatStoreItemLabel(v)} (${v.itemCode})`,
          haystack: itemSearchHaystack(v),
          groupLabel: h.itemName,
        });
      }
    }

    if (!qq) return entries;
    return entries.filter((e) => e.haystack.includes(qq));
  }, [items, q, variantParentId]);

  const displayLabel = selected
    ? `${selected.itemCode} | ${formatStoreItemLabel(selected)}`
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('h-9 w-full justify-between font-normal text-sm', className)}
        >
          <span className={cn('truncate text-left', !selected && 'text-muted-foreground')}>{displayLabel}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,var(--radix-popover-trigger-width))] p-2" align="start">
        <Input
          placeholder="ค้นหารหัส / ชื่อสินค้า…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-9 mb-2"
          autoFocus
        />
        <div className="max-h-64 overflow-y-auto rounded-md border border-border/60">
          {filtered.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">ไม่พบสินค้า</p>
          ) : (
            filtered.map((entry) => (
              <button
                key={`${entry.kind}-${entry.id}`}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/80',
                  value === entry.id && 'bg-muted',
                  entry.kind === 'header' && 'text-muted-foreground italic',
                )}
                onClick={() => {
                  onPick(entry.id);
                  setOpen(false);
                  setQ('');
                }}
              >
                {value === entry.id ? (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <span className="min-w-0 truncate">{entry.label}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
