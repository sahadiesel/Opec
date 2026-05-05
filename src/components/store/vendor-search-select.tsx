'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown, Check } from 'lucide-react';
import type { Vendor } from '@/lib/types';
import { cn } from '@/lib/utils';

export function VendorSearchSelect({
  vendors,
  value,
  onChange,
  disabled,
  label = 'คู่ค้า / ผู้ขาย',
  placeholder = 'พิมพ์ค้นหาแล้วเลือก…',
}: {
  vendors: Vendor[] | undefined;
  value: string | undefined;
  onChange: (vendorId: string | undefined) => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const selected = useMemo(() => vendors?.find((v) => v.id === value), [vendors, value]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const list = (vendors || []).filter((v) => v.status === 'ACTIVE');
    if (!qq) return list.slice(0, 80);
    return list
      .filter(
        (v) =>
          v.vendorName.toLowerCase().includes(qq) ||
          (v.vendorCode || '').toLowerCase().includes(qq)
      )
      .slice(0, 80);
  }, [vendors, q]);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="h-11 w-full justify-between font-normal"
          >
            <span className={cn('truncate', !selected && 'text-muted-foreground')}>
              {selected ? `${selected.vendorName} (${selected.vendorCode})` : placeholder}
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
          <Input
            placeholder="ค้นหาชื่อหรือรหัสคู่ค้า…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 mb-2"
          />
          <div className="max-h-56 overflow-y-auto rounded-md border border-border/60">
            {filtered.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">ไม่พบคู่ค้า</p>
            ) : (
              filtered.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/80',
                    value === v.id && 'bg-muted'
                  )}
                  onClick={() => {
                    onChange(v.id);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  {value === v.id ? <Check className="h-4 w-4 shrink-0 text-primary" /> : <span className="w-4" />}
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{v.vendorName}</span>
                    <span className="text-muted-foreground text-xs ml-1">({v.vendorCode})</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
