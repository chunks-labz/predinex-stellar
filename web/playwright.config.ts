/**
 * Playwright Configuration for PrediNx E2E Tests
 *
 * Supports headless Chromium and Firefox in CI.
 * WebKit is optional and can be enabled if needed.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  workers: process.env.CI ? 1 : 4,

  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],

  use: {
    baseURL: process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,

    // Chromium settings
    channel: 'chrome', // Use system Chrome; override in CI if needed

    // Device emulation (desktop by default)
    ...devices['Desktop Chrome'],
  },

  // CI configuration
  projects: [
    {
      name: 'Chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
    {
      name: 'Firefox',
      use: {
        ...devices['Desktop Firefox'],
        headless: true,
      },
    },
  ],

  // Run your experimental features enabled here.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});