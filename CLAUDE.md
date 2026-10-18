@AGENTS.md

# Fitness — project notes for Claude

Personal body-recomposition tracker, used as an installable iPhone web app (Safari → Add to Home Screen).
Live at https://noleafclover118.github.io/fitness-dashboard/ — every push to `main` runs
`.github/workflows/deploy.yml` (unit tests → static build → GitHub Pages). The user sees an "Update" bar in the app.

## Architecture
- Next.js 16 with `output: 'export'` (pure static site, `trailingSlash: true`, basePath from `NEXT_PUBLIC_BASE_PATH`).
  No server: no Server Actions, route handlers, cookies or dynamic `[id]` routes. Pages are client components;
  ids go in the query string (`/workout?id=`, `/history/view?id=`, `/exercise?id=`).
- Data lives ON THE PHONE: SQLite via sql.js (`src/lib/db/index.ts`) persisted to IndexedDB (`src/lib/client/store.ts`).
  Photos are Blobs in IndexedDB. Two databases: `real` and `sample` (demo data, never mixed).
- Every mutation goes through `src/app/actions.ts` → `act()` → `commit()`, which saves to IndexedDB *before* re-rendering.
  Read data in pages with `useDb()` / `useSp()` from `src/components/client/DataProvider.tsx`.
- Schema changes: append a migration in `src/lib/db/schema.ts` (never edit shipped ones) and add new tables to `TABLES`
  so backups include them. Storage units are lb / in.
- Domain logic (progression rule, summaries, weekly review) is in `src/lib/domain`, data access in `src/lib/repo`.
- Offline: `scripts/build-sw.mjs` writes `out/sw.js` that pre-caches the whole build.

## Rules
- The repo is PUBLIC. Never commit the user's personal stats, health data or the research compound's name
  (it is typed in Settings and stored only on the device). Test fixtures use made-up numbers.
- No medical advice. The optional Research Protocol section is recordkeeping only: never suggest, calculate,
  auto-fill, carry forward or change an amount; observations never drive recommendations; no dosing, reconstitution,
  syringe or injection content. Keep the persistent "investigational / not a dosing recommendation" note.
- Design: Apple-like restraint, system font, cards, metric identity colours from `globals.css`, status never by colour alone,
  light + dark, one-hand-friendly controls on iPhone.

## Commands
- `npm run dev` — local dev (http://localhost:3000)
- `npm test` — Vitest (sql.js under Node)
- `npm run test:e2e` — builds with basePath `/fitness-dashboard`, serves `out/`, runs Playwright (uses installed Chrome)
- `npm run typecheck && npm run lint`
- Run all of the above before pushing. Deploy = `git push` (GitHub CLI `gh` is logged in as noleafclover118).
