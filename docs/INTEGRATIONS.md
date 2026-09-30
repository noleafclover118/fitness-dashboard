# Integrations & automation roadmap

Version 1 is fully manual and offline. Nothing here is required. Everything below is **opt-in** and should stay local unless you explicitly choose otherwise.

## The seam

All automated data enters through one function:

```ts
import { importRecords } from '@/lib/integrations/import';

importRecords(db, 'apple_health', [
  { type: 'body',   date: '2026-10-01', metric: 'weight', value: 224.8 },          // lb
  { type: 'sleep',  date: '2026-10-01', minutes: 372, bedtime: '22:55', wake: '04:07' },
  { type: 'cardio', date: '2026-10-01', modality: 'Outdoor Bicycle', minutes: 48, distanceMi: 11.2, avgHr: 128 },
  { type: 'protein', date: '2026-10-01', grams: 38, label: 'Lunch' },
]);
```

- Every row is tagged with its `source`, so charts can show or filter by origin.
- Re-importing the same data is harmless (duplicates are skipped).
- **Manual entries win**: an imported sleep value never replaces one you typed.
- Each run is recorded in the `import_run` table.

New metrics (resting heart rate, steps, active energy, exercise minutes) would get their own small table (e.g. `daily_metric(date, metric, value, source)`) in a new migration, then a `type: 'daily'` record here.

## Apple Health — practical routes

A web app (even installed to the Home Screen) can’t read HealthKit, and your data lives in the app’s on-device storage, so health data has to be handed to the app as a file.

### 1. Apple Shortcuts → import file (recommended next step)
A personal Shortcut (Automation → daily) uses *Find Health Samples* for yesterday’s weight, sleep, workouts and dietary protein, builds a small JSON list of `HealthRecord`s and saves it to iCloud Drive. A future **Settings → Import health data** button would read that file and call `importRecords(db, 'apple_health', records)`. Everything stays on the phone.

### 2. Full Health export
Health app → profile → **Export All Health Data** produces a zip with `export.xml`. An importer would stream-parse it in the browser (it can be hundreds of MB) and map:

| HealthKit type | Record |
|---|---|
| `HKQuantityTypeIdentifierBodyMass` | `body / weight` (convert kg→lb if needed) |
| `HKQuantityTypeIdentifierWaistCircumference` | `body / lower_waist` |
| `HKCategoryTypeIdentifierSleepAnalysis` (asleep stages) | `sleep`, summing asleep intervals per wake date |
| `Workout` (cycling, elliptical, walking) | `cardio` with duration, distance, avg HR |
| `HKQuantityTypeIdentifierDietaryProtein` | `protein` |
| Resting HR, steps, active energy, exercise time | future `daily_metric` table |

Only records newer than the last `import_run` should be processed.

### 3. Native companion app
A SwiftUI app with HealthKit access could read samples directly and hand them over via a shared file, or the whole app could move native. This needs Xcode and an Apple Developer account.

## Smart scale
Most Wi-Fi scales (Withings, Eufy, Renpho) sync into Apple Health, so the routes above cover them.

## Backups
Settings → Back up data → Save to Files (iCloud Drive). A Shortcut can remind you weekly. Automatic backups would need a sync service and are intentionally not built in, to keep data on the device.

## Weekly summary & monthly report
`weeklyReview(db, date, today)` in `src/lib/domain/summary.ts` already produces the numbers and a neutral observation (shown on the Progress page). A monthly roll-up could combine four of these.

## AI-generated progress analysis (opt-in only)
Send the weekly review object (numbers only; no photos or free-text notes unless you choose) to an LLM with a system prompt forbidding medical and medication guidance. This must be off by default, clearly labeled as a third-party service, and use your own API key.
