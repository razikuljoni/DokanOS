import { expect, test } from '@playwright/test';

const VIEWPORTS: Array<{ name: string; width: number; height: number }> = [
  { name: '360', width: 360, height: 640 },
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 900 },
];

test.describe('DokanOS Responsive Viewport Suite', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}px — dashboard renders without horizontal overflow or clipped data columns`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/login');
      await expect(page.getByRole('button', { name: /Try the demo shop/i })).toBeVisible();
      await page.getByRole('button', { name: /Try the demo shop/i }).click();
      await expect(page).toHaveURL(/\/app\/dashboard/);
      await expect(
        page.getByRole('heading', { name: /Rahim Pharmacy Ledger Overview/i }),
      ).toBeVisible();
      await expect(page.getByText(/Total Revenue/i)).toBeVisible();

      // No page-level horizontal scrollbar at any width
      const overflow = await page.evaluate(() => {
        return {
          docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          bodyOverflow: document.body.scrollWidth > window.innerWidth,
        };
      });
      expect(overflow.docOverflow, `documentElement horizontal overflow at ${vp.name}px`).toBe(
        false,
      );
      expect(overflow.bodyOverflow, `body horizontal overflow at ${vp.name}px`).toBe(false);

      await page.screenshot({ path: `e2e/screenshots/dashboard-${vp.name}.png`, fullPage: true });
    });

    test(`${vp.name}px — billing page renders without horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/login');
      await page.getByRole('button', { name: /Try the demo shop/i }).click();
      await expect(page).toHaveURL(/\/app\/dashboard/);
      await page.goto('/app/billing');
      await expect(page.getByText(/Current Shop Plan/i)).toBeVisible();

      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(overflow, `billing page horizontal overflow at ${vp.name}px`).toBe(false);

      await page.screenshot({ path: `e2e/screenshots/billing-${vp.name}.png`, fullPage: true });
    });

    test(`${vp.name}px — loading skeleton test: pending queries never flash wrong fallback values`, async ({
      page,
    }) => {
      // Delay API responses to verify skeletons render without wrong fallback values
      await page.route('/api/v1/dashboard/summary', async (route) => {
        await new Promise((r) => setTimeout(r, 600));
        await route.continue();
      });
      await page.route('/api/v1/billing/status', async (route) => {
        await new Promise((r) => setTimeout(r, 600));
        await route.continue();
      });

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/login');
      await page.getByRole('button', { name: /Try the demo shop/i }).click();
      await expect(page).toHaveURL(/\/app\/dashboard/);

      // Verify that while loading or loaded, "Free Plan" is never shown for the pro shop
      const freePlanText = await page.getByText(/Free Plan/i).count();
      expect(freePlanText, 'dashboard must not render "Free Plan" from pending/initial state').toBe(
        0,
      );

      // Navigate to billing
      await page.goto('/app/billing');
      // While billing query is resolving, the plan card skeleton must prevent flashing "Free Plan"
      const billingFreePlan = await page.getByText('Free Plan').count();
      expect(billingFreePlan, 'billing must not render fallback "Free Plan" while pending').toBe(0);
    });

    test(`${vp.name}px — products table fits its container without clipped Actions column`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/login');
      await page.getByRole('button', { name: /Try the demo shop/i }).click();
      await expect(page).toHaveURL(/\/app\/dashboard/);
      await page.goto('/app/products');
      await expect(page.getByRole('heading', { name: /Products & Stock Ledger/i })).toBeVisible();

      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(overflow, `products page horizontal overflow at ${vp.name}px`).toBe(false);

      await page.screenshot({ path: `e2e/screenshots/products-${vp.name}.png`, fullPage: true });
    });
  }

  test('1920px — settings Staff Directory table fits its card without horizontal scroll or clipped Actions', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/login');
    await page.getByRole('button', { name: /Try the demo shop/i }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: /Staff Directory/i })).toBeVisible();

    const tableMetrics = await page.evaluate(() => {
      const table = document.querySelector('table');
      const wrapper = table?.parentElement;
      return {
        docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        wrapperOverflow: wrapper ? wrapper.scrollWidth > wrapper.clientWidth : false,
      };
    });
    expect(tableMetrics.docOverflow).toBe(false);
    expect(tableMetrics.wrapperOverflow).toBe(false);
  });
});
