/**
 * The starting program and targets used to seed a brand-new database. Personal
 * baseline numbers are entered on the first-run screen, not stored in code.
 *
 * Editing this file only affects NEW databases. To change the program you are
 * already using, use Workouts → Edit program in the app (history is preserved
 * because every logged session keeps its own snapshot).
 */

export type ExerciseCategory = 'strength' | 'cardio' | 'mobility' | 'core';

export interface ExerciseDef {
  name: string;
  category: ExerciseCategory;
  equipment?: string;
  bodyweight?: boolean;
  substitutes?: string[];
}

export interface PrescriptionDef {
  exercise: string;
  sets: [number, number]; // [min, max]
  reps: [number, number];
  label?: string;
}

export interface WorkoutDayDef {
  weekday: number; // 0 = Monday
  code: string;
  title: string;
  subtitle: string;
  kind: 'strength' | 'cardio' | 'recovery' | 'long_cardio' | 'rest';
  estMinutes: number;
  duration?: [number, number];
  intensity?: string;
  description?: string;
  warmup?: { label: string; minutes: [number, number]; intensity: string };
  finisher?: { label: string; minutes: [number, number]; optional?: boolean };
  modalities?: string[];
  mobility?: string[];
  exercises?: PrescriptionDef[];
}

/** Starting point entered on the first-run screen (weight lb, lengths in). Never hard-coded. */
export interface Baseline {
  name?: string;
  age?: number | null;
  sex?: string | null;
  heightIn?: number | null;
  weightLb: number;
  abdomenIn?: number | null;
  lowerWaistIn?: number | null;
  chestIn?: number | null;
  sleepMin?: number | null;
}

export const DEFAULT_SETTINGS = {
  proteinMin: 140,
  proteinMax: 160,
  sleepGoalMin: 390, // minutes (6.5 h)
  sleepGoalMax: 420, // 7 h+
  restTimerSec: 90,
  restTimerAuto: true,
  weightUnit: 'lb' as 'lb' | 'kg',
  lengthUnit: 'in' as 'in' | 'cm',
  showMacros: false,
  /** False until the first-run screen has been completed. */
  onboarded: false,
  weeklyTargets: { strength: 3, cardio: 2, recovery: 2 },
  /** Reminder cadence in days. */
  reminders: { weight: 1, abdomen: 14, lower_waist: 21, chest: 28, photos: 28 },
};
export type Settings = typeof DEFAULT_SETTINGS;

/** Starter milestones from the baseline: five 5-lb weight steps and five 1-inch abdomen steps. */
export function starterMilestones(b: Baseline) {
  const out: { metric: string; title: string; target: number }[] = [];
  const w0 = Math.floor((b.weightLb - 3) / 5) * 5; // e.g. 212 → 205, 200 … 185
  for (let i = 0; i < 5; i++) out.push({ metric: 'weight', title: `Weight below ${w0 - 5 * i} lb`, target: w0 - 5 * i });
  if (b.abdomenIn) {
    const a0 = Math.ceil(b.abdomenIn) - 1;
    for (let i = 0; i < 5; i++) out.push({ metric: 'abdomen', title: `Abdomen below ${a0 - i}"`, target: a0 - i });
  }
  return out;
}

const MOBILITY = [
  'Hip flexor stretch — 30 s each side',
  'Hamstring stretch — 30 s each side',
  'Calf stretch — 30 s each side',
  'Figure-4 glute stretch — 30 s each side',
  'Cat-cow — 8 slow reps',
  'Thoracic open-book — 6 each side',
  'Doorway chest stretch — 30 s',
];

