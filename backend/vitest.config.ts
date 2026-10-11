// Vitest config: coverage floor over backend src and the frontend JS it tests.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// frontend/js lives outside this root (backend/). v8 needs allowExternal to keep
// it at all, and matches `include` against each file's *absolute* path, so a
// relative '../frontend/js/**' never matches — resolve the directory instead.
const FRONTEND_JS = fileURLToPath(new URL('../frontend/js', import.meta.url));

// Fully covered. Shared so the per-file floors below stay one list, not ten
// copies of the same four numbers.
const covered = { statements: 100, branches: 100, functions: 100, lines: 100 };

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      allowExternal: true,
      include: ['src/**/*.ts', `${FRONTEND_JS}/**/*.js`],
      exclude: ['**/*.test.ts', 'src/test-support/**'],
      // Global ratchet, floored to 0.1 from the measured 97.97 / 92.54 / 97.59 /
      // 99.12 (vitest 4.1.11 v8). Branches moved up by the null-rowCount case
      // (finding #12154). Raise when coverage grows; never lower to pass.
      //
      // The other keys are per-file floors for the pure price and Helsinki-time
      // modules, plus the query layer (finding #12153). A combined glob would
      // hide a drop in one file the way the global number does. `src/queries/**`
      // is the exception: its floor is 100, so any uncovered statement, branch,
      // or function in that directory fails. Vitest matches these globs against
      // paths relative to backend/, so frontend files are `../frontend/js/...`,
      // not the absolute include path above.
      thresholds: {
        statements: 97.9,
        branches: 92.5,
        functions: 97.5,
        lines: 99.1,
        '../frontend/js/calc.js': {
          statements: 96.5,
          branches: 95.1,
          functions: 100,
          lines: 100,
        },
        '../frontend/js/estimator-calc.js': {
          statements: 95.5,
          branches: 94.5,
          functions: 100,
          lines: 100,
        },
        '../frontend/js/slot-time.js': {
          statements: 100,
          branches: 97,
          functions: 100,
          lines: 100,
        },
        '../frontend/js/hero-calc.js': covered,
        '../frontend/js/heatmap-calc.js': covered,
        '../frontend/js/insights-calc.js': covered,
        '../frontend/js/format.js': covered,
        '../frontend/js/chart-series.js': covered,
        'src/queries/**': covered,
        'src/utils/price-conversion.ts': covered,
        'src/utils/helsinki-time.ts': covered,
      },
    },
  },
});
