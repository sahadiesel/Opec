'use client';

import { useMemo } from 'react';
import { User } from '@/lib/types';
import {
  ModuleKey,
  getPermissions,
  canPayrollPermission,
  type PayrollMatrixResource,
  type PayrollMatrixAction,
} from '@/lib/permissions';
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
      /** Role × Resource × Action (payroll / timesheet / policy) — ใช้ซ่อนปุ่มและคู่กับ assert ใน service */
      payroll: (resource: PayrollMatrixResource, action: PayrollMatrixAction) =>
        canPayrollPermission(user, resource, action, profile),
    }),
    [user, profile, isLoading, error]
  );
}
