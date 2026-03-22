
'use client';

import { useMemo } from 'react';
import { User } from '@/lib/types';
import { ModuleKey, getPermissions } from '@/lib/permissions';
import { usePermissionProfiles } from '@/hooks/use-permission-profiles';

/**
 * Reactive permissions using at most one permission profile (no additive merge).
 */
export function usePermissions(user: User | null) {
  const { profile, profiles, isLoading } = usePermissionProfiles(user);

  return useMemo(
    () => ({
      isLoading,
      profile,
      profiles,
      can: (moduleKey: ModuleKey) => getPermissions(user, moduleKey, profile),
      check: (moduleKey: ModuleKey, action: 'view' | 'create' | 'edit' | 'delete' | 'approve') => {
        const p = getPermissions(user, moduleKey, profile);
        return p[action] || false;
      },
    }),
    [user, profile, profiles, isLoading]
  );
}
