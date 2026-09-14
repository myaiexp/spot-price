// Project-root .env path for the entry points, resolved by file, not cwd.
import { fileURLToPath } from 'node:url';

/**
 * Project-root `.env` path from an entry file's `import.meta.url` — the entry
 * sits in `src/` (tsx) or compiled `dist/`, both two levels below the root.
 * Bare `dotenv/config` reads cwd/.env; `npm run dev`, `npm run backfill`, and
 * both systemd units run with cwd=backend/, and backend/.env does not exist
 * (finding #7935, finding #9956).
 */
export function projectEnvPath(entryUrl: string): string {
  return fileURLToPath(new URL('../../.env', entryUrl));
}
