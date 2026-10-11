// Vitest config: coverage floor over backend src and the frontend JS it tests.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// frontend/js lives outside this root (backend/). v8 needs allowExternal to keep
// it at all, and matches `include` against each file's *absolute* path, so a
// relative '../frontend/js/**' never matches — resolve the directory instead.
const FRONTEND_JS = fileURLToPath(new URL('../frontend/js', import.meta.url));

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      allowExternal: true,
      include: ['src/**/*.ts', `${FRONTEND_JS}/**/*.js`],
      exclude: ['**/*.test.ts', 'src/test-support/**'],
      // Ratchet: whole-suite coverage on 2026-10-11 (reporter 95.94 / 90.92 /
      // 96.01 / 97.11), stored at 0.1 resolution so reporter rounding cannot
      // fail the next run. Raise when coverage grows; never lower to pass.
      thresholds: {
        statements: 95.9,
        branches: 90.9,
        functions: 96,
        lines: 97.1,
      },
    },
  },
});
