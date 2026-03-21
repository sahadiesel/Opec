
'use client';

import { useMemo } from 'react';
import { User, PermissionProfile } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { ModuleKey, getPermissions } from '@/lib/permissions';

/**
 * Hook to access reactive permissions for a user.
 * Supports aggregation across multiple assigned profiles.
 */
export function usePermissions(user: User | null) {
  const firestore = useFirestore();

  const profileKeys = useMemo(() => {
    if (!user) return [];
    const keys = user.permissionProfileKeys || [];
    if (user.permissionProfileKey && !keys.includes(user.permissionProfileKey)) {
      return [...keys, user.permissionProfileKey];
    }
    return keys;
  }, [user]);

  const profilesQuery = useMemoFirebase(() => {
    if (!firestore || profileKeys.length === 0) return null;
    return query(collection(firestore, 'permission_profiles'), where('profileKey', 'in', profileKeys));
  }, [firestore, profileKeys]);

  const { data: profiles, isLoading } = useCollection<PermissionProfile>(profilesQuery as any);

  return useMemo(() => ({
    isLoading,
    profiles,
    can: (moduleKey: ModuleKey) => getPermissions(user, moduleKey, profiles),
    check: (moduleKey: ModuleKey, action: 'view' | 'create' | 'edit' | 'delete' | 'approve') => {
      const p = getPermissions(user, moduleKey, profiles);
      return p[action] || false;
    }
  }), [user, profiles, isLoading]);
}
