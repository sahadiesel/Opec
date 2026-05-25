/**
 * Generates docs/role-permission-matrix.md from getPermissions() (source of truth).
 * Run: npx tsx scripts/generate-role-permission-matrix.ts
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { getFieldsForBusinessRole } from '../src/lib/auth-mapping';
import { getPermissions, SYSTEM_MODULES } from '../src/lib/permissions';
import { ACTIVE_BUSINESS_ROLE_KEYS, ROLE_CATALOG } from '../src/lib/roles/role-catalog';
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

function permCode(p: ReturnType<typeof getPermissions>): string {
  const flags: string[] = [];
  if (p.view) flags.push('V');
  if (p.create) flags.push('C');
  if (p.edit) flags.push('E');
  if (p.delete) flags.push('D');
  if (p.approve) flags.push('A');
  return flags.length ? flags.join('') : '—';
}

const LEGEND = '| Code | Meaning |\n|------|--------|\n| — | no access |\n| V | view |\n| C | create |\n| E | edit |\n| D | delete |\n| A | approve |\n| VCEDA | full (all five) |\n';

function main() {
  const modules = SYSTEM_MODULES.map((m) => m.key);
  const roles = ACTIVE_BUSINESS_ROLE_KEYS;

  const lines: string[] = [
    '# Role & Permission Matrix',
    '',
    'Generated from `getPermissions()` in `src/lib/permissions.ts`.',
    'Re-run: `npx tsx scripts/generate-role-permission-matrix.ts`',
    '',
    '> **Role** = `users.assignedRoleKey` only (admin assigns one business role).',
    '> **Permission** = derived at runtime; do not store per-module flags on the user doc.',
    '',
    LEGEND,
    '',
    '## Roles (canonical)',
    '',
    '| assignedRoleKey | ชื่อไทย | accessGroup | accessLevel |',
    '|-----------------|--------|-------------|-------------|',
  ];

  for (const rk of roles) {
    const e = ROLE_CATALOG[rk];
    lines.push(`| \`${rk}\` | ${e.displayNameTh} | ${e.accessGroup} | ${e.accessLevel} |`);
  }

  lines.push('', '## Module permissions by role', '', '| Module | ' + roles.map((r) => `\`${r}\``).join(' | ') + ' |');
  lines.push('|--------|' + roles.map(() => '---').join('|') + '|');

  for (const mod of modules) {
    const cells = roles.map((rk) => {
      const u = mockUser(rk);
      return permCode(getPermissions(u, mod, null));
    });
    const label = SYSTEM_MODULES.find((m) => m.key === mod)?.label ?? mod;
    lines.push(`| \`${mod}\` — ${label.split('(')[0].trim()} | ${cells.join(' | ')} |`);
  }

  lines.push(
    '',
    '## Firestore capabilities (target model)',
    '',
    'Rules should map collections to these predicates — not duplicate UI module names.',
    '',
    '| Capability | Roles / condition |',
    '|------------|-------------------|',
    '| `isSystemAdmin` | `system_admin` |',
    '| `isAccounting` | `accounting_manager`, `accounting_officer` |',
    '| `isInternalStaff` | any internal `userType`, ACTIVE or staff-doc read paths |',
    '| `isPettyCashSite` | `operations_manager` (+ ops manager partition) |',
    '| `canBankCashbook` | accounting + petty site + payroll readers where needed |',
    '| `isClientPortal` | `client_user` scoped by `customerId` |',
    '| `isPayrollPrivileged` | `payroll_officer`, `hr_manager`, `operations_manager` |',
    '',
    '## Legacy fields (do not use on new writes)',
    '',
    'Remove on save via `buildUserAuthFirestoreUpdate`: `permissionProfileKey`, `permissionProfileKeys`,',
    '`roleId`, `roleIds`, `assignedRoleKeys`, `role`, `department`, `level`, `departmentGroup`.',
    '',
  );

  const out = resolve(process.cwd(), 'docs/role-permission-matrix.md');
  writeFileSync(out, lines.join('\n'), 'utf8');
  console.log(`Wrote ${out}`);
}

main();
