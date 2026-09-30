/**
 * Database schema, versioned with SQLite's `PRAGMA user_version`.
 *
 * Rules:
 * - Never edit a migration that has shipped; append a new one.
 * - Canonical units in storage: pounds (lb) and inches (in). Unit settings only
 *   affect display/entry, so switching units never rewrites history.
 * - Every health-data table carries a `source` column ('manual', 'apple_health',
 *   'smart_scale', 'import') so future integrations can write alongside manual data.
 * - Workout sessions snapshot their prescription (sets / rep range / title) so
 *   editing the plan later never rewrites historical workouts.
 */
export const MIGRATIONS: string[] = [
  /* 1 — initial schema */ `
  CREATE TABLE user_profile (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    name                TEXT NOT NULL DEFAULT '',
    age                 INTEGER,
    sex                 TEXT,
    height_in           REAL,
    starting_weight_lb  REAL,
    baseline_sleep_min  INTEGER,
    program_start_date  TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL            -- JSON encoded
  );

  CREATE TABLE workout_plan (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    notes       TEXT
  );

  CREATE TABLE workout_day (
    id              INTEGER PRIMARY KEY,
    plan_id         INTEGER NOT NULL REFERENCES workout_plan(id) ON DELETE CASCADE,
    weekday         INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Monday
    code            TEXT NOT NULL,          -- e.g. 'A', 'CARDIO_TUE'
    title           TEXT NOT NULL,          -- 'Full Body A'
    subtitle        TEXT,                   -- 'Strength + easy cardio'
    kind            TEXT NOT NULL CHECK (kind IN ('strength','cardio','recovery','long_cardio','rest')),
    est_minutes     INTEGER,
    duration_min    INTEGER,                -- cardio target range
    duration_max    INTEGER,
    intensity       TEXT,
    description     TEXT,
    warmup          TEXT,                   -- JSON {label, minMinutes, maxMinutes, intensity}
    finisher        TEXT,                   -- JSON {label, minMinutes, maxMinutes, optional}
    modalities      TEXT,                   -- JSON string[] (cardio options)
    mobility        TEXT                    -- JSON string[] (mobility checklist)
  );

  CREATE TABLE exercise (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    category      TEXT NOT NULL CHECK (category IN ('strength','cardio','mobility','core')),
    equipment     TEXT,
    increment_lb  REAL,                     -- configured machine increment (null = unknown)
    is_bodyweight INTEGER NOT NULL DEFAULT 0,
    notes         TEXT,                     -- persistent setup notes ("seat at 4")
    is_custom     INTEGER NOT NULL DEFAULT 0,
    archived      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE exercise_prescription (
    id              INTEGER PRIMARY KEY,
    workout_day_id  INTEGER NOT NULL REFERENCES workout_day(id) ON DELETE CASCADE,
    exercise_id     INTEGER NOT NULL REFERENCES exercise(id),
    position        INTEGER NOT NULL,
    sets_min        INTEGER NOT NULL,
    sets_max        INTEGER NOT NULL,
    reps_min        INTEGER NOT NULL,
    reps_max        INTEGER NOT NULL,
    label           TEXT,                   -- display label, e.g. 'Glute Bridge or Hip Thrust'
    notes           TEXT
  );

  CREATE TABLE exercise_substitution (
    id              INTEGER PRIMARY KEY,
    exercise_id     INTEGER NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
    substitute_id   INTEGER NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
    is_custom       INTEGER NOT NULL DEFAULT 0,
    UNIQUE (exercise_id, substitute_id)
  );

  CREATE TABLE workout_session (
    id              INTEGER PRIMARY KEY,
    date            TEXT NOT NULL,
    workout_day_id  INTEGER REFERENCES workout_day(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,          -- snapshot
    kind            TEXT NOT NULL,          -- snapshot
    status          TEXT NOT NULL CHECK (status IN ('in_progress','completed','abandoned')),
    started_at      TEXT NOT NULL,
    completed_at    TEXT,
    notes           TEXT,
    source          TEXT NOT NULL DEFAULT 'manual'
  );
  CREATE INDEX idx_ws_date ON workout_session(date);

  CREATE TABLE exercise_session (
    id                  INTEGER PRIMARY KEY,
    workout_session_id  INTEGER NOT NULL REFERENCES workout_session(id) ON DELETE CASCADE,
    exercise_id         INTEGER NOT NULL REFERENCES exercise(id),
    original_exercise_id INTEGER REFERENCES exercise(id),   -- set when substituted
    position            INTEGER NOT NULL,
    sets_target         INTEGER NOT NULL,   -- snapshot of prescription
    sets_max            INTEGER NOT NULL,
    reps_min            INTEGER NOT NULL,
    reps_max            INTEGER NOT NULL,
    label               TEXT,
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),
    notes               TEXT
  );
  CREATE INDEX idx_es_ex ON exercise_session(exercise_id);

  CREATE TABLE set_log (
    id                  INTEGER PRIMARY KEY,
    exercise_session_id INTEGER NOT NULL REFERENCES exercise_session(id) ON DELETE CASCADE,
    set_number          INTEGER NOT NULL,
    weight_lb           REAL,
    reps                INTEGER NOT NULL,
    rir                 REAL,
    form_ok             INTEGER NOT NULL DEFAULT 1,
    notes               TEXT,
    logged_at           TEXT NOT NULL DEFAULT (datetime('now')),
    client_id           TEXT UNIQUE          -- idempotency key from the workout screen
  );

  CREATE TABLE body_measurement (
    id        INTEGER PRIMARY KEY,
    date      TEXT NOT NULL,
    metric    TEXT NOT NULL,                -- weight | abdomen | lower_waist | chest | arms | thighs | neck | hips
    value     REAL NOT NULL,                -- lb for weight, inches otherwise
    notes     TEXT,
    source    TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_bm ON body_measurement(metric, date);

  CREATE TABLE progress_photo (
    id        INTEGER PRIMARY KEY,
    date      TEXT NOT NULL,
    pose      TEXT NOT NULL CHECK (pose IN ('front','side','back')),
    filename  TEXT NOT NULL,
    mime      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE nutrition_log (
    id         INTEGER PRIMARY KEY,
    date       TEXT NOT NULL,
    protein_g  REAL NOT NULL DEFAULT 0,
    calories   REAL,
    carbs_g    REAL,
    fat_g      REAL,
    label      TEXT,
    source     TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_nl ON nutrition_log(date);

  CREATE TABLE sleep_log (
    id            INTEGER PRIMARY KEY,
    date          TEXT NOT NULL UNIQUE,     -- the morning you woke up
    duration_min  INTEGER NOT NULL,
    bedtime       TEXT,
    wake_time     TEXT,
    quality       INTEGER,                  -- optional 1–5
    source        TEXT NOT NULL DEFAULT 'manual',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE cardio_session (
    id                  INTEGER PRIMARY KEY,
    date                TEXT NOT NULL,
    workout_session_id  INTEGER REFERENCES workout_session(id) ON DELETE CASCADE,
    role                TEXT NOT NULL DEFAULT 'main' CHECK (role IN ('main','warmup','finisher')),
    modality            TEXT NOT NULL,
    duration_min        REAL NOT NULL,
    distance_mi         REAL,
    avg_hr              INTEGER,
    intensity           TEXT,               -- easy | moderate
    notes               TEXT,
    source              TEXT NOT NULL DEFAULT 'manual',
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_cs ON cardio_session(date);

  CREATE TABLE recovery_log (
    id                  INTEGER PRIMARY KEY,
    date                TEXT NOT NULL,
    workout_session_id  INTEGER REFERENCES workout_session(id) ON DELETE SET NULL,
    energy              INTEGER,            -- 1–5
    sleep_hours         REAL,
    knee_pain           INTEGER,            -- 0–10
    soreness            INTEGER,            -- 0–10
    notes               TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE milestone (
    id            INTEGER PRIMARY KEY,
    metric        TEXT NOT NULL,            -- weight | abdomen | lower_waist | chest | custom
    title         TEXT NOT NULL,
    target_value  REAL,
    direction     TEXT NOT NULL DEFAULT 'below' CHECK (direction IN ('below','above')),
    achieved_date TEXT,
    position      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE daily_note (
    id         INTEGER PRIMARY KEY,
    date       TEXT NOT NULL,
    body       TEXT NOT NULL,
    tags       TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_dn ON daily_note(date);

  /* Future Apple Health / smart-scale / other integrations record each import run here. */
  CREATE TABLE import_run (
    id          INTEGER PRIMARY KEY,
    source      TEXT NOT NULL,
    started_at  TEXT NOT NULL DEFAULT (datetime('now')),
    records     INTEGER NOT NULL DEFAULT 0,
    notes       TEXT
  );
  `,
];

/** Tables in dependency order — used by backup/restore. */
export const TABLES = [
  'user_profile',
  'settings',
  'workout_plan',
  'exercise',
  'workout_day',
  'exercise_prescription',
  'exercise_substitution',
  'workout_session',
  'exercise_session',
  'set_log',
  'body_measurement',
  'progress_photo',
  'nutrition_log',
  'sleep_log',
  'cardio_session',
  'recovery_log',
  'milestone',
  'daily_note',
  'import_run',
] as const;

export type TableName = (typeof TABLES)[number];
