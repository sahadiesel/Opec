'use client';

import { SSO_NAME_TITLES, type SsoNameTitle } from '@/lib/payroll/sso-filing-name';
import { cn } from '@/lib/utils';

export const EN_NAME_TITLES = ['Mr.', 'Mrs.', 'Ms.', 'Miss'] as const;
export type EnNameTitle = (typeof EN_NAME_TITLES)[number];

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export function NameTitleSelect({
  value,
  onChange,
  disabled,
  className,
  id,
}: {
  value: string;
  onChange: (next: SsoNameTitle | '') => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <select
      id={id}
      disabled={disabled}
      value={value || ''}
      onChange={(e) => onChange((e.target.value || '') as SsoNameTitle | '')}
      className={cn(selectClass, className)}
    >
      <option value="">เลือกคำนำหน้า</option>
      {SSO_NAME_TITLES.map((title) => (
        <option key={title} value={title}>
          {title}
        </option>
      ))}
    </select>
  );
}

export function NameTitleEnSelect({
  value,
  onChange,
  disabled,
  className,
  id,
}: {
  value: string;
  onChange: (next: EnNameTitle | '') => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <select
      id={id}
      disabled={disabled}
      value={value || ''}
      onChange={(e) => onChange((e.target.value || '') as EnNameTitle | '')}
      className={cn(selectClass, className)}
    >
      <option value="">Select title</option>
      {EN_NAME_TITLES.map((title) => (
        <option key={title} value={title}>
          {title}
        </option>
      ))}
    </select>
  );
}
