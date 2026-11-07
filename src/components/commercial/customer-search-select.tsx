'use client';

import { useMemo, useState } from 'react';
import { ChevronsUpDown, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Customer } from '@/lib/types';
import { cn } from '@/lib/utils';

export function CustomerSearchSelect({
  customers,
  value,
  onChange,
  disabled,
  placeholder = 'เลือกบริษัทลูกค้า...',
}: {
  customers: Customer[] | null | undefined;
  value?: string;
  onChange: (customerId: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = customers?.find((c) => c.id === value);

  const filtered = useMemo(() => {
    const list = [...(customers || [])].sort((a, b) => a.name.localeCompare(b.name, 'th'));
    const term = query.trim().toLowerCase();
    if (!term) return list;
    return list.filter((c) => {
      const name = (c.name || '').toLowerCase();
      const code = (c.customerCode || '').toLowerCase();
      const taxId = (c.taxId || '').replace(/\s/g, '');
      return name.includes(term) || code.includes(term) || taxId.includes(term.replace(/\s/g, ''));
    });
  }, [customers, query]);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        className="h-11 w-full justify-between px-3 font-normal"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={cn('truncate text-left', !selected && 'text-muted-foreground')}>
          {selected?.name || placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </Button>
      {open && !disabled ? (
        <div className="rounded-md border bg-popover shadow-sm">
          <div className="relative border-b p-2">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="พิมพ์ชื่อ รหัสลูกค้า หรือเลขประจำตัวผู้เสียภาษี"
              className="h-9 pl-8"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {customers == null ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">กำลังโหลดลูกค้า...</p>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">ไม่พบลูกค้าที่ตรงกับคำค้น</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={cn(
                    'flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent',
                    c.id === value && 'bg-accent',
                  )}
                  onClick={() => {
                    onChange(c.id);
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {[c.customerCode, c.taxId].filter(Boolean).join(' · ') || '—'}
                    {c.isActive === false ? ' · ไม่ใช้งาน' : ''}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
