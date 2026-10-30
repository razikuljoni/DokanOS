import { expect, test } from '@playwright/test';

test.describe('DokanOS §9 Playwright Chromium Smoke Tests', () => {
  test('1. Demo login lands on the dashboard with Rahim Pharmacy data', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /Try the demo shop/i })).toBeVisible();
    await page.getByRole('button', { name: /Try the demo shop/i }).click();

    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByText(/Rahim Pharmacy/i).first()).toBeVisible();
    await expect(page.getByText(/Total Revenue/i)).toBeVisible();
  });

  test('2. Complete a POS sale end-to-end with Settle & Print Receipt', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /Try the demo shop/i }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);

    await page.goto('/app/sales/new');
    await expect(page.getByText(/POS Counter Terminal/i)).toBeVisible();

    // Add Sergel 20mg to cart
    await page.getByText(/Sergel 20mg/i).first().click();
    await expect(page.getByRole('button', { name: /Settle & Print Receipt/i })).toBeEnabled();

    await page.getByRole('button', { name: /Settle & Print Receipt/i }).click();
    await expect(page.getByText(/Invoice INV-/i).first()).toBeVisible();
  });

  test('3. Dashboard Recharts visualizations render', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /Try the demo shop/i }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);

    await expect(page.getByText(/Daily Revenue Trend/i)).toBeVisible();
    await expect(page.getByText(/Sales by Category/i)).toBeVisible();
    await expect(page.getByText(/Top 5 Products by Revenue/i)).toBeVisible();
  });
});
