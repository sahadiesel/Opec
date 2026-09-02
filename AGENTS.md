# AGENTS.md

## Project Overview

OPEC OpsFlow is a full-stack **Manpower Supply Management** platform built with Next.js 15 (App Router) and Firebase (Auth, Firestore, Storage). It manages labor supply operations including HR/payroll, sales, operations, accounting, and a client portal.

## Cursor Cloud specific instructions

### Services

| Service | Command | Port | Notes |
|---------|---------|------|-------|
| Next.js Dev Server | `npm run dev` | 9003 | Main app (Turbopack). All API routes are Next.js route handlers. |
| Cloud Functions | N/A (deploy only) | — | `functions/` subfolder; deployed to Firebase, not run locally. |

### Running the dev server

```bash
npm run dev        # Turbopack on port 9003
npm run dev:webpack # Webpack fallback on port 9003
```

The app uses hardcoded default Firebase config for project `studio-9554558161-dc547` in `src/firebase/config.ts`, so no `.env.local` is required for the dev server to start and serve the UI. Firebase Auth, Firestore, and Storage connect to the live cloud project by default.

### Lint & Typecheck

- **Lint:** `npx eslint src/` (uses flat config in `eslint.config.mjs`). The `next lint` command is deprecated in Next.js 15.5+ and has been replaced by direct ESLint CLI usage.
- **Typecheck:** `npm run typecheck` — runs `tsc --noEmit`. The project has `ignoreBuildErrors: true` in `next.config.ts`, so the single pre-existing TS error does not block builds.
- **Build:** `npm run build` — production build; ignores TS and ESLint errors per `next.config.ts`.

### Key caveats

- The project has **no automated test suite** (no Jest, Vitest, Playwright, etc.). Testing is done manually via the browser.
- Firebase Admin SDK API routes (e.g., `/api/workers/activate-login`) require a service account credential (`FIREBASE_SERVICE_ACCOUNT_PATH` or `GOOGLE_APPLICATION_CREDENTIALS`). Without it, those specific API routes will fail but the rest of the app works fine.
- The `functions/` subfolder has its own `package.json` and `package-lock.json`; run `npm install` there separately if working on Cloud Functions.
- `eslint-config-next` (v15.5.9) exports a native ESLint flat config array — do NOT use `@eslint/eslintrc` FlatCompat wrapper (causes circular JSON errors).

### Locked payroll rule — offshore cost / standby (do not re-debate)

See also `.cursor/rules/payroll-offshore-standby.mdc` and `src/lib/commercial/package-hourly-rate.ts`.

- **Work day 12h package `D`** = 8 normal + 4 OT×1.5 → `baseH = D/14` (e.g. 1400 → 100/h).
- **Standby pay to worker** = `baseH × hours × 0.5` with standard **8h** (e.g. 1400 → **400**). Never `D×0.5` or `D×(h/12)×0.5`.
- **Customer billing** is separate (contract / matrix only).
- **Payroll batch UI** shows **snapshot amounts** from Generate/Regenerate/per-worker recalc only — never live-recompute timesheet gross on page open.
- **Remob / multi-cycle month:** pay all unpaid recorded work days in the month (e.g. 1–5 + 10–15 + 25–30 = 17 days). Never drop unpaid days for a new mob cycle. If earlier days already paid → full-month gross/tax then deduct prior paid net; **already-paid day line amounts stay frozen** from a prior NORMAL batch snapshot (rate edits + recalc must not rewrite them). SUPPLEMENTAL ตกเบิก does not freeze Aug work days. **Pre-remob rate** is snapshotted on finish into `mobilizations.laborCostEpochs` (days ≤ finish use e.g. 1800; remob days use current registry e.g. 2600).
