import { expect, test } from '@playwright/test';
import { onboard, pinToday } from './helpers';

test.beforeEach(async ({ page }) => {
  await pinToday(page);
  await onboard(page);
});

const PAGES = ['./', 'today/', 'workouts/', 'progress/', 'nutrition/', 'recovery/', 'history/', 'settings/'];

test('no horizontal overflow on any page', async ({ page }) => {
  for (const p of PAGES) {
    await page.goto(p);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${p} overflows horizontally`).toBeLessThanOrEqual(1);
  }
});

test('navigation adapts to the screen', async ({ page, isMobile }) => {
  await page.goto('./');
  const bottom = page.locator('nav[aria-label="Primary"]').last();
  if (isMobile) {
    await expect(bottom.getByRole('link', { name: 'Workout' })).toBeVisible();
    await bottom.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('link', { name: 'Nutrition' })).toBeVisible();
  } else {
    await expect(page.locator('aside').getByRole('link', { name: 'Nutrition' })).toBeVisible();
    await expect(bottom).toBeHidden();
  }
});

test('appearance follows the system and can be overridden', async ({ page, colorScheme }) => {
  await page.goto('settings/');
  const html = page.locator('html');
  if (colorScheme === 'dark') await expect(html).toHaveClass(/dark/);
  else await expect(html).not.toHaveClass(/dark/);
  const group = page.locator('main').getByRole('radiogroup', { name: 'Appearance' });
  await group.getByRole('radio', { name: 'Dark' }).click();
  await expect(html).toHaveClass(/dark/);
  await page.reload();
  await expect(html).toHaveClass(/dark/);
  await page.locator('main').getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: 'Light' }).click();
  await expect(html).not.toHaveClass(/dark/);
  await page.locator('main').getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: 'System' }).click();
});

test('workout controls are large enough for one-handed use', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone only');
  await page.goto('today/?day=4');
  await page.getByRole('button', { name: /Start/ }).first().click();
  await page.waitForURL(/\/workout\/\?id=\d+/);
  await page.getByRole('button', { name: 'Leg Press' }).click();
  const box = await page.getByRole('button', { name: 'Complete set' }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(56);
  expect(box!.width).toBeGreaterThan(300);
  // clean up
  await page.getByRole('button', { name: 'Finish', exact: true }).first().click();
  await page.getByRole('button', { name: 'Discard workout' }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
});