export const EXERCISES: ExerciseDef[] = [
  // Lower body
  { name: 'Leg Press', category: 'strength', equipment: 'Machine', substitutes: ['Hack Squat', 'Goblet Squat', 'Smith Machine Squat'] },
  { name: 'Seated Leg Curl', category: 'strength', equipment: 'Machine', substitutes: ['Lying Leg Curl', 'Romanian Deadlift', 'Glute Bridge', 'Hip Thrust Machine', 'Cable Pull-Through'] },
  { name: 'Lying Leg Curl', category: 'strength', equipment: 'Machine', substitutes: ['Seated Leg Curl', 'Romanian Deadlift'] },
  { name: 'Romanian Deadlift', category: 'strength', equipment: 'Dumbbells', substitutes: ['Seated Leg Curl', 'Cable Pull-Through', 'Glute Bridge'] },
  { name: 'Glute Bridge', category: 'strength', equipment: 'Bodyweight / dumbbell', substitutes: ['Hip Thrust Machine', 'Cable Pull-Through'] },
  { name: 'Hip Thrust Machine', category: 'strength', equipment: 'Machine', substitutes: ['Glute Bridge', 'Cable Pull-Through'] },
  { name: 'Cable Pull-Through', category: 'strength', equipment: 'Cable' },
  { name: 'Hack Squat', category: 'strength', equipment: 'Machine' },
  { name: 'Goblet Squat', category: 'strength', equipment: 'Dumbbell' },
  { name: 'Smith Machine Squat', category: 'strength', equipment: 'Smith machine' },
  // Push
  { name: 'Chest Press', category: 'strength', equipment: 'Machine', substitutes: ['Dumbbell Bench Press', 'Smith Machine Bench Press', 'Incline Push-up'] },
  { name: 'Incline Chest Press', category: 'strength', equipment: 'Machine', substitutes: ['Incline Dumbbell Press', 'Chest Press'] },
  { name: 'Dumbbell Bench Press', category: 'strength', equipment: 'Dumbbells' },
  { name: 'Incline Dumbbell Press', category: 'strength', equipment: 'Dumbbells' },
  { name: 'Smith Machine Bench Press', category: 'strength', equipment: 'Smith machine' },
  { name: 'Incline Push-up', category: 'strength', equipment: 'Bodyweight', bodyweight: true },
  { name: 'Shoulder Press', category: 'strength', equipment: 'Machine', substitutes: ['Dumbbell Shoulder Press', 'Lateral Raise'] },
  { name: 'Dumbbell Shoulder Press', category: 'strength', equipment: 'Dumbbells' },
  { name: 'Lateral Raise', category: 'strength', equipment: 'Dumbbells' },
  { name: 'Triceps Pressdown', category: 'strength', equipment: 'Cable / machine', substitutes: ['Overhead Triceps Extension', 'Triceps Dip Machine'] },
  { name: 'Overhead Triceps Extension', category: 'strength', equipment: 'Dumbbell' },
  { name: 'Triceps Dip Machine', category: 'strength', equipment: 'Machine' },
  // Pull
  { name: 'Seated Row', category: 'strength', equipment: 'Machine', substitutes: ['Cable Row', 'One-Arm Dumbbell Row', 'Chest-Supported Row'] },
  { name: 'Cable Row', category: 'strength', equipment: 'Cable' },
  { name: 'One-Arm Dumbbell Row', category: 'strength', equipment: 'Dumbbell' },
  { name: 'Chest-Supported Row', category: 'strength', equipment: 'Machine / dumbbells' },
  { name: 'Lat Pulldown', category: 'strength', equipment: 'Machine', substitutes: ['Assisted Pull-up', 'Straight-Arm Pulldown', 'One-Arm Dumbbell Row'] },
  { name: 'Assisted Pull-up', category: 'strength', equipment: 'Machine' },
  { name: 'Straight-Arm Pulldown', category: 'strength', equipment: 'Cable' },
  { name: 'Biceps Curl', category: 'strength', equipment: 'Dumbbells / machine', substitutes: ['Hammer Curl', 'Cable Curl', 'Machine Biceps Curl'] },
  { name: 'Hammer Curl', category: 'strength', equipment: 'Dumbbells' },
  { name: 'Cable Curl', category: 'strength', equipment: 'Cable' },
  { name: 'Machine Biceps Curl', category: 'strength', equipment: 'Machine' },
  // Core
  { name: 'Abdominal Crunch Machine', category: 'core', equipment: 'Machine', substitutes: ['Cable Crunch', 'Dead Bug', 'Plank'] },
  { name: 'Dead Bug', category: 'core', equipment: 'Bodyweight', bodyweight: true, substitutes: ['Abdominal Crunch Machine', 'Pallof Press', 'Bird Dog', 'Cable Crunch'] },
  { name: 'Cable Crunch', category: 'core', equipment: 'Cable' },
  { name: 'Pallof Press', category: 'core', equipment: 'Cable / band' },
  { name: 'Bird Dog', category: 'core', equipment: 'Bodyweight', bodyweight: true },
  { name: 'Plank', category: 'core', equipment: 'Bodyweight', bodyweight: true },
  // Cardio modalities
  { name: 'Recumbent Bike', category: 'cardio', substitutes: ['Stationary Bike', 'Elliptical', 'Outdoor Bicycle'] },
  { name: 'Stationary Bike', category: 'cardio', substitutes: ['Recumbent Bike', 'Elliptical', 'Outdoor Bicycle'] },
  { name: 'Elliptical', category: 'cardio', substitutes: ['Recumbent Bike', 'Stationary Bike'] },
  { name: 'Outdoor Bicycle', category: 'cardio', substitutes: ['Stationary Bike', 'Recumbent Bike'] },
  { name: 'Walking', category: 'cardio', substitutes: ['Recumbent Bike', 'Stationary Bike'] },
];

export const CARDIO_MODALITIES = ['Recumbent Bike', 'Stationary Bike', 'Elliptical', 'Outdoor Bicycle', 'Walking'];

const bikeWarmup = { label: 'Recumbent / stationary bike', minutes: [8, 10] as [number, number], intensity: 'Easy' };

