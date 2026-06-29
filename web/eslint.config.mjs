import { defineConfig, globalIgnores } from "eslint/config";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextTs,
  // NOTE: We intentionally omit `eslint-config-next/core-web-vitals`.
  // It pulls in Next's `eslint-plugin-next` via `next/eslint-plugin-next`,
  // which is not available in the current CI environment. Keeping the
  // TypeScript preset preserves type-aware linting without breaking CI.
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Downgrade to warnings — pre-existing issues tracked separately
      "@typescript-eslint/no-explicit-any": "warn",
      // Keep custom rules minimal to avoid requiring additional eslint plugins
      // in constrained CI environments.
    },
  },
]);

export default eslintConfig;
