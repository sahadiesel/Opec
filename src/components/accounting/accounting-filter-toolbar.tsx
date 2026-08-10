'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** ความสูงแถวป้ายกำกับ — ให้ปุ่มกับช่องยอดก้นชิดกัน */
const LABEL_ROW = 'h-4 text-xs font-medium leading-4 whitespace-nowrap';

export function AccountingFilterToolbar({
  filters,
  actions,
  className,
}: {
  filters: ReactNode;
  actions: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{filters}</div>
      <div className="flex flex-wrap items-end gap-2 shrink-0 justify-end">{actions}</div>
    </div>
  );
}

/** ปุ่มในแถบกรอง — เว้นที่ป้ายกำกับว่างให้ก้นช่องเท่ากับช่องยอด */
export function AccountingFilterToolbarAction({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className={cn(LABEL_ROW, 'invisible select-none')} aria-hidden>
        &nbsp;
      </span>
      {children}
    </div>
  );
}

export function AccountingFilterToolbarStat({
  label,
  value,
  emphasize,
  className,
}: {
  label: string;
  value: ReactNode;
  emphasize?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-end gap-1', className)}>
      <p className={cn(LABEL_ROW, 'text-muted-foreground')}>{label}</p>
      <div
        className={cn(
          'flex h-10 min-w-[10rem] items-center justify-end rounded-md border bg-background px-3',
          emphasize && 'border-primary/30 bg-primary/5',
        )}
      >
        <p
          className={cn(
            'text-base font-bold tabular-nums tracking-tight',
            emphasize && 'text-primary',
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
