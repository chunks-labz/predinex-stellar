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
    await expect(page).toHaveURL(/\\/pools\\//);

    // Verify pool title is visible
    await expect(page.locator('h1')).toBeVisible();
  });

  test('places a bet through the wizard', async ({ page }) => {
    await page.goto('/markets');

    // Wait for markets to load
    await expect(page.locator('li')).toBeVisible();

    // Open first pool
    await page.click('li:first-child a');
    await expect(page).toHaveURL(/\\/pools\\//);

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