export const PROGRAM: { name: string; days: WorkoutDayDef[] } = {
  name: 'Recomp Foundation — 3× Full Body',
  days: [
    {
      weekday: 0, code: 'A', title: 'Full Body A', subtitle: 'Strength + easy cardio', kind: 'strength', estMinutes: 55,
      warmup: bikeWarmup,
      finisher: { label: 'Easy bike', minutes: [10, 15] },
      exercises: [
        { exercise: 'Leg Press', sets: [3, 3], reps: [8, 12] },
        { exercise: 'Seated Leg Curl', sets: [3, 3], reps: [10, 12] },
        { exercise: 'Chest Press', sets: [3, 3], reps: [8, 12] },
        { exercise: 'Seated Row', sets: [3, 3], reps: [8, 12] },
        { exercise: 'Lat Pulldown', sets: [3, 3], reps: [8, 12] },
        { exercise: 'Shoulder Press', sets: [2, 2], reps: [10, 12] },
        { exercise: 'Abdominal Crunch Machine', sets: [2, 3], reps: [10, 15] },
      ],
    },
    {
      weekday: 1, code: 'CARDIO', title: 'Cardio + Mobility', subtitle: 'Easy/moderate, conversational pace', kind: 'cardio', estMinutes: 50,
      duration: [35, 45], intensity: 'Easy / moderate — conversational',
      description: 'Steady, low-impact aerobic work. You should be able to hold a conversation throughout. Finish with mobility.',
      modalities: ['Stationary Bike', 'Recumbent Bike', 'Elliptical'], mobility: MOBILITY,
    },
    {
      weekday: 2, code: 'B', title: 'Full Body B', subtitle: 'Strength + easy cardio', kind: 'strength', estMinutes: 60,
      warmup: { ...bikeWarmup, label: 'Bike' },
      finisher: { label: 'Easy cardio', minutes: [10, 15] },
      exercises: [
        { exercise: 'Leg Press', sets: [3, 3], reps: [10, 12] },
        { exercise: 'Glute Bridge', sets: [3, 3], reps: [8, 12], label: 'Glute Bridge or Hip Thrust Machine' },
        { exercise: 'Incline Chest Press', sets: [3, 3], reps: [8, 12] },
        { exercise: 'Seated Row', sets: [3, 3], reps: [8, 12] },
        { exercise: 'Lat Pulldown', sets: [3, 3], reps: [8, 12] },
        { exercise: 'Biceps Curl', sets: [2, 2], reps: [10, 15] },
        { exercise: 'Triceps Pressdown', sets: [2, 2], reps: [10, 15] },
        { exercise: 'Dead Bug', sets: [2, 3], reps: [10, 15], label: 'Core exercise' },
      ],
    },
    {
      weekday: 3, code: 'RECOVERY_THU', title: 'Recovery Cardio + Mobility', subtitle: 'Deliberately easier than Tuesday', kind: 'recovery', estMinutes: 40,
      duration: [25, 35], intensity: 'Easy',
      description: 'Easy bike or a comfortable walk, then mobility. This should feel refreshing, not taxing.',
      modalities: ['Recumbent Bike', 'Stationary Bike', 'Walking'], mobility: MOBILITY,
    },
    {
      weekday: 4, code: 'C', title: 'Full Body C', subtitle: 'Strength + optional easy cardio', kind: 'strength', estMinutes: 60,
      warmup: { ...bikeWarmup, label: 'Bike' },
      finisher: { label: 'Easy cardio', minutes: [10, 15], optional: true },
      exercises: [
        { exercise: 'Leg Press', sets: [3, 3], reps: [8, 10] },
        { exercise: 'Romanian Deadlift', sets: [3, 3], reps: [8, 12], label: 'Romanian Deadlift or Leg Curl' },
        { exercise: 'Chest Press', sets: [3, 3], reps: [8, 10] },
        { exercise: 'Seated Row', sets: [3, 3], reps: [8, 10] },
        { exercise: 'Lat Pulldown', sets: [3, 3], reps: [8, 10] },
        { exercise: 'Shoulder Press', sets: [2, 2], reps: [10, 12] },
        { exercise: 'Biceps Curl', sets: [2, 2], reps: [10, 15] },
        { exercise: 'Triceps Pressdown', sets: [2, 2], reps: [10, 15] },
        { exercise: 'Abdominal Crunch Machine', sets: [2, 2], reps: [12, 15] },
      ],
    },
    {
      weekday: 5, code: 'LONG', title: 'Long Easy Cardio', subtitle: 'Sustained low-impact session', kind: 'long_cardio', estMinutes: 60,
      duration: [45, 60], intensity: 'Easy / moderate — sustained',
      description: 'Longer steady effort. Outdoor ride is ideal when the weather cooperates.',
      modalities: ['Outdoor Bicycle', 'Stationary Bike', 'Recumbent Bike', 'Elliptical'], mobility: MOBILITY.slice(0, 4),
    },
    {
      weekday: 6, code: 'RECOVERY_SUN', title: 'Active Recovery', subtitle: 'Very easy movement', kind: 'recovery', estMinutes: 30,
      duration: [20, 30], intensity: 'Very easy',
      description: 'Recovery, not a calorie-burning workout. Move gently and loosen up.',
      modalities: ['Walking', 'Recumbent Bike', 'Stationary Bike'], mobility: MOBILITY,
    },
  ],
};
