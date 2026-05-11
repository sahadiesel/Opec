'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAppUser } from '@/hooks/use-app-user';
import { isClient } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import type { User } from '@/lib/types';
import {
  clearPortalAdminCustomerId,
  getPortalAdminCustomerId,
} from '@/lib/client-portal/portal-session-storage';

export type ClientPortalUserContextValue = {
  /** User profile for Firestore queries (client account or admin preview with customerId + portalActingCustomerId). */
  effectiveUser: User | null;
  /** Signed-in Firestore user without portal overlay. */
  rawUser: User | null;
  appUserLoading: boolean;
  /** True when signed-in user may use portal routes (customer or system admin with preview session). */
  canAccessPortal: boolean;
  /** System admin viewing portal via customer picker. */
  isPortalAdminPreview: boolean;
  clearPortalAdminSession: () => void;
};

const ClientPortalUserContext = createContext<ClientPortalUserContextValue | null>(null);

export function ClientPortalUserProvider({ children }: { children: ReactNode }) {
  const { currentUser: rawUser, isLoading: appUserLoading } = useAppUser();
  const [actingCustomerId, setActingCustomerId] = useState<string | null>(() => getPortalAdminCustomerId());

  const clearPortalAdminSession = useCallback(() => {
    clearPortalAdminCustomerId();
    setActingCustomerId(null);
  }, []);

  const effectiveUser = useMemo((): User | null => {
    if (!rawUser) return null;
    const cid = (rawUser.customerId || '').trim();
    if (isClient(rawUser) && cid) return rawUser;

    const previewId = (actingCustomerId || '').trim();
    if (isSystemAdmin(rawUser) && previewId) {
      return {
        ...rawUser,
        customerId: previewId,
        portalRole: 'approver',
        portalActingCustomerId: previewId,
      };
    }
    return null;
  }, [rawUser, actingCustomerId]);

  const isPortalAdminPreview = !!(rawUser && isSystemAdmin(rawUser) && actingCustomerId && !isClient(rawUser));

  const value = useMemo(
    (): ClientPortalUserContextValue => ({
      effectiveUser,
      rawUser,
      appUserLoading,
      canAccessPortal: !!effectiveUser,
      isPortalAdminPreview,
      clearPortalAdminSession,
    }),
    [effectiveUser, rawUser, appUserLoading, isPortalAdminPreview, clearPortalAdminSession],
  );

  return <ClientPortalUserContext.Provider value={value}>{children}</ClientPortalUserContext.Provider>;
}

export function useClientPortalIdentity(): ClientPortalUserContextValue {
  const ctx = useContext(ClientPortalUserContext);
  if (!ctx) {
    throw new Error('useClientPortalIdentity must be used within ClientPortalUserProvider');
  }
  return ctx;
}
