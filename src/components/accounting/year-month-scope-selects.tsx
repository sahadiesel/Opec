'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MONTH_SCOPE_SELECT_OPTIONS,
  isMonthScopeLookback,
  yearCeToBe,
} from '@/lib/date/year-month-scope-filter';

type YearMonthScopeSelectsProps = {
  idPrefix: string;
  yearCe: number;
  monthScope: string;
  yearOptionsCe: number[];
  onYearCeChange: (yearCe: number) => void;
  onMonthScopeChange: (monthScope: string) => void;
};

/** ช่องเลือกปี (พ.ศ.) + เดือน — ค่าเริ่มต้นใช้ปี/เดือนปัจจุบันจาก parent */
export function YearMonthScopeSelects({
  idPrefix,
  yearCe,
  monthScope,
  yearOptionsCe,
  onYearCeChange,
  onMonthScopeChange,
}: YearMonthScopeSelectsProps) {
  const lookback = isMonthScopeLookback(monthScope);
  const years = yearOptionsCe.includes(yearCe)
    ? yearOptionsCe
    : [yearCe, ...yearOptionsCe].sort((a, b) => b - a);

  return (
    <>
      <Select
        value={String(yearCe)}
        onValueChange={(v) => onYearCeChange(Number(v))}
        disabled={lookback}
      >
        <SelectTrigger
          id={`${idPrefix}-year`}
          className="h-10 w-[min(100%,8.5rem)] shrink-0 bg-background"
          aria-label="เลือกปี"
        >
          <SelectValue placeholder="เลือกปี" />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              พ.ศ. {yearCeToBe(y)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={monthScope} onValueChange={onMonthScopeChange}>
        <SelectTrigger
          id={`${idPrefix}-month`}
          className="h-10 w-[min(100%,11rem)] shrink-0 bg-background"
          aria-label="เลือกเดือน"
        >
          <SelectValue placeholder="เลือกเดือน" />
        </SelectTrigger>
        <SelectContent>
          {MONTH_SCOPE_SELECT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
