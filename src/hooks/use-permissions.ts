
'use client';

import { useMemo } from 'react';
import { User, PermissionProfile } from '@/lib/types';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { ModuleKey, getPermissions } from '@/lib/permissions';

/**
 * Hook to access reactive permissions for a user
 */
export function usePermissions(user: User | null) {
  const firestore = useFirestore();

  const profileRef = useMemoFirebase(() => {
    if (!firestore || !user?.permissionProfileKey) return null;
    return doc(firestore, 'permission_profiles', user.permissionProfileKey);
  }, [firestore, user?.permissionProfileKey]);

  const { data: profile, isLoading } = useDoc<PermissionProfile>(profileRef as any);

  return useMemo(() => ({
    isLoading,
    profile,
    can: (moduleKey: ModuleKey) => getPermissions(user, moduleKey, profile),
    check: (moduleKey: ModuleKey, action: 'view' | 'create' | 'edit' | 'delete' | 'approve') => {
      const p = getPermissions(user, moduleKey, profile);
      return p[action] || false;
    }
  }), [user, profile, isLoading]);
}
