'use client';

export function AccountingNavAlertDot({ title }: { title: string }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full animate-accounting-nav-alert ring-2 ring-sidebar"
      title={title}
      aria-label={title}
      role="status"
    />
  );
}
