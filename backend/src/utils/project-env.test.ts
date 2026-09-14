// Pins projectEnvPath: both entry points (index.ts API, collector.ts CLI) load
// the project-root .env by file location, not cwd (finding #7935, #9956).
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { projectEnvPath } from './project-env.js';

describe('projectEnvPath', () => {
  it('resolves the project-root .env from src/ and dist/ entries, not backend/.env', () => {
    // `npm run dev`, `npm run backfill`, and both systemd units run with
    // cwd=backend/, where backend/.env does not exist.
    for (const entry of [
      'file:///repo/backend/src/index.ts',
      'file:///repo/backend/dist/index.js',
      'file:///repo/backend/src/collector.ts',
      'file:///repo/backend/dist/collector.js',
    ]) {
      expect(projectEnvPath(entry)).toBe('/repo/.env');
    }
  });

  it('points at this checkout\'s root .env for a real src/ entry', () => {
    const entry = new URL('../index.ts', import.meta.url).href;
    expect(projectEnvPath(entry)).toBe(
      fileURLToPath(new URL('../../../.env', import.meta.url)),
    );
  });
});
