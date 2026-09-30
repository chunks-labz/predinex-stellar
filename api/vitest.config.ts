import { defineConfig } from 'vitest/config';
import { randomBytes } from 'crypto';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts', '../oracle/src/**/*.test.ts'],
    // AUTH_SECRET is required at startup (issue #1301); tests get a random
    // per-run value so no secret is committed.
    env: {
      AUTH_SECRET: randomBytes(32).toString('hex'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/routes/**/*.ts',
        'src/services/**/*.ts',
        'src/middleware/**/*.ts',
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
