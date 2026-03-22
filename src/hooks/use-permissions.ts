'use client';

import { useMemo } from 'react';
import { User } from '@/lib/types';
import { ModuleKey, getPermissions } from '@/lib/permissions';
import { usePermissionProfiles } from '@/hooks/use-permission-profiles';

/**
 * Reactive permissions using exactly one effective permission profile.
 * No multi-profile aggregation.
 */
export function usePermissions(user: User | null) {
  const { profile, isLoading, error } = usePermissionProfiles(user);

  return useMemo(
    () => ({
      isLoading,
      error,
      profile,
      can: (moduleKey: ModuleKey) => getPermissions(user, moduleKey, profile),
      check: (
        moduleKey: ModuleKey,
        action: 'view' | 'create' | 'edit' | 'delete' | 'approve'
      ) => {
        const permissions = getPermissions(user, moduleKey, profile);
        return permissions[action] || false;
      },
    }),
    [user, profile, isLoading, error]
  );
}
