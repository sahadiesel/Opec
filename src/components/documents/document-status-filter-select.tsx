'use client';

import { Filter } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type DocumentStatusFilterOption = {
  value: string;
  label: string;
};

type DocumentStatusFilterSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: DocumentStatusFilterOption[];
  /** ค่า «ทุกสถานะ» — default `all` */
  allValue?: string;
  allLabel?: string;
  className?: string;
  triggerClassName?: string;
  ariaLabel?: string;
};

/** ตัวกรองสถานะมาตรฐาน — ไอคอน Filter + ทุกสถานะ */
export function DocumentStatusFilterSelect({
  value,
  onValueChange,
  options,
  allValue = 'all',
  allLabel = 'ทุกสถานะ',
  className,
  triggerClassName,
  ariaLabel = 'กรองสถานะ',
}: DocumentStatusFilterSelectProps) {
  return (
    <div className={cn('w-[210px]', className)}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className={cn('h-11 gap-2', triggerClassName)} aria-label={ariaLabel}>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 shrink-0" />
            <SelectValue placeholder="ตัวกรองสถานะ" />
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={allValue}>{allLabel}</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
