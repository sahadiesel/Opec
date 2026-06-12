'use client';

import * as React from 'react';
import { useAppUser } from '@/hooks/use-app-user';
import { isExecutiveViewer } from '@/lib/permission-core';
import { canAccess, type ModuleKey } from '@/lib/permissions';
import type { PermissionProfile } from '@/lib/types';

type MutationAction = 'create' | 'edit' | 'delete' | 'approve';

type MutationAccessContextValue = {
  /** Executive view-only role — no create/edit/delete/approve in UI. */
  isReadOnlyExecutive: boolean;
  canPerformMutations: boolean;
  /** Module-scoped mutation check (respects permission matrix + executive block). */
  canMutate: (moduleKey: ModuleKey | string, action?: MutationAction, profile?: PermissionProfile | null) => boolean;
};

const MutationAccessContext = React.createContext<MutationAccessContextValue>({
  isReadOnlyExecutive: false,
  canPerformMutations: true,
  canMutate: () => true,
});

export function MutationAccessProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAppUser();

  const value = React.useMemo((): MutationAccessContextValue => {
    const isReadOnlyExecutive = isExecutiveViewer(currentUser);
    const canPerformMutations = !isReadOnlyExecutive;
    return {
      isReadOnlyExecutive,
      canPerformMutations,
      canMutate: (moduleKey, action = 'edit', profile = null) => {
        if (isReadOnlyExecutive) return false;
        return canAccess(currentUser, moduleKey, action);
      },
    };
  }, [currentUser]);

  return <MutationAccessContext.Provider value={value}>{children}</MutationAccessContext.Provider>;
}

export function useMutationAccess() {
  return React.useContext(MutationAccessContext);
}
