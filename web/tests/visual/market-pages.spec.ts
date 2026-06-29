import { test, expect } from '@playwright/test';

test.describe('Visual Regression - Market Pages & Components', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the visual regression test surface
    await page.goto('/debug/visual-regression');
    
    // Wait for components to be visible
    await page.waitForSelector('h1:has-text("Visual Regression Test Surface")');
  });

  test('Market Card Visuals', async ({ page }) => {
    const section = page.locator('#market-cards');
    await expect(section).toHaveScreenshot('market-cards.png');
  });

  test('Activity Feed Visuals', async ({ page }) => {
    const section = page.locator('#activity-feed');
    // Give a small delay for animations if any
    await page.waitForTimeout(500);
    await expect(section).toHaveScreenshot('activity-feed.png');
  });

  test('Dashboard Cards Visuals', async ({ page }) => {
    const section = page.locator('#dashboard-cards');
    await expect(section).toHaveScreenshot('dashboard-cards.png');
  });

  /*
  test('Pool Details Surface', async ({ page }) => {
    const section = page.locator('#pool-details');
    // PoolIntegration fetches data, so it might show a loader. 
    // We wait for either the loader or the content.
    await expect(section).toHaveScreenshot('pool-details-surface.png');
  });
  */
  
  test('Full Page Visual Regression', async ({ page }) => {
      // Test the entire page to ensure overall layout stability
      await expect(page).toHaveScreenshot('full-page-visual-test.png', {
          fullPage: true,
          mask: [page.locator('.animate-pulse'), page.locator('.animate-spin')] // Mask loaders to avoid flakiness
      });
  });
});
