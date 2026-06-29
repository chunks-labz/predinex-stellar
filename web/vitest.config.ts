import { configDefaults, defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    exclude: [
      ...configDefaults.exclude,
      // Playwright suites are run via `npm run test:visual`, not Vitest.
      'tests/visual/**',
      '**/stacks-api.test.ts',
      '**/market-discovery-network.test.ts',
    ],
    environmentOptions: {
      jsdom: {
        url: 'http://localhost',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});


