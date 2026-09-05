import { test, expect } from '@playwright/test';

test('app shell loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Spindle Slayer Planner/);
  await expect(page.getByRole('heading', { name: 'Spindle Slayer Planner' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Trace' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
});

test('trace page loads', async ({ page }) => {
  await page.goto('/trace.html');
  await expect(page).toHaveTitle(/Spindle Slayer Trace/);
  await expect(page.getByRole('heading', { name: 'Spindle Slayer Trace' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Planner' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
});

test('planner links to trace and has overlay controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Trace' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Overlay DXF' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add bit' })).toBeVisible();
});
