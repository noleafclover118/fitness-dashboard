import { expect, type BrowserContext, type Page } from '@playwright/test';

export const TODAY = '2026-09-28'; // a Monday → Full Body A

/** Pins "today" for the app before any page script runs. */
export async function pinToday(ctx: BrowserContext | Page) {
  await ctx.addInitScript((d) => localStorage.setItem('fd-today', d), TODAY);
}

/** Completes the first-run screen with a made-up test baseline. */
export async function onboard(page: Page) {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Let’s set your starting point' })).toBeVisible();
  await page.getByLabel('Age').fill('38');
  await page.getByLabel('Feet').fill('5');
  await page.getByLabel('Inches').fill('10');
  await page.getByLabel('Current weight (lb)').fill('212');
  await page.getByLabel('Abdomen').fill('44');
  await page.getByLabel('Lower waist').fill('39');
  await page.getByLabel('Chest').fill('45');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { name: 'Monday, September 28' })).toBeVisible();
}
