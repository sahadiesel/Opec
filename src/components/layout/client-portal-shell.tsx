'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { User } from '@/lib/types';
import { useAuth } from '@/firebase';
import { signOut } from 'firebase/auth';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import type { PortalDictKey } from '@/lib/i18n/client-portal-dictionary';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/** เมนูหลักเรียบง่าย — ไม่รวม Billing (ลิงก์จากหน้าแรก) */
const NAV_PATHS: { href: string; key: PortalDictKey }[] = [
  { href: '/client-portal/dashboard', key: 'home' },
  { href: '/client-portal/contracts', key: 'contracts' },
  { href: '/client-portal/quotations', key: 'quotations' },
  { href: '/client-portal/workers', key: 'workers' },
  { href: '/client-portal/timesheets', key: 'timesheets' },
  { href: '/client-portal/accounting', key: 'accounting' },
];

export function ClientPortalShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: User | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const { locale, setLocale, t } = usePortalLocale();

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error(e);
    }
    router.push('/');
  };

  const roleLabel =
    user?.portalRole === 'approver' ? t('approver') : user?.portalRole === 'viewer' ? t('viewer') : '';

  const NavLinks = ({ mobile = false }: { mobile?: boolean }) => (
    <nav
      className={cn(
        'flex gap-0.5',
        mobile ? 'flex-col' : 'flex-wrap items-center justify-center'
      )}
    >
      {NAV_PATHS.map(({ href, key }) => {
        const active =
          pathname === href ||
          pathname.startsWith(`${href}/`) ||
          (href === '/client-portal/accounting' &&
            (pathname.startsWith('/client-portal/draft-invoices') ||
              pathname.startsWith('/client-portal/commercial-invoices') ||
              pathname.startsWith('/client-portal/invoices-receipts') ||
              pathname.startsWith('/client-portal/billing')));
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'rounded-lg px-2.5 py-2 text-xs sm:text-sm font-medium transition-colors',
              mobile ? 'w-full' : '',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );

  const LangLogout = ({ compact = false }: { compact?: boolean }) => (
    <div className={cn('flex shrink-0 items-center gap-1', compact ? '' : 'gap-1.5')}>
      <span className="hidden text-[11px] text-zinc-500 sm:inline">{t('language')}:</span>
      <Button
        variant={locale === 'en' ? 'default' : 'outline'}
        size="sm"
        className="h-8 px-2 text-xs"
        onClick={() => setLocale('en')}
      >
        {compact ? 'EN' : t('english')}
      </Button>
      <Button
        variant={locale === 'th' ? 'default' : 'outline'}
        size="sm"
        className="h-8 px-2 text-xs"
        onClick={() => setLocale('th')}
      >
        {compact ? 'TH' : t('thai')}
      </Button>
      <Button variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => void handleLogout()}>
        <LogOut className="h-3.5 w-3.5 sm:mr-0" />
        <span className="hidden sm:inline">{t('signOut')}</span>
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="border-b border-zinc-200/90 bg-zinc-100/95 dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex w-full max-w-[min(100%,96rem)] items-center justify-end gap-2 px-4 py-2 sm:px-6 lg:px-8">
          <LangLogout />
        </div>
      </div>
      <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/90 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="mx-auto flex w-full max-w-[min(100%,96rem)] flex-col gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-400">OPEC</p>
              <h1 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">{t('portalTitle')}</h1>
              {user && (
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {user.displayName}
                  {roleLabel ? ` · ${roleLabel}` : ''}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center sm:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Menu">
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[min(100vw-2rem,320px)]">
                  <div className="mt-6 space-y-4">
                    <NavLinks mobile />
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>

          <div className="hidden sm:block">
            <NavLinks />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[min(100%,96rem)] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
