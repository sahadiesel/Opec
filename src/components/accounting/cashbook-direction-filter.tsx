'use client';

import { useCallback, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type CashbookDirectionFilterValue = 'IN' | 'OUT' | 'BOTH';

const OPTIONS: { value: CashbookDirectionFilterValue; label: string }[] = [
  { value: 'BOTH', label: 'รับ/จ่าย' },
  { value: 'IN', label: 'รายรับ' },
  { value: 'OUT', label: 'รายจ่าย' },
];

export function useCashbookDirectionFilter(defaultValue: CashbookDirectionFilterValue = 'BOTH') {
  const [value, setValueState] = useState<CashbookDirectionFilterValue>(defaultValue);

  const setValue = useCallback((next: CashbookDirectionFilterValue) => {
    setValueState(next);
  }, []);

  return [value, setValue] as const;
}

export function matchesCashbookDirectionFilter(
  direction: 'IN' | 'OUT',
  filter: CashbookDirectionFilterValue,
): boolean {
  if (filter === 'BOTH') return true;
  return direction === filter;
}

export function cashbookDirectionFilterLabel(filter: CashbookDirectionFilterValue): string {
  if (filter === 'IN') return 'รายรับ';
  if (filter === 'OUT') return 'รายจ่าย';
  return 'รับ/จ่าย';
}

export function CashbookDirectionFilter({
  value,
  onChange,
  className,
  size = 'md',
}: {
  value: CashbookDirectionFilterValue;
  onChange: (value: CashbookDirectionFilterValue) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const triggerH = size === 'sm' ? 'h-9' : 'h-11';

  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as CashbookDirectionFilterValue)}
    >
      <SelectTrigger
        className={cn(triggerH, 'w-[9.5rem] shrink-0 font-semibold', className)}
        aria-label="กรองทิศทางเงิน"
      >
        <SelectValue placeholder="รับ/จ่าย" />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
