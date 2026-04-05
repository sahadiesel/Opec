# Permission Refactor Verification Report

**Date:** 2025-03-22  
**Scope:** Align UI Firestore queries/writes with rewritten `firestore.rules` to reduce runtime permission errors.

---

## 1. Permission Model Summary

| Group | Domains | Collections (write) | Collections (read) |
|-------|---------|---------------------|--------------------|
| **admin** | All | All | All |
| **operations** | sales, operations pillar, hr | sales, waves, mobilizations, hr, store, vendors, purchases | Same + customers, POs |
| **accounting** | sales, hr, store, accounting | sales, hr, accounting (no store write) | Same + store for AP |
| **client** | client | None (read-only) | customerId-scoped only |

- **System management** (users, permission_profiles, number_sequences, etc.): admin only.
- **users** list: `canManageSystem()` only — blocks HR / **operations** partition / accounting from listing users.

---

## 2. Pages That Pass Verification

### Sales
- **customers, quotations, main-contracts, purchase-orders, sales-terms**: Use `isAuthorized` / `canView` before queries.
- **sales/dashboard**: Uses `isSalesStaff` (admin + operation + accounting); queries sales collections only.

### Operations
- **waves**: `isStaff` (canView waves) gate; accounting excluded from sidebar.
- **assignments, mobilization**: `isAuthorized` gate; mobilizations, waves, workers, positions, purchase_orders — all operation-accessible.
- **vendors**: `isAuthorized` gate; vendors collection allowed for operation.

### HR
- **workers, positions, payroll/batches, payroll/periods, office-staff (list)**: Use `canView` or `usePermissions` before queries.
- **timesheets, labor-cost-terms**: Proper guards; customers/POs now gated with `canViewTerms`.

### Accounting
- **billing-notes, tax-invoices, receipts, ap-bills, accounts-receivable, accounts-payable, cashbook**: Use `isAuthorized` / `canViewPage` before queries.
- **bank-accounts**: Uses `canView(user, 'bank_accounts')` instead of hardcoded role list.

### System Admin
- **/system-admin/\***: Layout guard with `useAppUser` + `isSystemAdmin`; no content until admin confirmed.
- **users, permission_profiles, audit_logs, numbering**: Admin-only; layout blocks non-admin.

### Client Portal
- **dashboard, waves, timesheets, billing**: Use `CustomerQueryService` for customerId-scoped queries.
- **waves**: `workersQuery` gated to run only when `currentUser` exists (avoids query before auth).

---

## 3. Fixes Applied

### 3.1 Admin-Only Collections (users list)

| Page | Issue | Fix |
|------|-------|-----|
| **office-staff/[id]** | `usersQuery` listed all users — rules allow list only for `canManageSystem()` | Gate `usersQuery` with `isSystemAdmin(currentUser)`; return `null` for non-admin |
| **customers/[id]** | `portalUsersQuery` listed users with filter — still requires `canManageSystem()` | Gate with `isSystemAdmin(currentUser)`; non-admin sees empty portal users |

### 3.2 Store Access Guards

| Page | Issue | Fix |
|------|-------|-----|
| **store, store/receive, store/ledger, store/items, store/issue, store/writeoff, store/return** | Queries ran with only `firestore` — client or unauthenticated could trigger permission errors | Added `useAppUser` + `canAccessDomain(currentUser, 'store')`; all store queries return `null` until access confirmed; page-level loading/access guard |

### 3.3 Auth/Access Readiness

| Page | Issue | Fix |
|------|-------|-----|
| **labor-cost-terms** | `customersQuery` and `poQuery` ran without permission check | Gate with `canViewTerms` (same as `termsQuery`) |
| **client-portal/waves** | `workersQuery` ran when only `firestore` existed | Gate with `currentUser` — no query before user known |
| **store/page** | `isOpsOrHR` excluded accounting; store is readable by accounting | Replaced with `canAccessDomain('store')` (operation + accounting) |

### 3.4 Role Check Alignment

| Page | Change |
|------|--------|
| **bank-accounts** | Replaced hardcoded `authRoles` with `canView(currentUser, 'bank_accounts')` |

---

## 4. Hidden / Background Queries Addressed

