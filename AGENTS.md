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
