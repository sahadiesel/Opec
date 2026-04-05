# User authorization — field reference & admin workflows

This document describes **how user access is stored today** and how admins should assign it.  
(Legacy bulk migration UI has been removed; use **User Access Management** and **setup-admin repair** instead.)

See **`docs/permissions-architecture.md`** for the full permission stack and helper list.

## Canonical formatting (required)

| Rule | Example |
|------|---------|
| Lowercase only | `operations_manager` ✓ — `OPERATIONS_MANAGER` ✗ |
| `snake_case` for keys | `hr_officer`, `client_user` |
| Operations partition | `accessGroup`: `operations` ✓ — `operation` ✗ |
| Admin profile vs role | Profile doc id `admin_admin` — user `assignedRoleKey` `system_admin` |

The app normalizes on write via **`normalizeUserAuthorizationFields`** (`auth-mapping.ts`) and **`normalizeBusinessRoleKey` / `normalizePermissionProfileDocumentId`** (`role-key-normalizer.ts`).

## Access groups (partitions)

| Group | Typical domains / notes |
|-------|-------------------------|
| **admin** | Full system; users, security, numbering, audit |
| **operations** | Sales, HR, operations scheduling, store (under one partition) |
| **accounting** | Accounting/finance modules; may read some operational data per matrix |
| **client** | Customer portal; `userType` must be `customer_portal`, `accessGroup` `client`, `assignedRoleKey` `client_user` |

## Mapping business role → profile

Each `BusinessRoleKey` in `ROLE_CATALOG` has a **`permissionProfileKey`** (Firestore `permission_profiles` doc id). Examples:

| `assignedRoleKey` | Typical `permissionProfileKey` |
|-------------------|-------------------------------|
| `system_admin` | `admin_admin` |
| `operations_manager` | `operations_manager` |
| `operations_officer` | `operations_officer` |
| `client_user` | `client_user` |

Custom profiles may exist in Firestore; ids should still be **lowercase** and consistent.

## Admin workflows

1. **Approve new registrations** — `/users` → tab **รออนุมัติ** → **แก้ไขสิทธิ์** → choose **permission profile** (recommended) or **role** → set status **ACTIVE** → save.  
   The page stores canonical fields only (no uppercase legacy keys).

2. **Emergency repair** — `/setup-admin` → Account Repair → pick a canonical business role; payload is built with `buildAuthorizationForRepairRole`.

## Fields touched on assign / approve

Writes typically set (at minimum):

- `assignedRoleKey`, `assignedRoleKeys` (single value)
- `permissionProfileKey`, `permissionProfileKeys` (single value)
- `accessGroup`, `departmentGroup` (matching, `operations` not `operation`)
- `accessLevel`, `department`, `level`, `userType`, `dataAccess`
- `approvalStatus`, `isActive`, `updatedAt`

`roleId` / `roleIds` are kept in sync with the catalog’s `canonicalRole` for older readers.

## `migrationNeedsReview`

Users with unclear data may carry `migrationNeedsReview: true` until an admin fixes them via `/users` or setup-admin.

## Firestore rules alignment

Rules use **`users/{uid}.assignedRoleKey`** as the primary role string (exact match to canonical lowercase). Client portal additionally requires `userType == customer_portal` and `accessGroup == client`. Keep user documents aligned with this model to avoid denied reads/writes.
