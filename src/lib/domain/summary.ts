/**
 * Read models for the dashboard, weekly review and recomposition scoreboard.
 * Everything here is descriptive — it reports trends and adherence, never medical conclusions.
 */
import { all, get, type DB } from '../db';
import { addDays, dateRange, daysBetween, endOfWeek, programWeek, startOfWeek, weekdayIndex, type ISODate } from '../dates';
import { getActivePlan, type WorkoutDay } from '../repo/plan';
import { getProfile, getSettings, type Settings } from '../repo/settings';
import {
  dailyNutrition, latestMeasurement, listMeasurements, listMilestones, listRecovery, listSleep, setMilestoneAchieved,
  type BodyMetric, type Milestone,
} from '../repo/logs';
import { exerciseHistory, getActiveSession, loggedExercises, personalRecords, strengthTrend, type PersonalRecord } from '../repo/workouts';
import { mean, round, slopePerDay, windowAverage, type Point } from './stats';

const CARDIO_KINDS = ['cardio', 'long_cardio'];

export function weightPoints(db: DB, from = '0000-01-01', to = '9999-12-31'): Point[] {
  return listMeasurements(db, 'weight', from, to).map((m) => ({ date: m.date, value: m.value }));
}

export function weightSummary(db: DB, today: ISODate) {
  const profile = getProfile(db);
  const pts = weightPoints(db, '0000-01-01', today);
  const latest = pts[pts.length - 1] ?? null;
  const avg7 = windowAverage(pts, today, 7);
  const last30 = pts.filter((p) => p.date >= addDays(today, -29));
  const slope = slopePerDay(last30);
  const start = profile.starting_weight_lb ?? pts[0]?.value ?? null;
  const current = avg7 ?? latest?.value ?? null;
  return {
    latest,
    start,
    avg7: round(avg7),
    changeFromStart: current != null && start != null ? round(current - start) : null,
    trend30PerWeek: slope != null ? round(slope * 7, 2) : null,
    trend30Total: slope != null && last30.length ? round(slope * Math.min(29, daysBetween(last30[0].date, today))) : null,
    loggedToday: latest?.date === today,
  };
}

export function measurementSummary(db: DB, metric: BodyMetric, today: ISODate) {
  const list = listMeasurements(db, metric, '0000-01-01', today);
  const first = list[0] ?? null;
  const latest = list[list.length - 1] ?? null;
  return {
    first,
    latest,
    change: first && latest && latest.id !== first.id ? round(latest.value - first.value, 2) : null,
    count: list.length,
  };
}

export function proteinDays(db: DB, from: ISODate, to: ISODate, settings: Settings) {
  const rows = dailyNutrition(db, from, to);
  const map = new Map(rows.map((r) => [r.date, r.protein_g]));
  return dateRange(from, to).map((date) => {
    const g = map.get(date) ?? 0;
    return { date, protein: g, logged: map.has(date), hit: g >= settings.proteinMin };
  });
}

export function sleepSummary(db: DB, today: ISODate, settings: Settings) {
  const profile = getProfile(db);
  const recent = listSleep(db, addDays(today, -6), today);
  const lastNight = recent.find((s) => s.date === today) ?? null;
  const latest = recent[recent.length - 1] ?? null;
  return {
    lastNight,
    latest,
    avg7: round(mean(recent.map((s) => s.duration_min)), 0),
    baseline: profile.baseline_sleep_min,
    goalMin: settings.sleepGoalMin,
    goalMax: settings.sleepGoalMax,
    daysAtGoal: recent.filter((s) => s.duration_min >= settings.sleepGoalMin).length,
    logged: recent.length,
  };
}

interface SessionRow { id: number; date: string; kind: string; title: string }

function completedSessions(db: DB, from: ISODate, to: ISODate): SessionRow[] {
  return all<SessionRow>(db, "SELECT id, date, kind, title FROM workout_session WHERE status = 'completed' AND date BETWEEN ? AND ? ORDER BY date", from, to);
}

