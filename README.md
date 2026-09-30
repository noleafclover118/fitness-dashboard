# Fitness — personal body recomposition dashboard

A private fitness app for your iPhone, built for a structured recomposition program: lose fat, keep and build muscle, get stronger, improve cardio, and shrink the waistline, **without turning fitness into a data-entry project**.

- **Runs on your phone.** Open it once in Safari, choose **Add to Home Screen**, and it behaves like an app: full screen, no browser bars.
- **Works with no signal.** After the first load everything is cached on the phone, so the gym’s dead zone doesn’t matter.
- **Your data never leaves the phone.** It’s stored in a SQLite database inside the app’s on-device storage. There are no accounts, no servers holding your data, no analytics and no trackers. The website hosts only the app’s code.

It answers five questions the moment you open it: **What am I doing today? Am I losing weight? Am I getting stronger? Am I hitting protein? Am I recovering?** Weight is one metric among several. The **Body recomposition** board keeps weight, abdomen, strength, protein, training consistency, cardio and sleep as independent indicators, so a good week is visible even when the scale stalls.

> This app tracks fitness habits. It does **not** give medical advice, diagnoses, or any medication information (dosing, injection, reconstitution, titration).

---

## Put it on your iPhone

### One-time setup: publish it to GitHub Pages (free)

1. On github.com, create a **new repository** called `fitness-dashboard` (Public: GitHub Pages is free for public repos. Only code is published, never your data or your numbers).
2. From this folder on your Mac:
   ```bash
   git remote add origin https://github.com/<your-username>/fitness-dashboard.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Wait ~2 minutes (the **Actions** tab shows progress). Your app is at
   **`https://<your-username>.github.io/fitness-dashboard/`**

### Install on the phone
1. Open that address in **Safari** on the iPhone.
2. Tap **Share → Add to Home Screen → Add**.
3. Open it from the new **Fitness** icon, enter your starting numbers (about 30 seconds), and you’re set.

Always open it from the Home Screen icon. That copy has its own storage and isn’t subject to Safari’s cleanup of website data.

### Updates
Every `git push` to `main` rebuilds and republishes automatically. The next time you open the app, a small **“A new version is ready — Update”** bar appears. Your data is untouched by updates.

---

## Your data

| | |
|---|---|
| **Where** | In the app’s on-device storage on your iPhone (IndexedDB), as a SQLite database. Progress photos are stored alongside, resized to 1600 px. |
| **Backup** | Settings → **Back up data** → Share sheet → **Save to Files** → iCloud Drive. One JSON file with everything: program, workouts, sets, measurements, logs, notes, milestones, settings and photos. The page shows when you last backed up. Do it every week or two. |
| **Restore / new phone / laptop** | Settings → **Restore backup** (or on the first-run screen). The file is validated first; you see what it contains and must confirm. The previous data is kept so **Undo restore** puts it back. |
| **CSV** | Settings → Measurements, Workouts (one row per set), Cardio, Protein/sleep/recovery by day. |
| **Laptop** | The same web address works in any browser, but each device keeps its **own** copy. Move data between them with backup → restore. |
| **Start over** | Settings → Erase data (type RESET). Can be undone once. |

**Safety:** every change is written to storage *before* the screen updates. A workout in progress (current step, typed values, rest timer, cardio stopwatch) survives closing the app, and the dashboard shows a **Resume** banner. Deletions ask for confirmation.

---

## What’s inside

| Area | Highlights |
|---|---|
| **Dashboard** | Weight (7-day avg + change), abdomen, protein ring, sleep; today’s workout; week consistency; recomposition board; weight & strength trends; next measurement; next milestones; program check-in prompts (only when warranted). |
| **Workout mode** | Big one-hand controls; last performance beside today; READY TO PROGRESS guidance; RIR; form flag; rest timer (60/90/120/custom, +30, auto-start optional); notes; substitutions; skip; add exercise; cardio stopwatch; mobility checklist; optional recovery check-in. |
| **Progression** | All prescribed sets at the **top** of the rep range, same load, clean form, ~2–3 RIR → **Ready to progress**. An exact weight is suggested only if you set that machine’s increment. Otherwise it says “Stay at current weight” or “Consider maintaining or reducing load”. |
| **Progress** | 7/30/90/all-time. Weight (rolling avg), abdomen, lower waist, chest, strength per exercise, protein + weekly adherence, sleep + 7-day avg, cardio minutes/week. Weekly review with a neutral observation. Photos. Milestones (custom + automatic strength PRs). |
| **Nutrition** | Protein first: ring, grams to minimum, frequent foods one-tap, 14-day chart. Calories/carbs/fat optional and hidden by default. |
| **Recovery** | Sleep vs your own baseline (never punitive), check-ins, knee-discomfort trend with a gentle, non-diagnostic note. |
| **History** | Searchable journal, weekly-review table, activity timeline, edit or delete any workout. |
| **Settings** | Profile, targets, rest timer, units (lb/kg, in/cm), reminders, appearance (system/light/dark), backup/restore/export, sample preview. |

