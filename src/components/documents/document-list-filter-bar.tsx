'use client';

import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { YearMonthScopeSelects } from '@/components/accounting/year-month-scope-selects';
import { cn } from '@/lib/utils';

type DocumentListFilterBarProps = {
  idPrefix: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchAriaLabel?: string;
  yearCe: number;
  monthScope: string;
  yearOptionsCe: number[];
  onYearCeChange: (yearCe: number) => void;
  onMonthScopeChange: (monthScope: string) => void;
  /** เช่น Select สถานะ / คู่ค้า */
  extraFilters?: ReactNode;
  /** ปุ่มขวา เช่น สร้าง / พิมพ์ */
  actions?: ReactNode;
  className?: string;
  searchClassName?: string;
};

/**
 * มาตรฐานแถบค้นหา+กรองเอกสาร (ตามหน้าใบเสนอราคา):
 * ค้นหา → ปี พ.ศ. → เดือน → (ตัวกรองเพิ่ม) · ปุ่มขวา
 */
export function DocumentListFilterBar({
  idPrefix,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  yearCe,
  monthScope,
  yearOptionsCe,
  onYearCeChange,
  onMonthScopeChange,
  extraFilters,
  actions,
  className,
  searchClassName,
}: DocumentListFilterBarProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-sm md:flex-row md:items-center md:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
        <div className={cn('relative w-full max-w-sm', searchClassName)}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-11 pl-9"
            aria-label={searchAriaLabel || searchPlaceholder}
          />
        </div>
        <YearMonthScopeSelects
          idPrefix={idPrefix}
          yearCe={yearCe}
          monthScope={monthScope}
          yearOptionsCe={yearOptionsCe}
          onYearCeChange={onYearCeChange}
          onMonthScopeChange={onMonthScopeChange}
          yearTriggerClassName="h-11 w-[7.5rem]"
          monthTriggerClassName="h-11 w-[9.5rem]"
        />
        {extraFilters}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