export function cardioMinutes(db: DB, from: ISODate, to: ISODate): number {
  return get<{ m: number | null }>(db, 'SELECT SUM(duration_min) AS m FROM cardio_session WHERE date BETWEEN ? AND ?', from, to)?.m ?? 0;
}

/** Weekly consistency against the plan targets. */
export function weekConsistency(db: DB, today: ISODate, settings: Settings) {
  const ws = startOfWeek(today);
  const we = endOfWeek(today);
  const sessions = completedSessions(db, ws, we);
  const plan = getActivePlan(db);
  const standaloneCardioDays = all<{ date: string }>(db,
    "SELECT DISTINCT date FROM cardio_session WHERE workout_session_id IS NULL AND role = 'main' AND date BETWEEN ? AND ? AND duration_min >= 20", ws, we).map((r) => r.date);

  const strength = sessions.filter((s) => s.kind === 'strength');
  const cardioSessions = sessions.filter((s) => CARDIO_KINDS.includes(s.kind));
  const recovery = sessions.filter((s) => s.kind === 'recovery');
  const cardioCount = Math.min(settings.weeklyTargets.cardio + 5, cardioSessions.length + standaloneCardioDays.filter((d) => !sessions.some((s) => s.date === d)).length);
  const daysElapsed = Math.min(7, daysBetween(ws, today) + 1);
  const protein = proteinDays(db, ws, we, settings);
  const sleep = listSleep(db, ws, today);

  // Planned slots so the UI can show ● ● ○ in schedule order.
  const slots = (kinds: string[]) =>
    plan.days.filter((d) => kinds.includes(d.kind)).map((d) => {
      const date = addDays(ws, d.weekday);
      return { weekday: d.weekday, title: d.title, date, done: sessions.some((s) => s.date === date && kinds.includes(s.kind)), past: date < today };
    });

  return {
    weekStart: ws,
    weekEnd: we,
    daysElapsed,
    strength: { done: strength.length, target: settings.weeklyTargets.strength, slots: slots(['strength']) },
    cardio: { done: cardioCount, target: settings.weeklyTargets.cardio, slots: slots(CARDIO_KINDS) },
    recovery: { done: recovery.length, target: settings.weeklyTargets.recovery, slots: slots(['recovery']) },
    protein: { hit: protein.filter((p) => p.hit).length, days: 7, elapsed: daysElapsed, byDay: protein },
    sleep: { atGoal: sleep.filter((s) => s.duration_min >= settings.sleepGoalMin).length, logged: sleep.length },
    cardioMinutes: cardioMinutes(db, ws, we),
  };
}

// ---- recomposition scoreboard -------------------------------------------

