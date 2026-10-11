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
      // Ratchet re-measured under vitest 4.1.11's v8 (97.97 / 92.37 / 97.59 /
      // 99.12). Branches are 0.04 below the 4.1.8 count; the other three are
      // higher. Floored to 0.1 so reporter rounding cannot fail the next run.
      // Raise when coverage grows; never lower to pass.
      thresholds: {
        statements: 97.9,
        branches: 92.3,
        functions: 97.5,
        lines: 99.1,
      },
    },
  },
});
