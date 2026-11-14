'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { COMPANY } from './content';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/services', label: 'Service' },
  { href: '/products', label: 'Products' },
  { href: '/contact', label: 'Contact Us' },
];

function isCurrent(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function CompanySiteNav() {
  const pathname = usePathname();
  const onLogin = pathname === '/ops' || pathname.startsWith('/ops/');
  const [hoverHref, setHoverHref] = useState<string | null>(null);
  const currentHref = LINKS.find((link) => isCurrent(pathname, link.href))?.href ?? null;
  const highlighted = hoverHref ?? currentHref;

  return (
    <header
      className="sticky top-0 z-50 bg-[#f4f7f8] shadow-[0_6px_14px_rgba(15,23,42,0.08)]"
      style={{
        backgroundImage: 'url(/company/nav-pattern-bar.png)',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        backgroundSize: '100% 100%',
      }}
    >
      <div className="flex h-[108px] w-full items-center gap-4 overflow-x-auto px-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="OPEC home">
          <img src="/company/nav-compass.png" alt="" className="h-[76px] w-auto" />
          <span className="h-12 w-[3px] shrink-0 rounded-full bg-gradient-to-b from-[#10233f] to-[#e36f1e]" />
          <span className="flex flex-col justify-center leading-none">
            <span className="text-[40px] font-black tracking-tight text-[#10233f]">
              OPEC<span className="text-[#e36f1e]">.</span>
            </span>
            <span className="mt-1.5 whitespace-nowrap text-[17px] font-semibold tracking-[0.06em] text-[#5a6b80]">
              OFFSHORE POWER ENGINEERING CORPORATION CO., LTD.
            </span>
          </span>
        </Link>

        <nav
          className="ml-auto flex h-full shrink-0 items-center gap-1 sm:gap-2"
          aria-label="Primary"
          onMouseLeave={() => setHoverHref(null)}
        >
          {LINKS.map((link) => {
            const active = highlighted === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="relative flex h-full items-center whitespace-nowrap px-1 sm:px-2"
                aria-current={currentHref === link.href ? 'page' : undefined}
                onMouseEnter={() => setHoverHref(link.href)}
              >
                <span
                  className={
                    active
                      ? 'rounded-full bg-[#f6e0cc] px-4 py-2 text-sm font-bold text-[#e36f1e] sm:px-5'
                      : 'px-2 py-2 text-sm font-semibold text-[#172033] hover:text-[#e36f1e]'
                  }
                >
                  {link.label}
                </span>
                {active ? (
                  <span className="absolute bottom-2 left-3 right-3 h-[3px] rounded-full bg-[#e36f1e]" />
                ) : null}
              </Link>
            );
          })}
          <Link
            href="/ops"
            className="ml-2 inline-flex items-center gap-2 whitespace-nowrap rounded-xl border-2 border-[#d4893a] bg-[#10233f] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#1a3358]"
            aria-current={onLogin ? 'page' : undefined}
          >
            <ArrowRight className="h-4 w-4" />
            Log In
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function CompanySiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#f4f7fb] text-[#102033]">
      <CompanySiteNav />

      <main>{children}</main>

      <footer className="bg-[#071426] text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-3">
          <div>
            <img src="/company/logo.png" alt="" className="mb-4 h-16 w-16 object-contain" />
            <p className="text-sm font-semibold">{COMPANY.legalName}</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">{COMPANY.tagline}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#e36f1e]">Visit</p>
            <p className="mt-3 text-sm leading-relaxed text-white/80">
              {COMPANY.address.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#e36f1e]">Contact</p>
            <div className="mt-3 space-y-1 text-sm text-white/80">
              {COMPANY.phones.map((phone) => (
                <a key={phone} className="block hover:text-white" href={`tel:${phone.replace(/\s/g, '')}`}>
                  {phone}
                </a>
              ))}
              <a className="block hover:text-white" href={`mailto:${COMPANY.email}`}>
                {COMPANY.email}
              </a>
            </div>
          </div>
        </div>
        <div className="border-t border-white/10 px-4 py-4 text-center text-xs text-white/50">
          {COMPANY.shortName} Company Profile 2026 · Songkhla, Thailand
        </div>
      </footer>
    </div>
  );
}
