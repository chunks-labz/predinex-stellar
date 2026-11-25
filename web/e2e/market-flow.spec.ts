/**
 * E2E Tests: Market Flow
 *
 * Loads the markets list, filters pools, opens a pool, places a bet through the wizard/quick-bet,
 * verifies validation and submission state.
 */

import { test, expect } from '@playwright/test';

test.describe('Market Flow', () => {
  test('browses markets and opens a pool detail page', async ({ page }) => {
    await page.goto('/markets');

    // Wait for markets to load
    await expect(page.locator('text prediction market')).toBeVisible();

    // Click on first pool to open detail
    await page.click('li:first-child a');

    // Should navigate to pool detail page
    await expect(page).toHaveURL(/\/pools\//);

    // Verify pool title is visible
    await expect(page.locator('h1')).toBeVisible();
  });

  test('places a bet through the wizard', async ({ page }) => {
    await page.goto('/markets');

    // Wait for markets to load
    await expect(page.locator('li')).toBeVisible();

    // Open first pool
    await page.click('li:first-child a');
    await expect(page).toHaveURL(/\/pools\//);

    // Look for place bet button/option
    await expect(page.locator('text=Place Bet, button:has-text("Place Bet")')).toBeVisible();

    // Click place bet
    await page.click('button:has-text("Place Bet")');

    // Should show bet placement wizard/modal
    await expect(page.locator('[role="dialog"], .glass-panel')).toBeVisible();

    // Select an outcome
    await page.click('text=Yes'); // or outcome A

    // Place the bet
    await page.fill('input[placeholder*="amount"], input[type="number"]', '1000');

    // Submit the bet
    await page.click('button:has-text("Submit"), button:has-text("Place Bet")');

    // Wait for submission state
    await expect(page.locator('.glass-panel')).not.toBeVisible({ timeout: 10000 });

    // Should show success or validation error
    const success = await page.locator('.text-green-400, .text-primary').first().textContent();
    expect(success).toBeTruthy();
  });
});
for (const back of ['browser', 'link'] as const) {
  test(`restores the filtered page and scroll position with the ${back} back action`, async ({ page }) => {
    await page.addInitScript(() => {
      const markets = Array.from({ length: 36 }, (_, i) => ({
        poolId: i + 1, title: `Forecast ${i + 1}`, description: 'Forecast market',
        outcomeA: 'Yes', outcomeB: 'No', totalVolume: 1000 + i, oddsA: 50, oddsB: 50,
        status: i % 3 === 0 ? 'settled' : 'active', winningOutcome: null,
        timeRemaining: 3600, createdAt: i, settledAt: null, creator: 'creator',
      }));
      for (const market of markets) {
        const pool = { ...market, totalA: 500, totalB: 500, settled: market.status === 'settled',
          expiry: Math.floor(Date.now() / 1000) + 3600 };
        localStorage.setItem(`predinex_pool_${market.poolId}`, JSON.stringify({ version: 1, cachedAt: Date.now(), pool }));
      }
      localStorage.setItem('predinex_market_list_v2', JSON.stringify({ version: 2, cachedAt: Date.now(), markets }));
    });
    await page.goto('/markets?status=open&sort=volume');
    await page.getByRole('button', { name: 'Next page' }).click();
    const cards = page.getByRole('link', { name: /^View market:/ });
    const resultIds = () => cards.evaluateAll(links => links.map(link => link.getAttribute('href')));
    const expectedIds = await resultIds();
    const href = page.url();
    const card = cards.nth(6);
    await card.scrollIntoViewIfNeeded();
    const offset = await page.evaluate(() => window.scrollY);
    expect(offset).toBeGreaterThan(0);
    await card.click();
    await expect(page).toHaveURL(/\/markets\/\d+/);
    if (back === 'browser') await page.goBack();
    else await page.getByRole('link', { name: /back to markets/i }).first().click();
    await expect(page).toHaveURL(href);
    await expect.poll(resultIds).toEqual(expectedIds);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(offset, 0);
  });
}
