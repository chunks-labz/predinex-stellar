/**
 * E2E Tests: Wallet Connection
 *
 * Mocks the wallet bridge; verifies connect, disconnect, and address badge rendering.
 */

import { test, expect, } from '@playwright/test';

test.describe('Wallet Connection', () => {
  test('connects wallet and renders address badge', async ({ page }) => {
    await page.goto('/');

    // Click connect wallet button
    await page.click('button[aria-label="Connect Wallet"]');

    // Wait for wallet modal to appear
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Select a wallet (WalletConnect option should be available)
    await page.click('button[data-id="walletconnect"]');

    // Modal should close after selection
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();

    // Address badge should be rendered
    await expect(page.locator('.text-primary')).toContainText('Connected');
    await expect(page.locator('[aria-label*="Connect using"]')).toBeVisible();
  });

  test('disconnects wallet', async ({ page }) => {
    await page.goto('/');

    // Connect wallet first
    await page.click('button[aria-label="Connect Wallet"]');
    await page.click('button[data-id="walletconnect"]');

    // Verify connected state
    await expect(page.locator('.text-primary')).toBeVisible();

    // Click disconnect
    await page.click('text=Disconnect');

    // Address badge should be cleared
    await expect(page.locator('.text-primary')).not.toBeVisible({ timeout: 5000 });
  });
});