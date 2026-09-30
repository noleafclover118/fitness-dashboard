import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { onboard, pinToday } from './helpers';

// One shared browser context = one phone: data carries over between steps, like real use.
test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }, workerInfo) => {
  const context = await browser.newContext({ baseURL: workerInfo.project.use.baseURL, viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await pinToday(context);
  page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
});

const spin = (p: Page, name: string) => p.getByRole('spinbutton', { name, exact: true });
const sheet = (p: Page) => p.locator('dialog[open]');

async function quickLog(page: Page, tab: string) {
  await page.getByRole('button', { name: 'Quick log' }).click();
  await page.getByRole('tab', { name: tab }).click();
}

test('first run: enter a baseline, then see the dashboard', async () => {
  await onboard(page);
  await expect(page.getByRole('heading', { name: 'Monday, September 28' })).toBeVisible();
  const main = page.locator('main');
  await expect(main).toContainText('212lb');
  await expect(main).toContainText('44"');
  await expect(main).toContainText('0/ 140 g');
  await expect(main).toContainText('5h 30m');
  await expect(main.getByRole('heading', { name: 'Full Body A' })).toBeVisible();
  await expect(main.getByText('Collecting baseline data', { exact: false })).toBeVisible();
  await expect(main.getByText('Due in 14 days')).toBeVisible();
});

test('weight, measurement, protein and sleep entry', async () => {
  await page.goto('./');
  await quickLog(page, 'Weight');
  await page.getByLabel('Weight (lb)').fill('210.6');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Weight saved')).toBeVisible();

  await quickLog(page, 'Protein');
  await page.getByLabel('Protein (g)').fill('45');
  await page.getByLabel('What was it? (optional)').fill('Greek yogurt');
  await sheet(page).getByRole('button', { name: 'Add protein' }).click();
  await expect(page.getByText('Added 45 g protein')).toBeVisible();
  await expect(page.locator('main').getByText('95 g')).toBeVisible(); // 140 - 45 to minimum

  await quickLog(page, 'Sleep');
  await page.getByLabel('Hours').fill('6');
  await page.getByLabel('Minutes').fill('20');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Sleep saved — 6h 20m')).toBeVisible();

  await quickLog(page, 'Measure');
  await page.getByLabel('Abdomen (belly button) (in)').fill('43.5');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Measurements saved')).toBeVisible();

  await page.reload();
  const main = page.locator('main');
  await expect(main.getByText('43.5')).toBeVisible();
  await expect(main.getByText('6h 20m').first()).toBeVisible();

  await page.goto('nutrition/');
  await expect(page.getByText('Greek yogurt')).toBeVisible();
});

test('workout: start, log sets, survive reload, resume, finish', async () => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForURL(/\/workout\/\?id=\d+/);
  const url = page.url();

  // optional check-in with elevated knee discomfort → gentle, non-diagnostic message
  await page.getByRole('button', { name: '7', exact: true }).first().click(); // knee scale (0–10) — first "7"
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/higher than your recent average/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('button', { name: /Save 10 min/ }).click(); // warm-up
  await expect(page.getByRole('heading', { name: 'Leg Press' })).toBeVisible();

  for (let i = 0; i < 3; i++) {
    if (i === 0) await spin(page, 'Weight (lb)').fill('110');
    await spin(page, 'Reps').fill('12');
    await page.getByRole('button', { name: 'Complete set' }).click();
    await expect(page.getByText(`Set ${i + 1}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip', exact: true }).last().click(); // dismiss rest timer
  }
  await expect(page.getByText('So far today')).toBeVisible();
  await expect(page.getByText('Ready to progress').first()).toBeVisible();

  // Close the browser tab mid-workout and come back
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Leg Press' })).toBeVisible();
  await expect(page.getByText('110 lb × 12').first()).toBeVisible();
  await expect(page.locator('ol[aria-label="Completed sets"] li')).toHaveCount(3);

  await page.goto('./');
  await expect(page.getByRole('link', { name: /Full Body A in progress/ })).toBeVisible();
  await page.getByRole('link', { name: /Full Body A in progress/ }).click();
  await expect(page).toHaveURL(url);

  await page.getByRole('button', { name: 'Next exercise' }).click();
  await expect(page.getByRole('heading', { name: 'Seated Leg Curl' })).toBeVisible();
  // substitution for this session only
  await page.getByRole('button', { name: 'Swap' }).click();
  await page.getByRole('button', { name: /Romanian Deadlift/ }).click();
  await expect(page.getByRole('heading', { name: 'Romanian Deadlift' })).toBeVisible();
  await spin(page, 'Weight (lb)').fill('30');
  await spin(page, 'Reps').fill('10');
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByText('30 lb × 10')).toBeVisible();

  await page.getByRole('button', { name: 'Finish', exact: true }).first().click();
  await page.getByPlaceholder(/Energy was good/).fill('Knee felt fine on the leg press');
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.waitForURL(/\/history\/view\/\?id=\d+&done=1/);
  await expect(page.getByText('Workout saved')).toBeVisible();
  await expect(page.getByText('Ready to progress').first()).toBeVisible();
});

test('works with no connection once installed (service worker)', async () => {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.context().setOffline(true);
  try {
    await page.goto('./');
    await expect(page.getByRole('heading', { name: 'Monday, September 28' })).toBeVisible();
    await page.reload(); // a cold open with no signal
    await expect(page.getByRole('heading', { name: 'Monday, September 28' })).toBeVisible();
    await page.goto('today/?day=2');
    await page.getByRole('button', { name: /Start Full Body B today/ }).click();
    await page.waitForURL(/\/workout\/\?id=\d+/);
    await page.getByRole('button', { name: 'Leg Press' }).click();
    await spin(page, 'Weight (lb)').fill('100');
    await spin(page, 'Reps').fill('11');
    await page.getByRole('button', { name: 'Complete set' }).click();
    await page.getByRole('button', { name: 'Skip', exact: true }).last().click();
    await page.reload();
    await expect(page.getByText('100 lb × 11')).toBeVisible();
    await page.getByRole('button', { name: 'Finish', exact: true }).first().click();
    await page.getByRole('button', { name: 'Discard workout' }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await page.waitForURL(/fitness-dashboard\/$/);
  } finally {
    await page.context().setOffline(false);
  }
});

test('editing a completed workout', async () => {
  await page.goto('history/');
  await page.getByRole('link', { name: /Full Body A/ }).first().click();
  const firstReps = page.locator('input[inputmode="numeric"]').first();
  await firstReps.fill('10');
  await page.getByRole('button', { name: 'Save set 1' }).first().click();
  await expect(page.getByRole('button', { name: 'Save set 1' })).toHaveCount(0); // saved
  await page.reload();
  await expect(page.locator('input[inputmode="numeric"]').first()).toHaveValue('10');
  await expect(page.getByText('Knee felt fine')).toBeVisible();
});

test('notes are searchable', async () => {
  await page.goto('history/?q=knee');
  await expect(page.getByText('Knee felt fine on the leg press').first()).toBeVisible();
});

test('weekly summary and progress charts render', async () => {
  await page.goto('progress/');
  await expect(page.getByText('Weekly review')).toBeVisible();
  await expect(page.getByText('1 / 3').first()).toBeVisible();
  await expect(page.getByRole('img', { name: 'Daily protein intake' })).toBeVisible();
  for (const r of ['7 days', '90 days', 'All time']) {
    await page.getByRole('link', { name: r }).click();
    await expect(page.getByRole('link', { name: r })).toHaveAttribute('aria-current', 'page');
  }
});

test('CSV export, JSON backup, restore and undo', async ({}, info) => {
  await page.goto('settings/');
  const csvDl = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Workouts (every set)' }).click()]).then(([d]) => d);
  const csv = fs.readFileSync((await csvDl.path())!, 'utf8');
  expect(csv.split('\n')[0]).toContain('date,workout,status,exercise');
  expect(csv).toContain('Leg Press');
  const mDl = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Measurements' }).click()]).then(([d]) => d);
  expect(fs.readFileSync((await mDl.path())!, 'utf8')).toContain('abdomen,43.5,in,manual');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up data' }).click()]);
  const file = info.outputPath('backup.json');
  await download.saveAs(file);
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(backup.app).toBe('fitness-dashboard');
  expect(backup.tables.set_log.length).toBeGreaterThan(0);

  // delete a data point, then restore from the backup to bring it back
  await page.goto('nutrition/');
  await page.getByRole('button', { name: /Delete Greek yogurt/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Greek yogurt')).toHaveCount(0);

  await page.goto('settings/');
  const bad = info.outputPath('bad.json');
  fs.writeFileSync(bad, JSON.stringify({ hello: 'world' }));
  await page.locator('input[type=file][accept*="json"]').setInputFiles(bad);
  await expect(page.getByText(/can’t be restored/)).toBeVisible();

  await page.locator('input[type=file][accept*="json"]').setInputFiles(file);
  await expect(page.getByText('Restore this backup?')).toBeVisible();
  await page.getByRole('button', { name: 'Replace & restore' }).click();
  await expect(page.getByText(/Backup restored/)).toBeVisible();
  await page.goto('nutrition/');
  await expect(page.getByText('Greek yogurt')).toBeVisible();

  // undo the restore → the deletion comes back
  await page.goto('settings/');
  await page.getByRole('button', { name: 'Undo restore' }).click();
  await expect(page.getByText('Previous data put back.')).toBeVisible();
  await page.goto('nutrition/');
  await expect(page.getByText('Greek yogurt')).toHaveCount(0);
});

test('sample preview is separate and removable', async () => {
  await page.goto('settings/');
  await page.getByRole('button', { name: 'View sample preview' }).click();
  await expect(page.getByText('Sample preview.', { exact: false })).toBeVisible({ timeout: 30_000 });
  // Settings now shows the sample's own profile (program started 8 weeks earlier).
  await expect(page.getByLabel('Program start date')).toHaveValue('2026-08-03');
  await page.goto('./'); // mode is remembered across page loads
  await expect(page.locator('main').getByText('Week 9', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to my data' }).first().click();
  await expect(page.getByText('Sample preview.', { exact: false })).toHaveCount(0);
  await expect(page.locator('main').getByText('Week 1', { exact: false })).toBeVisible();
  await page.goto('settings/');
  await page.getByRole('button', { name: 'Remove sample data' }).click();
  await expect(page.getByText('Sample data removed.')).toBeVisible();
});
