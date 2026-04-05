# Firestore Rules Deploy Checklist

Use this checklist every time before deploying `firestore.rules`.

## 1) Use one source folder only

- Deploy only from your main local clone (example: `D:\Github\Opec`).
- Do not deploy from another clone/worktree unless you intentionally synced it first.

## 2) Sync local with remote first

Run:

```powershell
git switch main
git fetch origin
git pull --ff-only origin main
```

Expected:

- No merge commit is created.
- Local `HEAD` must match `origin/main`.

Quick check:

```powershell
git rev-parse --short HEAD
git rev-parse --short origin/main
```

Both hashes should be the same.

## 3) Deploy rules manually

Run:

```powershell
firebase deploy --only firestore:rules
```

If Firebase returns transient `503`, retry with delay (or use `deploy-rules.ps1`).

## 4) Verify production updated

- Open Firebase Console > Firestore > Rules.
- Confirm latest timeline entry time is the one you just deployed.
- Spot-check important markers:
  - `roleKey()` / `assignedRoleKey` (lowercase canonical)
  - `canUpdateWorkersCollection` (or your latest rule helper name)

## 5) If deploy fails

- Re-check current folder and branch.
- Re-check local vs remote hash.
- Retry deploy.
- If repeated `503 UNAVAILABLE`, wait and retry later (service-side issue).

