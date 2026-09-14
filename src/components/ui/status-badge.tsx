import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type StatusBadgeTone =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'warning'
  | 'info';

export type StatusBadgeSpec = {
  label: string;
  tone?: StatusBadgeTone;
  className?: string;
  title?: string;
};

/** Maps app status tones onto Badge variants + the classNames used across list pages. */
const TONE_CLASS: Record<
  StatusBadgeTone,
  { variant: React.ComponentProps<typeof Badge>['variant']; className?: string }
> = {
  default: { variant: 'default' },
  secondary: { variant: 'secondary' },
  destructive: { variant: 'destructive' },
  outline: { variant: 'outline' },
  /** Solid green — PAID / ACTIVE / ISSUED / ACCEPTED */
  success: { variant: 'default', className: 'border-transparent bg-green-600 hover:bg-green-600 text-white' },
  /** Soft amber outline — pending / partial / review */
  warning: {
    variant: 'outline',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  /** Soft blue outline — sent / calculated / open */
  info: {
    variant: 'outline',
    className: 'border-blue-200 bg-blue-50 text-blue-700',
  },
};

export function StatusBadge({ label, tone = 'outline', className, title }: StatusBadgeSpec): React.JSX.Element {
  const mapped = TONE_CLASS[tone];
  return (
    <Badge variant={mapped.variant} className={cn(mapped.className, className)} title={title}>
      {label}
    </Badge>
  );
}
