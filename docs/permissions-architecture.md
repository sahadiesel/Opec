# Permissions Architecture

## Model (Role vs Permission vs Firestore)

| Layer | What it is | Source of truth |
|-------|------------|-----------------|
| **Role** | Job function (who) | `users.assignedRoleKey` — one of `BusinessRoleKey` |
| **Permission** | UI menus & actions (what) | `getPermissions(user, moduleKey)` in `src/lib/permissions.ts` |
| **Data access** | Firestore read/write | `firestore.rules` capability helpers |

Do **not** store per-module permission flags on the user document. Do **not** assign `permissionProfileKey` on internal staff (legacy only).

Full matrix: **[role-permission-matrix.md](./role-permission-matrix.md)** (regenerate with `npm run generate:permission-matrix`).

## Canonical roles (14)

Defined in `src/lib/roles/role-catalog.ts` → `ACTIVE_BUSINESS_ROLE_KEYS`.

Admin UI (`/users`): status + **one role dropdown** → `buildUserAuthFirestoreUpdate(roleKey)`.

## User document fields (writes)

| Field | Purpose |
|-------|---------|
| `assignedRoleKey` | Canonical business role |
| `accessGroup` | `admin` \| `operations` \| `accounting` \| `client` |
| `accessLevel` | `admin` \| `manager` \| `officer` \| `viewer` |
| `userType` | `internal` \| `customer_portal` |
| `approvalStatus` / `isActive` | Account gate |

Removed on save (`REDUNDANT_USER_AUTH_FIELDS` in `auth-mapping.ts`):

`permissionProfileKey`, `permissionProfileKeys`, `roleId`, `roleIds`, `assignedRoleKeys`, `role`, `department`, `level`, `departmentGroup`.

## Code map

| File | Role |
|------|------|
| `src/lib/roles/role-catalog.ts` | Labels & metadata per role |
| `src/lib/auth-mapping.ts` | Role → Firestore fields, `buildUserAuthFirestoreUpdate` |
| `src/lib/permission-core.ts` | `getPrimaryLegacyRole`, access group/level |
| `src/lib/permissions.ts` | `getPermissions`, `canView` / `canCreate` / … |
| `src/lib/role-key-normalizer.ts` | `operation_manager` → `operations_manager` |
| `firestore.rules` | Server capabilities (`canonicalAssignedRoleKey`, `pettyCashSiteUserDocOk`, …) |

## Firestore rules guidelines

1. Read role with `primaryRole(userData())` / `roleIs(userData(), key)` — not `permissionProfileKey` / `roleId` for new logic.
2. Prefer capability functions (`canReadCustomers`, `canWritePurchases`, `numberSequenceAllowsWrite`, …) over per-collection `isInternalUser()`.
3. Avoid `get(permission_profiles/...)` in hot paths (list queries hit 10 document-read limit).
4. Keep OR branches shallow on `bank_accounts` / `petty_cash_entries`.
5. `primaryRole` = `canonicalAssignedRoleKey` only (ทุก user ต้องมี `assignedRoleKey` จาก `/users`).
6. `permission_profiles` collection: **admin only** (legacy; ไม่ใช้กำหนดสิทธิ์รายคนแล้ว).

## Deploy rules

```bash
npm run deploy:rules          # firebase-tools
npm run deploy:rules:retry    # retry on HTTP 503
npm run deploy:rules:admin    # Admin SDK (ADC / service account)
```

## Related

- `docs/role-permission-matrix.md` — generated Role × Module table
- `docs/firestore-rules-sets-2-9.md` — incremental rules rollout batches