export function recompScoreboard(db: DB, today: ISODate) {
  const settings = getSettings(db);
  const profile = getProfile(db);
  const weight = weightSummary(db, today);
  const abdomen = measurementSummary(db, 'abdomen', today);
  const waist = measurementSummary(db, 'lower_waist', today);
  const strength = strengthTrend(db, '0000-01-01', today);
  const from28 = addDays(today, -27);
  const proteinFrom = from28 < profile.program_start_date ? profile.program_start_date : from28;
  const protein = proteinDays(db, proteinFrom, today, settings);
  const loggedProtein = protein.filter((p) => p.logged);
  const sleep = listSleep(db, addDays(today, -6), today);
  const week = weekConsistency(db, today, settings);
  const weightPts = weightPoints(db, '0000-01-01', today);
  const hasWeightTrend = weightPts.length >= 2;

  const items = {
    weight: hasWeightTrend && weight.changeFromStart != null ? weight.changeFromStart : null,
    abdomen: abdomen.change,
    lowerWaist: waist.change,
    strengthPct: strength ? round(strength.avgPct, 1) : null,
    strengthLifts: strength?.lifts ?? 0,
    proteinPct: loggedProtein.length ? Math.round((protein.filter((p) => p.hit).length / protein.length) * 100) : null,
    proteinDays: protein.length,
    strengthSessions: { done: week.strength.done, target: week.strength.target },
    cardioMinutes: week.cardioMinutes,
    sleepAvg: sleep.length ? round(mean(sleep.map((s) => s.duration_min)), 0) : null,
  };
  const collecting = items.weight == null && items.abdomen == null && items.strengthPct == null && items.proteinPct == null && items.sleepAvg == null;

  // Scale-stall context: flat weight but other indicators improving.
  let insight: string | null = null;
  const recentSlope = slopePerDay(weightPts.filter((p) => p.date >= addDays(today, -13)));
  if (!collecting) {
    const goodSignals: string[] = [];
    if (items.abdomen != null && items.abdomen < 0) goodSignals.push('abdomen');
    if (items.strengthPct != null && items.strengthPct > 1) goodSignals.push('strength');
    if (recentSlope != null && recentSlope * 14 > -0.4 && goodSignals.length) {
      insight = `Scale weight has been flat for two weeks, but ${goodSignals.join(' and ')} ${goodSignals.length > 1 ? 'are' : 'is'} still moving the right way. That is what body recomposition looks like.`;
    } else if (items.weight != null && items.weight < 0 && items.strengthPct != null && items.strengthPct >= -1) {
      insight = 'Weight is trending down while strength is holding or improving — a good sign that lean mass is being preserved.';
    }
  }
  return { items, collecting, insight };
}

// ---- weekly review -------------------------------------------------------

export interface WeeklyReview {
  weekStart: ISODate;
  weekEnd: ISODate;
  programWeek: number;
  complete: boolean;
  weight: { from: number | null; to: number | null; change: number | null };
  abdomen: { from: number | null; to: number | null; change: number | null };
  strength: { done: number; target: number };
  cardioMinutes: number;
  cardioSessions: number;
  protein: { hit: number; days: number; avg: number | null };
  sleep: { avg: number | null; logged: number; atGoal: number };
  prs: PersonalRecord[];
  kneeAvg: number | null;
  observation: string;
}

export function weeklyReview(db: DB, anyDateInWeek: ISODate, today: ISODate): WeeklyReview {
  const settings = getSettings(db);
  const profile = getProfile(db);
  const ws = startOfWeek(anyDateInWeek);
  const we = endOfWeek(anyDateInWeek);
  const until = we < today ? we : today;
  const pts = weightPoints(db);
  const thisWeek = pts.filter((p) => p.date >= ws && p.date <= we);
  const prevWeek = pts.filter((p) => p.date >= addDays(ws, -7) && p.date < ws);
  const wFrom = prevWeek.length ? mean(prevWeek.map((p) => p.value)) : thisWeek[0]?.value ?? null;
  const wTo = thisWeek.length ? mean(thisWeek.map((p) => p.value)) : null;

  const abBefore = latestMeasurement(db, 'abdomen', addDays(ws, -1));
  const abThis = listMeasurements(db, 'abdomen', ws, we);
  const abTo = abThis.length ? abThis[abThis.length - 1].value : null;
  const abFrom = abBefore?.value ?? (abThis.length > 1 ? abThis[0].value : null);

  const sessions = completedSessions(db, ws, we);
  const protein = proteinDays(db, ws, until, settings);
  const logged = protein.filter((p) => p.logged);
  const sleep = listSleep(db, ws, we);
  const knee = listRecovery(db, ws, we).map((r) => r.knee_pain).filter((v): v is number => v != null);

  const review: WeeklyReview = {
    weekStart: ws,
    weekEnd: we,
    programWeek: programWeek(profile.program_start_date, ws),
    complete: we < today,
    weight: { from: round(wFrom), to: round(wTo), change: wFrom != null && wTo != null ? round(wTo - wFrom) : null },
    abdomen: { from: abFrom, to: abTo, change: abFrom != null && abTo != null ? round(abTo - abFrom, 2) : null },
    strength: { done: sessions.filter((s) => s.kind === 'strength').length, target: settings.weeklyTargets.strength },
    cardioMinutes: Math.round(cardioMinutes(db, ws, we)),
    cardioSessions: sessions.filter((s) => s.kind !== 'strength').length,
    protein: { hit: protein.filter((p) => p.hit).length, days: protein.length, avg: round(mean(logged.map((p) => p.protein)), 0) },
    sleep: { avg: round(mean(sleep.map((s) => s.duration_min)), 0), logged: sleep.length, atGoal: sleep.filter((s) => s.duration_min >= settings.sleepGoalMin).length },
    prs: personalRecords(db, ws, we),
    kneeAvg: round(mean(knee), 1),
    observation: '',
  };
  review.observation = observe(review, settings);
  return review;
}

