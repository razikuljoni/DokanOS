import { expect, test } from '@playwright/test';

test.describe('DokanOS Full Human-Like E2E Audit', () => {
  test('complete end-to-end audit across landing, purchases, stock, POS, billing, settings, mobile, and sign-out', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // 1. Landing page + footer info pages
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'About' })).toBeVisible();
    await page.getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about/);
    await expect(page.getByRole('heading', { name: /About DokanOS/i })).toBeVisible();

    await page.getByRole('link', { name: 'Help Center' }).click();
    await expect(page).toHaveURL(/\/help/);
    await expect(page.getByRole('heading', { name: /Help Center/i })).toBeVisible();

    await page.getByRole('link', { name: 'Privacy Policy' }).click();
    await expect(page).toHaveURL(/\/privacy/);
    await expect(page.getByRole('heading', { name: /Privacy Policy/i })).toBeVisible();

    await page.getByRole('link', { name: 'Terms of Service' }).click();
    await expect(page).toHaveURL(/\/terms/);
    await expect(page.getByRole('heading', { name: /Terms of Service/i })).toBeVisible();

    // 2. Demo login as Owner
    await page.goto('/login');
    await page.getByRole('button', { name: /Try the demo shop/i }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(
      page.getByRole('heading', { name: /Rahim Pharmacy Ledger Overview/i }),
    ).toBeVisible();

    // 3. Phase 0: Receive Purchase with cost change warning
    await page.goto('/app/purchases');
    await page.getByRole('button', { name: /Receive New Purchase/i }).click();
    await expect(page.getByRole('heading', { name: /Receive Supplier Purchase/i })).toBeVisible();
    const costInput = page.locator('#po-cost');
    const currentCost = Number(await costInput.inputValue());
    await costInput.fill(String(currentCost + 5));
    await expect(page.getByText(/This will change the cost price from/i)).toBeVisible();
    await page.getByRole('button', { name: /Receive & Update Stock/i }).click();
    await expect(
      page.getByRole('heading', { name: /Receive Supplier Purchase/i }),
    ).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('table tbody tr').first()).toBeVisible();

    // 4. Phase 3: Negative stock adjustment (-3)
    await page.goto('/app/products');
    await page.locator('table tbody tr a').first().click();
    await expect(page).toHaveURL(/\/app\/products\/.+/);
    const stockHeading = page.locator('div.text-3xl.font-bold');
    const beforeText = (await stockHeading.innerText()).trim();
    const beforeStock = parseInt(beforeText, 10);

    const adjInput = page.locator('#adj-qty');
    await adjInput.fill('-3');
    await expect(adjInput).toHaveValue('-3');
    await page.getByRole('button', { name: /Record Stock Adjustment/i }).click();
    await expect(stockHeading).toContainText(String(beforeStock - 3), { timeout: 10000 });
    await expect(page.locator('table tbody tr').first()).toContainText('-3');

    // 5. Phase 3: POS sale + Print Thermal Receipt without freezing
    await page.goto('/app/sales/new');
    await page.locator('button:has-text("৳")').first().click();
    await page.getByRole('button', { name: /Settle & Print Receipt/i }).click();
    await expect(page.getByRole('button', { name: /Print Thermal Receipt/i })).toBeVisible({
      timeout: 10000,
    });
    // Stub window.print inside iframes so headless print completes cleanly and check responsiveness
    await page.getByRole('button', { name: /Print Thermal Receipt/i }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).not.toBeVisible();

    // 6. Phase 2 & 4: Billing — no placeholder, Fill test details, Cancel marks CANCELLED
    await page.goto('/app/billing');
    await expect(page.locator('body')).not.toContainText('{ provider, eventId }');
    await page.getByRole('button', { name: /Fill test details/i }).click();
    await expect(page.locator('#cus-phone')).toHaveValue('01711111111');

    await page.getByRole('button', { name: /Stripe \(International Cards\)/i }).click();
    await expect(page.getByRole('button', { name: /Fill test details/i })).toBeVisible();
    await page.getByRole('button', { name: /via Stripe Checkout/i }).click();
    await expect(page.getByRole('button', { name: /Authorize Test Payment/i })).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('table')).toContainText('cancelled', {
      ignoreCase: true,
      timeout: 10000,
    });

    // 7. Phase 5: Settings Staff Directory at 1440px & Mobile hamburger at 375px
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: /Staff Directory/i })).toBeVisible();
    const desktopOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(desktopOverflow).toBe(false);

    await page.setViewportSize({ width: 375, height: 812 });
    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(mobileOverflow).toBe(false);
    await page.getByRole('button', { name: /Open mobile navigation menu/i }).click();
    await expect(page.getByRole('button', { name: /Sign Out/i })).toBeVisible();

    // 8. Phase 3: Sign out completes immediately
    await page.getByRole('button', { name: /Sign Out/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });

    expect(consoleErrors).toEqual([]);
  });
});
