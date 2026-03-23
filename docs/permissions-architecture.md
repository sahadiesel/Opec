# Permissions Architecture

## Source of Truth

| Layer | Location | Purpose |
|-------|----------|---------|
| **Permission Core** | `src/lib/permission-core.ts` | Access groups, domains, `getEffectiveAccessGroup`, `canAccessDomain`, `isOperationGroupMember`, `isAccountingGroupMember` |
| **Permissions** | `src/lib/permissions.ts` | Module-level `canView`/`canCreate`/`canEdit`, `getPermissions`, `is*Staff` helpers, baseline profiles |
| **Auth Mapping** | `src/lib/auth-mapping.ts` | Role→fields mapping, `getFieldsForBusinessRole`, setup-admin repair |
| **Migration** | `src/lib/migration/user-auth-migration.ts` | User auth backfill, baseline profile creation |

## Primary User Authorization Fields

| Field | Purpose |
|-------|---------|
| `accessGroup` | `admin` \| `operation` \| `accounting` \| `client` — primary partition |
| `departmentGroup` | Same as `accessGroup` (alias) |
| `accessLevel` | `admin` \| `manager` \| `officer` \| `viewer` |
| `permissionProfileKey` | Links to `permission_profiles` document |
| `assignedRoleKey` | Canonical role (e.g. `operation_officer`, `accounting_manager`) |
| `roleIds` | Compatibility; used by Firestore rules fallback |

## Legacy Compatibility (Kept for Rollback / Repair)

- `department`, `level` — legacy dept/level; permission-core uses for fallback when `accessGroup` missing
- `roleId`, `roleIds` — Firestore rules `legacyResolvedGroup()` reads these
- `assignedRoleKeys` (array) — transitional; runtime prefers `assignedRoleKey`

Do not delete these until Firestore rules and all consumers are verified to use the new fields.

## Baseline Profiles (New Model)

| Profile Key | Group | Description |
|-------------|-------|-------------|
| `admin_admin` | admin | System Administrator |
| `operation_officer` | operation | Sales/HR/Ops/Store (รวม) |
| `operation_manager` | operation | Sales/HR/Ops/Store (รวม) |
| `accounting_officer` | accounting | Finance/Accounting |
| `accounting_manager` | accounting | Finance/Accounting |
| `client_user` | client | Customer Portal read-only |

Legacy profiles (`hr_manager`, `sales_officer`, `store_officer`, etc.) remain for backward compatibility.

## Central Helpers (Prefer These)

```ts
// Access group / domain
getEffectiveAccessGroup(user)  // 'admin' | 'operation' | 'accounting' | 'client'
canAccessDomain(user, 'store')
isOperationGroupMember(user)
isAccountingGroupMember(user)
isSystemAdmin(user)

// Primary role (auth-mapping) — for display, repair, migration
deriveBusinessRoleKey(user)   // BusinessRoleKey

// Module-level
canView(user, 'quotations')
canCreate(user, 'cashbook')
canEdit(user, 'workers')

// Staff type (delegate to core)
isInternalStaff(user)
isHRStaff(user)
isSalesStaff(user)
isAccountingStaff(user)
isStoreStaff(user)
isOperationsStaff(user)
isClient(user)
```

## What to Avoid

- Hardcoded `roleIds?.some(...)` or `assignedRoleKey === 'x'` — use helpers above
- Direct `user.department === 'x'` for access decisions — use `getEffectiveAccessGroup` or `canAccessDomain`
- Adding new role checks without going through permission-core/permissions
- For primary role display: use `deriveBusinessRoleKey(user)` from auth-mapping instead of `user.assignedRoleKey || fallback`

## Admin Repair Path

`/setup-admin` → Account Repair tab uses `buildAuthorizationForRepairRole` from auth-mapping. Supports: system_admin, operation_officer, operation_manager, accounting_*, hr_*, sales_*, store_*, etc.

## Migration Path

`/system-admin/user-migration` — Admin-only. Backfills `departmentGroup`, `accessLevel`, `assignedRoleKey`, `permissionProfileKey` from legacy. Does not delete legacy fields.
