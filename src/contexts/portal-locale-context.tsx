'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  PORTAL_STORAGE_KEY,
  type PortalLocale,
  type PortalDictKey,
  portalNavLabel,
} from '@/lib/i18n/client-portal-dictionary';

type Ctx = {
  locale: PortalLocale;
  setLocale: (l: PortalLocale) => void;
  t: (key: PortalDictKey) => string;
};

const PortalLocaleContext = createContext<Ctx | null>(null);

function readStoredLocale(): PortalLocale {
  if (typeof window === 'undefined') return 'en';
  try {
    const v = localStorage.getItem(PORTAL_STORAGE_KEY);
    if (v === 'th' || v === 'en') return v;
  } catch {
    /* ignore */
  }
  return 'en';
}

export function PortalLocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<PortalLocale>('en');

  useEffect(() => {
    setLocaleState(readStoredLocale());
  }, []);

  const setLocale = useCallback((l: PortalLocale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(PORTAL_STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      locale,
      setLocale,
      t: (key) => portalNavLabel(locale, key),
    }),
    [locale, setLocale]
  );

  return <PortalLocaleContext.Provider value={value}>{children}</PortalLocaleContext.Provider>;
}

export function usePortalLocale(): Ctx {
  const ctx = useContext(PortalLocaleContext);
  if (!ctx) throw new Error('usePortalLocale must be used within PortalLocaleProvider');
  return ctx;
}
