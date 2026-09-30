import { expect, test } from '@playwright/test';
import { onboard, pinToday } from './helpers';

test('research protocol: opt-in, manual schedule, bulk edit, record, dashboard card', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop flow');
  await pinToday(page);
  await onboard(page);

  // Off by default: no nav entry, no dashboard card.
  await expect(page.getByRole('link', { name: 'Research' })).toHaveCount(0);

  await page.goto('settings/');
  const section = page.locator('form', { has: page.getByRole('radiogroup', { name: 'Research protocol section' }) }).last();
  await page.getByRole('radiogroup', { name: 'Research protocol section' }).getByRole('radio', { name: 'On', exact: true }).click();
  await section.getByLabel('Compound name').fill('Compound X');
  await section.getByRole('button', { name: 'Save' }).click();
  await expect(section.getByText('Saved')).toBeVisible();

  await page.locator('aside').getByRole('link', { name: 'Research' }).click();
  await expect(page.getByRole('heading', { name: 'Research Protocol' })).toBeVisible();
  await expect(page.getByRole('note').first()).toHaveText(
    'Compound X is investigational and is not FDA-approved. Schedule information shown here is user-entered and is not a dosing recommendation.');

  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Add week' }).click();
  const amounts = page.getByLabel('Protocol amount (mg)');
  await expect(amounts).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(amounts.nth(i)).toHaveValue(''); // never auto-filled

  // Individual edit
  await amounts.nth(0).fill('1.5');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByLabel('Protocol amount (mg)').nth(0)).toHaveValue('1.5');
  await expect(page.getByLabel('Protocol amount (mg)').nth(1)).toHaveValue('');

  // Bulk edit weeks 2–3 with a value the user types
  await page.getByLabel('Select week 2').check();
  await page.getByLabel('Select week 3').check();
  await page.getByLabel('Protocol amount for selected entries (mg)').fill('2.5');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByLabel('Protocol amount (mg)').nth(1)).toHaveValue('2.5');
  await expect(page.getByLabel('Protocol amount (mg)').nth(2)).toHaveValue('2.5');
  await expect(page.getByLabel('Protocol amount (mg)').nth(0)).toHaveValue('1.5');

  // Record week 1 with optional observations
  await page.getByRole('button', { name: 'Record', exact: true }).first().click();
  const sheet = page.locator('dialog[open]');
  await sheet.getByLabel('Body weight (lb)').fill('211');
  await sheet.getByRole('group', { name: /Nausea/ }).getByRole('button', { name: '2', exact: true }).click();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Recorded', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Weight 211 lb · Nausea 2\/10/)).toBeVisible();

  // Nothing on the page frames the amount as a recommendation.
  await expect(page.locator('main')).not.toContainText(/recommended dose|suggested dose|you should take/i);

  await page.goto('./');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Research protocol' }) });
  await expect(card).toContainText('Current week1');
  await expect(card).toContainText('1.5 mg');
  await expect(card).toContainText('Oct 5');
  await expect(card.getByRole('note')).toContainText('not a dosing recommendation');
  await card.getByRole('link', { name: 'View schedule' }).click();
  await expect(page.getByRole('heading', { name: 'Research Protocol' })).toBeVisible();
});
