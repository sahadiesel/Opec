/**
 * Audit: menu-permissions matrix (getPermissions) vs sidebar + path access.
 * Run: npx tsx scripts/audit-matrix-vs-runtime.ts
 */
import { getFieldsForBusinessRole } from '../src/lib/auth-mapping';
import { getPermissions, getBaselineProfiles } from '../src/lib/permissions';
import { ACTIVE_BUSINESS_ROLE_KEYS, ROLE_CATALOG } from '../src/lib/roles/role-catalog';
import { MENU_PERMISSION_GROUPS } from '../src/lib/navigation/menu-permission-map';
import { userMayAccessPath } from '../src/lib/navigation/nav-access';
import {
  isPayrollOfficer,
  isOperationsOfficer,
  isStoreOfficer,
  isTimekeeper,
  isClient,
  isSystemAdmin,
} from '../src/lib/permissions';
import { isExecutiveViewer } from '../src/lib/permission-core';
import { isSimpleAccounting, isSimpleAdmin } from '../src/lib/simple-tier-model';
import type { BusinessRoleKey, User } from '../src/lib/types';

function mockUser(roleKey: BusinessRoleKey): User {
  const fields = getFieldsForBusinessRole(roleKey);
  return {
    id: `mock-${roleKey}`,
    email: `${roleKey}@example.com`,
    displayName: ROLE_CATALOG[roleKey].displayNameTh,
    phone: '0000000000',
    approvalStatus: 'ACTIVE',
    isActive: true,
    userType: roleKey === 'client_user' ? 'customer_portal' : 'internal',
    customerId: roleKey === 'client_user' ? 'cust-mock' : undefined,
    portalRole: roleKey === 'client_user' ? 'viewer' : undefined,
    createdAt: 0,
    updatedAt: 0,
    ...fields,
  } as User;
}

/** Replicate navGroupsForUser commercial / role filters (sidebar-nav.tsx) */
function sidebarHidesCommercialGroup(user: User): boolean {
  return isPayrollOfficer(user) || isOperationsOfficer(user) || isStoreOfficer(user);
}

function sidebarUsesMinimalNav(user: User): 'timekeeper' | 'store_officer' | null {
  if (isTimekeeper(user)) return 'timekeeper';
  if (isStoreOfficer(user)) return 'store_officer';
  return null;
}

function canSeeMenuGroup(
  user: User,
  audience: 'internal' | 'admin' | 'accounting' | 'client',
): boolean {
  const fullMenuAccess = isSystemAdmin(user) || isExecutiveViewer(user);
  const clientUser = isClient(user);
  const acct = fullMenuAccess || isSimpleAccounting(user) || isSimpleAdmin(user);
  if (audience === 'admin') return fullMenuAccess;
  if (audience === 'accounting') return acct && !clientUser;
  if (audience === 'client') return clientUser;
  if (audience === 'internal') return !clientUser;
  return false;
}

function permSig(p: ReturnType<typeof getPermissions>): string {
  const f: string[] = [];
  if (p.view) f.push('V');
  if (p.create) f.push('C');
  if (p.edit) f.push('E');
  if (p.delete) f.push('D');
  if (p.approve) f.push('A');
  return f.join('') || '—';
}