/** Short, neutral, non-medical narrative. */
export function observe(r: WeeklyReview, settings: Settings): string {
  const s: string[] = [];
  const dir = (c: number | null, eps: number) => (c == null ? null : c < -eps ? 'down' : c > eps ? 'up' : 'flat');
  const w = dir(r.weight.change, 0.3);
  const a = dir(r.abdomen.change, 0.1);
  const strengthUp = r.prs.length > 0;

  const declined = [w === 'down' && 'weight', a === 'down' && 'abdomen measurements'].filter(Boolean) as string[];
  if (declined.length) {
    const subject = declined.length === 2 ? 'Weight and abdomen measurements' : declined[0][0].toUpperCase() + declined[0].slice(1);
    s.push(`${subject} declined${strengthUp ? ' while strength performance improved' : ''}.`);
  } else if (w === 'flat') {
    s.push(`Weight held roughly steady${strengthUp ? ' while strength performance improved' : ''}.`);
  } else if (w === 'up') {
    s.push(`Weight averaged ${r.weight.change} lb higher than the week before — day-to-day water and food volume can do this; watch the trend over several weeks.`);
  } else if (strengthUp) {
    s.push('Strength performance improved.');
  }
  if (strengthUp && !s.some((x) => x.includes('strength'))) s.push(`New best performances on ${r.prs.length} exercise${r.prs.length > 1 ? 's' : ''}.`);

  if (r.strength.done >= r.strength.target) s.push('All planned strength sessions were completed.');

  // Identify the biggest opportunity (lowest adherence).
  const gaps: { area: string; score: number; text: string }[] = [];
  if (r.protein.days) {
    const pct = r.protein.hit / r.protein.days;
    if (pct >= 0.85) s.push('Protein consistency was strong.');
    gaps.push({ area: 'protein', score: pct, text: 'Protein consistency is the largest opportunity.' });
  }
  if (r.sleep.logged) {
    const pct = (r.sleep.avg ?? 0) / settings.sleepGoalMin;
    gaps.push({ area: 'sleep', score: Math.min(1, pct) - (pct < 1 ? 0.15 : 0), text: 'Sleep remains the largest recovery opportunity.' });
  }
  // Only judge training consistency once the week is over.
  if (r.complete) gaps.push({ area: 'training', score: r.strength.done / Math.max(1, r.strength.target), text: 'Training consistency is the largest opportunity.' });
  const weakest = gaps.filter((g) => g.score < 0.85).sort((x, y) => x.score - y.score)[0];
  if (weakest) s.push(weakest.text);
  if (!s.length) s.push('Not enough data logged this week for an observation yet.');
  return s.join(' ');
}

// ---- reminders, milestones, program review ------------------------------

