import { test, expect } from '@playwright/test';

test('spindle preview loads with side view and 3D canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Spindle Slayer Planner/);
  await expect(page.locator('#side-wrap svg')).toBeVisible();
  await expect(page.locator('#side-wrap svg .remaining')).toBeVisible();
  await expect(page.locator('#bitPalette .bit').first()).toBeVisible();
  await expect(page.locator('#three-wrap canvas')).toBeVisible();
  await expect(page.locator('#placeLength')).toBeVisible();
  await expect(page.locator('#placeDia')).toBeVisible();
  await page.screenshot({ path: 'test-results/spindle-preview.png', fullPage: true });
});

test('can move the last cut to first', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.locator('#bitPalette [data-bit="Endmill_1_2"]').click();
  const items = page.locator('.placed-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(1).locator('.placed-main')).toContainText('Endmill_1_2');
  await items.nth(1).locator('[data-move="up"]').click();
  await expect(items.nth(0).locator('.placed-main')).toContainText('Endmill_1_2');
  await expect(items.nth(0).locator('.placed-num')).toHaveText('1');
  await expect(items.nth(1).locator('.placed-main')).toContainText('Magnate_7593');
});
