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
      // Ratchet: the measured whole-suite numbers (2026-09-14, finding #9926).
      // Raise when coverage grows; never lower to make a run pass.
      thresholds: {
        statements: 92.9,
        branches: 89.4,
        functions: 92.4,
        lines: 93.8,
      },
    },
  },
});
