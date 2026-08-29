import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['api/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'api/src/routes/simulation.ts',
        'api/src/routes/insurance.ts',
        'api/src/routes/compliance.ts',
        'api/src/routes/reputation.ts',
        'api/src/services/**/*.ts',
        'api/src/middleware/**/*.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
