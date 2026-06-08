'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SearchableSelectOption = {
  id: string;
  label: string;
  searchText?: string;
};

export function SearchableSelect({
  options,
  value,
  onChange,
  disabled,
  label,
  labelClassName,
  placeholder = 'เลือกรายการ…',
  searchPlaceholder = 'ค้นหา…',
  emptyMessage = 'ไม่พบรายการ',
  triggerClassName = 'h-10',
}: {
  options: SearchableSelectOption[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  disabled?: boolean;
  label?: string;
  labelClassName?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const selected = useMemo(() => options.find((o) => o.id === value), [options, value]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const sorted = [...options].sort((a, b) =>
      a.label.localeCompare(b.label, 'th', { sensitivity: 'base' }),
    );
    if (!qq) return sorted;
    return sorted.filter((o) => {
      const hay = (o.searchText || o.label).toLowerCase();
      return hay.includes(qq);
    });
  }, [options, q]);

  return (
    <div className="space-y-2">
      {label ? <Label className={labelClassName}>{label}</Label> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn('w-full justify-between font-normal', triggerClassName)}
          >
            <span className={cn('truncate text-left', !selected && 'text-muted-foreground')}>
              {selected?.label ?? placeholder}
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
          <Input
            placeholder={searchPlaceholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 mb-2"
          />
          <div className="max-h-56 overflow-y-auto rounded-md border border-border/60">
            {filtered.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">{emptyMessage}</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/80',
                    value === o.id && 'bg-muted',
                  )}
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  {value === o.id ? (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <span className="min-w-0 truncate">{o.label}</span>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