---

## Technology

| Choice | Why |
|---|---|
| **Next.js 16 static export + React 19 + TypeScript** | Builds to plain HTML/JS files: free to host anywhere, no server to run or pay for. |
| **SQLite via sql.js (WebAssembly)** | A real SQL database running on the phone, saved to IndexedDB after every change. The same schema, queries and business logic are unit-tested under Node. |
| **Service worker** (`scripts/build-sw.mjs`) | Pre-caches the whole app so it opens and works offline. |
| **Tailwind CSS 4, Recharts, Zod** | Design tokens for light/dark, clean SVG charts, backup validation. |
| **Vitest + Playwright** | Logic/database tests and real-browser tests against the production build (desktop + iPhone size). |

### Project structure
```
src/
  app/                    pages (dashboard, today, workout, workouts, progress, nutrition, recovery, history, settings, exercise)
  app/actions.ts          every data change (runs on the device)
  components/             UI; client/ has WorkoutRunner, QuickLog, charts, DataProvider, Onboarding…
  lib/db/                 sql.js adapter, schema/migrations, seed program, sample-data generator
  lib/client/store.ts     IndexedDB persistence, live updates, safety copies
  lib/program/default-program.ts   the starting program, exercises, substitutions, targets
  lib/repo/               data access     lib/domain/  progression, stats, summaries, weekly review
  lib/integrations/       import seam for Apple Health / smart scale (future)
  lib/backup.ts           export, validation, restore, CSV
scripts/                  prepare-assets, build-sw, serve (preview), make-icons
tests/unit, tests/e2e     Vitest and Playwright
.github/workflows/deploy.yml   build → test → publish to GitHub Pages
```

**Data model:** `user_profile`, `settings`, `workout_plan` → `workout_day` → `exercise_prescription` → `exercise` (+ `exercise_substitution`), `workout_session` → `exercise_session` → `set_log`, `cardio_session`, `body_measurement`, `progress_photo`, `nutrition_log`, `sleep_log`, `recovery_log`, `milestone`, `daily_note`, `import_run`. Workouts snapshot their prescription, so editing the program never rewrites history. Storage units are lb/in (display converts). Every health table has a `source` column for future imports. Migrations are versioned with `PRAGMA user_version` and run automatically on open.

---

## Changing the workout program

In the app: **Workouts → Edit program**. Rename days, move a workout to another weekday, change exercises, sets and rep ranges, reorder or remove, and adjust cardio durations. Changes apply to future workouts only. Per-exercise setup notes, **machine increment**, and substitutions live on each exercise’s page (or **Notes** during a workout).

To change what a *brand-new* install starts with, edit `src/lib/program/default-program.ts` and push.

---

## Development (on the Mac)

Requires Node.js 22+ (`node -v`).

```bash
npm install
npm run dev            # http://localhost:3000 with hot reload
npm test               # unit tests (Vitest, sql.js under Node)
npm run test:e2e       # builds the site and runs browser tests (uses your Google Chrome;
                       #   otherwise: npx playwright install chromium && PW_CHANNEL= npm run test:e2e)
npm run build && NEXT_PUBLIC_BASE_PATH= npm run preview   # the exact production site at http://localhost:4173/
npm run typecheck && npm run lint
```

Testing on your phone before publishing: `npm run dev -- -H 0.0.0.0`, then open `http://<mac-name>.local:3000` (offline caching only runs in the published build).

Tests never touch real data: each browser test runs in a fresh browser profile with a pinned date. Coverage: onboarding, logging weight/measurements/protein/sleep, starting a workout and logging sets, reload and resume mid-workout, substitution, **full offline use via the service worker**, editing a finished workout, progression rules, PRs, milestones, knee note, note search, weekly summary, CSV export, JSON backup, restore, invalid-file rejection, undo restore, sample-data isolation, no horizontal overflow at iPhone width, navigation per screen size, dark/light/system appearance, one-hand-sized workout controls.

---

## Future: Apple Health & automation

A web app can’t read Apple Health directly. `src/lib/integrations/import.ts` is the ready-made entry point: it accepts tagged records (weight, measurements, sleep, workouts, protein), de-duplicates them and never overwrites manual entries. See **[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)** for the Health-export, Shortcuts and companion-app options.