export function measurementsDue(db: DB, today: ISODate) {
  const settings = getSettings(db);
  const profile = getProfile(db);
  const rem = settings.reminders;
  const lastPhoto = get<{ d: string | null }>(db, 'SELECT MAX(date) AS d FROM progress_photo')?.d ?? null;
  const out: { key: string; label: string; lastDate: string | null; dueDate: string; daysUntil: number }[] = [];
  const add = (key: string, label: string, last: string | null, cadence: number) => {
    const base = last ?? profile.program_start_date;
    const due = addDays(base, cadence);
    out.push({ key, label, lastDate: last, dueDate: due, daysUntil: daysBetween(today, due) });
  };
  add('abdomen', 'Abdomen', latestMeasurement(db, 'abdomen', today)?.date ?? null, rem.abdomen);
  add('lower_waist', 'Lower waist', latestMeasurement(db, 'lower_waist', today)?.date ?? null, rem.lower_waist);
  add('chest', 'Chest', latestMeasurement(db, 'chest', today)?.date ?? null, rem.chest);
  add('photos', 'Progress photos', lastPhoto, rem.photos);
  return out.sort((a, b) => a.daysUntil - b.daysUntil);
}

/** Marks milestones achieved when first met. Weight uses the 7-day average, not a single weigh-in. */
export function evaluateMilestones(db: DB, today: ISODate): Milestone[] {
  const newly: Milestone[] = [];
  const w7 = windowAverage(weightPoints(db, '0000-01-01', today), today, 7);
  for (const m of listMilestones(db)) {
    if (m.achieved_date || m.target_value == null) continue;
    let current: number | null = null;
    if (m.metric === 'weight') current = w7;
    else if (['abdomen', 'lower_waist', 'chest', 'arms', 'thighs', 'neck', 'hips'].includes(m.metric)) {
      current = latestMeasurement(db, m.metric as BodyMetric, today)?.value ?? null;
    }
    if (current == null) continue;
    const met = m.direction === 'below' ? current < m.target_value : current > m.target_value;
    if (met) {
      setMilestoneAchieved(db, m.id, today);
      newly.push({ ...m, achieved_date: today });
    }
  }
  return newly;
}

export function nextMilestones(db: DB, today: ISODate) {
  const settings = getSettings(db);
  const w = weightSummary(db, today);
  const ab = latestMeasurement(db, 'abdomen', today);
  const week = weekConsistency(db, today, settings);
  const pending = listMilestones(db).filter((m) => !m.achieved_date);
  const out: { title: string; detail: string; progress: number | null }[] = [];

  const nearest = (metric: string, current: number | null | undefined, unit: string) => {
    if (current == null) return;
    const m = pending.filter((x) => x.metric === metric && x.target_value != null && x.direction === 'below' && x.target_value < current)
      .sort((a, b) => b.target_value! - a.target_value!)[0];
    if (m) out.push({ title: m.title, detail: `${round(current - m.target_value!, 1)} ${unit} to go`, progress: null });
  };
  nearest('abdomen', ab?.value, 'in');
  nearest('weight', w.avg7 ?? w.latest?.value, 'lb');

  if (week.strength.done < week.strength.target) {
    out.push({ title: `Complete ${week.strength.target} strength sessions this week`, detail: `${week.strength.done} of ${week.strength.target} done`, progress: week.strength.done / week.strength.target });
  }
  const pAvg = mean(week.protein.byDay.filter((d) => d.date < today || d.logged).map((d) => d.protein));
  if (pAvg == null || pAvg < settings.proteinMin) {
    out.push({ title: `Average ${settings.proteinMin}+ g protein`, detail: pAvg != null ? `Averaging ${Math.round(pAvg)} g this week` : 'No protein logged yet this week', progress: pAvg != null ? Math.min(1, pAvg / settings.proteinMin) : 0 });
  }
  const sl = sleepSummary(db, today, settings);
  if (sl.avg7 == null || sl.avg7 < settings.sleepGoalMin) {
    out.push({ title: `Average ${settings.sleepGoalMin / 60} hours sleep`, detail: sl.avg7 != null ? `7-day average ${Math.floor(sl.avg7 / 60)}h ${String(Math.round(sl.avg7 % 60)).padStart(2, '0')}m` : 'Log sleep to track this', progress: sl.avg7 != null ? Math.min(1, sl.avg7 / settings.sleepGoalMin) : null });
  }
  return out;
}