| Location | Query | Risk | Resolution |
|----------|-------|------|------------|
| **office-staff/[id]** | `collection('users')` on mount | HR/accounting get "Missing or insufficient permissions" | Query returns `null` unless `isSystemAdmin` |
| **customers/[id]** | `portalUsersQuery` (users with customerId filter) | Same as above | Same gate |
| **store/* (all)** | store_items, vendors, purchases, mobilizations, workers, store_transactions | Client or pre-auth could hit denied reads | All gated by `canAccess` |
| **client-portal/waves** | `workers` before `currentUser` ready | Possible pre-auth query | Gated by `currentUser` |

---

## 5. UI vs Rules Alignment Resolved

| Mismatch | Resolution |
|----------|------------|
| **users list** — rules require admin, UI allowed HR to load users | UI no longer runs users query for non-admin |
| **store pages** — accounting can read store (AP), UI used `isOpsOrHR` which excluded accounting | Switched to `canAccessDomain('store')` |
| **portal users in customer detail** — sales/ops could open customer but users query failed | Query only runs for admin; others see empty list |
| **labor-cost-terms** — customers/POs queried without page permission | Both gated with `canViewTerms` |

---

## 6. Pages Still at Lower Risk (No Code Change)

- **rate-conditions-editor** (component): Used in sales-terms; parent page has access control. No user guard in component — acceptable as parent gates access.
- **main-contracts/[id], customers/[id]** (non-portal queries): Use `firestore` + `id`; sales/operation/accounting have access to these collections.
- **payroll/periods**: `payroll_periods` is HR; both operation and accounting have HR access — no additional guard added.

---

## 7. TODO / Decisions

1. **client-portal/waves workers query**: Rules allow client to read all workers. UI fetches full workers collection and filters by assignment in memory. Consider adding `getScopedWorkersForAssignments(assignments)` to limit fetched workers (e.g. `where documentId in first 30 workerIds`) for performance — optional.
2. **Portal tab on customers/[id]**: For non-admin, portal users list is empty. Consider hiding the "Portal Access" tab for non-admin to avoid confusion.
3. **office-staff linked user dropdown**: Non-admin sees only "ไม่เชื่อมโยง (None)" — acceptable. Could hide the "การเชื่อมโยง" tab for non-admin if desired.
4. **Store write (issue/writeoff/return)**: Accounting can read store but not write. If accounting user opens store/issue, write will fail at Firestore. No UI-level write gate added — consider `canWriteStore`-style check if needed.

---

## 8. Route and Component Coverage

| Area | Route Guard | Sidebar | Page Guard | Firestore Queries |
|------|-------------|---------|------------|-------------------|
| System admin | `system-admin/layout.tsx` | `canSeeGroup` + `canView` | N/A (layout blocks) | Admin-only collections |
| Store | None (sidebar hides for non-store) | `canView('store_inventory')` | `canAccess` on all store pages | All gated |
| Client portal | None (sidebar hides for internal) | `client` audience | `!currentUser` → null | CustomerQueryService scoping |
| Sales/HR/Ops/Accounting | None | `canView(moduleKey)` | Per-page `isAuthorized` | Gated where needed |

---

## 9. Cleanup (Post-Verification)

- **Replaced hardcoded roleIds**: mobilization, quotations, main-contracts, purchase-orders, office-staff, cashbook, vendors → use `canView` or `isClient`
- **Consolidated is*Staff**: Now delegate to `isOperationGroupMember` / `isAccountingGroupMember` from permission-core
- **Fixed isStoreStaff**: Store modules use the **operations** access group in the permission model (alongside admin where applicable).
- **Centralized isClient**: client-portal dashboard, customer-query-service use `isClient` from permissions
- **vendors page**: Switched to `useAppUser` + `canView(user, 'vendors')`; removed localStorage/roleIds pattern
- **Dashboard (page.tsx)**: Uses `deriveBusinessRoleKey` for primary role display instead of `assignedRoleKey || 'hr_officer'`
- **Removed dead helpers**: `hasRole`, `hasAnyRole`, `canAccessHRModule`, `canAccessSalesModule`, `canAccessOperationsModule`, `canAccessStoreModule`, `canAccessAccountingModule` — use `canView` directly
- **See** `docs/permissions-architecture.md` for source of truth and central helpers

## 10. Summary

- **Admin pages**: Unblocked; layout guard prevents non-admin from reaching content.
- **Operations pillar pages**: No accounting-only collections; store fully gated.
- **Accounting pages**: No operations-only collections; store read access via `canAccessDomain('store')`.
- **HR pages**: Compatible with both **operations** and accounting partitions.
- **Sales pages**: Compatible with both **operations** and accounting via `isSalesStaff`.
- **Client pages**: Read-only, customerId-scoped via `CustomerQueryService`; workers query gated by `currentUser`.
- **Hidden queries**: users list and store queries stopped at UI when user lacks permission.