function main() {
  const baselineByKey = new Map(
    getBaselineProfiles().map((p) => [p.profileKey!, p]),
  );

  type Mismatch = {
    role: BusinessRoleKey;
    kind: string;
    detail: string;
  };
  const mismatches: Mismatch[] = [];

  for (const roleKey of ACTIVE_BUSINESS_ROLE_KEYS) {
    const user = mockUser(roleKey);
    const minimalNav = sidebarUsesMinimalNav(user);
    const profile = baselineByKey.get(roleKey);

    if (profile?.permissions) {
      for (const [mod, basePerm] of Object.entries(profile.permissions)) {
        const runtime = getPermissions(user, mod, null);
        if (permSig(runtime) !== permSig(basePerm)) {
          mismatches.push({
            role: roleKey,
            kind: 'baseline_profile_vs_getPermissions',
            detail: `${mod}: profile=${permSig(basePerm)} runtime=${permSig(runtime)}`,
          });
        }
      }
    }

    for (const group of MENU_PERMISSION_GROUPS) {
      if (sidebarHidesCommercialGroup(user) && group.label.startsWith('งานขายและสัญญา')) {
        for (const item of group.items) {
          const matrixView = getPermissions(user, item.moduleKey, null).view;
          if (matrixView) {
            mismatches.push({
              role: roleKey,
              kind: 'sidebar_hides_group_but_matrix_allows_view',
              detail: `${group.label} → ${item.label} (${item.moduleKey}) matrix=V`,
            });
          }
        }
        continue;
      }

      if (minimalNav === 'timekeeper' && !group.label.startsWith('ลงเวลา')) {
        for (const item of group.items) {
          const matrixView = getPermissions(user, item.moduleKey, null).view;
          if (matrixView && canSeeMenuGroup(user, group.audience)) {
            mismatches.push({
              role: roleKey,
              kind: 'timekeeper_minimal_nav_but_matrix_allows',
              detail: `${item.label} (${item.moduleKey}) matrix=V แต่ sidebar มีแค่ลงเวลา`,
            });
          }
        }
        continue;
      }

      if (minimalNav === 'store_officer') {
        const storeVisibleModules = new Set([
          'store_inventory',
          'vendors',
          'purchases',
          'overview_dashboard',
          'employee_self_profile',
        ]);
        if (group.hrStructured || group.label.startsWith('งานขายและสัญญา')) {
          for (const item of group.items) {
            const matrixView = getPermissions(user, item.moduleKey, null).view;
            if (matrixView) {
              mismatches.push({
                role: roleKey,
                kind: 'store_officer_nav_subset_but_matrix_allows',
                detail: `${item.label} (${item.moduleKey}) matrix=V แต่ sidebar ซ่อน HR/Commercial`,
              });
            }
          }
          continue;
        }
        if (group.label.startsWith('งานปฏิบัติการ')) {
          for (const item of group.items) {
            if (!storeVisibleModules.has(item.moduleKey)) {
              const matrixView = getPermissions(user, item.moduleKey, null).view;
              if (matrixView) {
                mismatches.push({
                  role: roleKey,
                  kind: 'store_officer_ops_subset_but_matrix_allows',
                  detail: `${item.label} (${item.moduleKey}) matrix=V แต่ sidebar store ไม่แสดง`,
                });
              }
            }
          }
        }
      }

      if (!canSeeMenuGroup(user, group.audience)) continue;

      for (const item of group.items) {
        const matrixView = getPermissions(user, item.moduleKey, null).view;
        const path = item.path ?? '/';
        const pathOk = userMayAccessPath(user, null, path);

        if (matrixView && !pathOk) {
          mismatches.push({
            role: roleKey,
            kind: 'matrix_view_but_path_blocked',
            detail: `${item.label} ${path} (${item.moduleKey})`,
          });
        }
        if (!matrixView && pathOk && group.audience === 'internal') {
          mismatches.push({
            role: roleKey,
            kind: 'path_allowed_but_matrix_no_view',
            detail: `${item.label} ${path} (${item.moduleKey})`,
          });
        }
      }
    }
  }

  const byRole = new Map<BusinessRoleKey, Mismatch[]>();
  for (const m of mismatches) {
    const arr = byRole.get(m.role) ?? [];
    arr.push(m);
    byRole.set(m.role, arr);
  }

  console.log('=== Matrix vs Runtime Audit ===\n');
  console.log(`Roles scanned: ${ACTIVE_BUSINESS_ROLE_KEYS.length}`);
  console.log(`Total mismatches: ${mismatches.length}\n`);

  if (mismatches.length === 0) {
    console.log('No mismatches found.');
    return;
  }

  for (const roleKey of ACTIVE_BUSINESS_ROLE_KEYS) {
    const items = byRole.get(roleKey);
    if (!items?.length) continue;
    console.log(`\n## ${ROLE_CATALOG[roleKey].displayNameTh} (${roleKey}) — ${items.length} รายการ`);
    const byKind = new Map<string, Mismatch[]>();
    for (const m of items) {
      const arr = byKind.get(m.kind) ?? [];
      arr.push(m);
      byKind.set(m.kind, arr);
    }
    for (const [kind, list] of byKind) {
      console.log(`  [${kind}]`);
      for (const m of list.slice(0, 12)) {
        console.log(`    - ${m.detail}`);
      }
      if (list.length > 12) console.log(`    ... +${list.length - 12} more`);
    }
  }
}

main();