/** Only suggests reviewing the program in the situations the plan calls for. */
export function programReviewSuggestions(db: DB, today: ISODate): string[] {
  const settings = getSettings(db);
  const profile = getProfile(db);
  const out: string[] = [];
  const plan = getActivePlan(db);
  const planStart = plan.created_at.slice(0, 10) > profile.program_start_date ? plan.created_at.slice(0, 10) : profile.program_start_date;
  const weeks = Math.floor(daysBetween(planStart, today) / 7);
  if (weeks >= 8) out.push(`You've followed this program for ${weeks} weeks. It's a reasonable time to review it — or keep going if progress is steady.`);

  for (const ex of loggedExercises(db)) {
    const recent = exerciseHistory(db, ex.id).slice(-3);
    if (recent.length === 3 && recent.filter((h) => h.progression.status === 'reduce').length >= 2) {
      out.push(`${ex.name} has declined in 2 of the last 3 sessions. Consider holding the load, checking setup, or swapping the variation.`);
    }
  }

  const rec = listRecovery(db, addDays(today, -13), today).filter((r) => r.knee_pain != null);
  if (rec.length >= 3 && rec.filter((r) => (r.knee_pain ?? 0) >= 5).length >= 3) {
    out.push('Knee discomfort has been elevated on several recent check-ins. Consider reviewing which movements aggravate it and choosing lower-impact options.');
  }

  if (programWeek(profile.program_start_date, today) >= 3) {
    const lastTwo = completedSessions(db, addDays(startOfWeek(today), -14), addDays(startOfWeek(today), -1)).filter((s) => s.kind === 'strength').length;
    if (lastTwo < settings.weeklyTargets.strength) {
      out.push(`Only ${lastTwo} strength session${lastTwo === 1 ? '' : 's'} in the last two full weeks. If the schedule isn't fitting your life, it may be worth simplifying it.`);
    }
  }
  return out;
}

/**
 * Knee discomfort relative to the recent average — informational only, never diagnostic.
 * Call BEFORE saving the new check-in so it compares against prior entries.
 */
export function kneeCheck(db: DB, today: ISODate, value: number | null) {
  if (value == null) return null;
  const prior = listRecovery(db, addDays(today, -28), today).map((r) => r.knee_pain).filter((v): v is number => v != null);
  const avg = mean(prior);
  const elevated = value >= 6 || (avg != null && prior.length >= 3 && value >= avg + 2);
  return elevated
    ? 'Knee discomfort is higher than your recent average. Consider lower-impact options and reducing movements that aggravate it.'
    : null;
}

export function dashboardData(db: DB, today: ISODate) {
  evaluateMilestones(db, today);
  const settings = getSettings(db);
  const profile = getProfile(db);
  const plan = getActivePlan(db);
  const todayDay: WorkoutDay | null = plan.days.find((d) => d.weekday === weekdayIndex(today)) ?? null;
  const todaysSessions = all<SessionRow & { status: string }>(db, "SELECT id, date, kind, title, status FROM workout_session WHERE date = ? AND status != 'abandoned' ORDER BY id", today);
  const protein = proteinDays(db, today, today, settings)[0];
  return {
    today,
    profile,
    settings,
    week: programWeek(profile.program_start_date, today),
    todayDay,
    todaysSessions,
    activeSession: getActiveSession(db) ?? null,
    weight: weightSummary(db, today),
    abdomen: measurementSummary(db, 'abdomen', today),
    protein: { today: protein.protein, min: settings.proteinMin, max: settings.proteinMax },
    sleep: sleepSummary(db, today, settings),
    consistency: weekConsistency(db, today, settings),
    scoreboard: recompScoreboard(db, today),
    due: measurementsDue(db, today),
    milestones: nextMilestones(db, today),
    review: programReviewSuggestions(db, today),
  };
}
