# Permissions Architecture

## Source of truth

| Layer | Location | Purpose |
|-------|----------|---------|
| **Permission core** | `src/lib/permission-core.ts` | Access groups, domains, `getEffectiveAccessGroup`, `canAccessDomain`, `getPrimaryLegacyRole` (primary business role from user doc) |
| **Permissions** | `src/lib/permissions.ts` | Module-level `canView` / `canCreate` / `canEdit`, `getPermissions`, baseline `permission_profiles` templates |
| **Auth mapping** | `src/lib/auth-mapping.ts` | Role → Firestore user fields, `getFieldsForBusinessRole`, `normalizeUserAuthorizationFields`, setup-admin repair |
| **Role catalog** | `src/lib/roles/role-catalog.ts` | Display names and metadata per `BusinessRoleKey` |
| **Key normalization** | `src/lib/role-key-normalizer.ts` | `normalizeBusinessRoleKey`, `normalizePermissionProfileDocumentId` (trim + lowercase; built-in profile ids only) |
| **Firestore rules** | `firestore.rules` | Server-side checks use `assignedRoleKey` (exact lowercase canonical) plus `userType` / `accessGroup` for client portal; admin/HR/ops profile fallbacks use **both** `permissionProfileKey` and `permissionProfileKeys` (`userReferencesProfileDocId`) so rules match `isSystemAdmin` / profile binding in the app |

## Canonical string rules (mandatory)

- **All role keys, profile doc ids, and partition fields written to Firestore must be lowercase `snake_case`.**
- **No legacy synonyms in storage** (e.g. do not store `operation_manager`, `OPERATIONS_MANAGER`, or `operation` as `accessGroup`; use `operations_manager` and `operations`).
- **`assignedRoleKey`** is the single business role field for rules and app gates (see `BusinessRoleKey` in `src/lib/types.ts`).
- **`permission_profiles` document id** for the system admin matrix row is `admin_admin`; the user’s **business role** remains `system_admin`.
- **`accessGroup` and `departmentGroup`** must match each other on write and use **`operations`** (plural), never `operation`.

## Primary user authorization fields

| Field | Purpose |
|-------|---------|
| `userType` | `internal` \| `customer_portal` |
| `accessGroup` | `admin` \| `operations` \| `accounting` \| `client` |
| `departmentGroup` | Same partition as `accessGroup` |
| `accessLevel` | `admin` \| `manager` \| `officer` \| `viewer` |
| `assignedRoleKey` | Canonical role (e.g. `operations_manager`, `client_user`) |
| `permissionProfileKey` | Single primary profile doc id (e.g. `operations_manager`, `admin_admin`) |
| `permissionProfileKeys` | Single-element array, same id as `permissionProfileKey` |

`roleId` / `roleIds` are still populated for backward compatibility but **must stay aligned** with `assignedRoleKey` (same lowercase semantic). Prefer helpers instead of reading `roleId` in new code.

## Built-in permission profile ids

Aligned with `BUILTIN_PERMISSION_PROFILE_DOC_IDS` in `role-key-normalizer.ts`:

`admin_admin`, `client_user`, `sales_manager`, `sales_officer`, `hr_manager`, `hr_officer`, `payroll_officer`, `operations_manager`, `operations_officer`, `accounting_manager`, `accounting_officer`, `store_officer`.

## Central helpers (prefer these)

```ts
// Access
getEffectiveAccessGroup(user)
getEffectiveAccessLevel(user)
canAccessDomain(user, 'store')
isOperationGroupMember(user)
isAccountingGroupMember(user)
isSystemAdmin(user)

// Primary role (from assignedRoleKey → profile fallback)
getPrimaryLegacyRole(user)

// UI / repair (auth-mapping)
deriveBusinessRoleKey(user)
getFieldsForBusinessRole(roleKey)
normalizeUserAuthorizationFields(partialUser)

// Module-level
canView(user, 'quotations')
canCreate(user, 'cashbook')
```

## Admin UI

- **User Access Management:** `/users` — approve pending users, assign profile or role; all writes go through `normalizeUserAuthorizationFields`.
- **Setup / repair:** `/setup-admin` — Account Repair uses `buildAuthorizationForRepairRole` from `auth-mapping.ts`; choose a canonical `BusinessRoleKey` only.

## What to avoid

- Storing mixed-case or legacy role strings on user documents.
- Deriving primary role from `permissionProfileKeys` priority order — use `assignedRoleKey` first, then a single profile key.
- Duplicating access logic with ad-hoc `user.department === 'x'` in new code — use permission-core / `canView` where possible.

## Related docs

- `docs/user-auth-migration-guide.md` — field reference and admin workflows (historical migration UI removed from repo).
- `docs/firestore-rules-sets-2-9.md` — ordered batches **2–9** after Sets 0–1 (Sales → … → catch-all); do one batch at a time.
