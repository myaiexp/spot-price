// CLI entry point for price collection. Compiled to dist/collector.js and run
// directly by the spot-price-collector systemd timer (live collect) and the
// `npm run backfill` script. The collection/backfill logic itself lives in the
// side-effect-free library modules under src/collectors/ — this file only wires
// env + DB and dispatches. `main` is exported and the CLI is isMainModule-guarded
// so importing this module in tests never triggers a collect.
//
// Usage: `tsx src/collector.ts`                  live 15-min collect
//        `tsx src/collector.ts --backfill`        full history backfill
//        `tsx src/collector.ts --backfill=DATE`   resume from Helsinki midnight of DATE
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDb } from './db/connection.js';
import { collectPrices } from './collectors/spot-hinta.js';
import { backfillPrices } from './collectors/sahkotin.js';
import { parseBackfillArg } from './collectors/backfill-arg.js';
import { projectEnvPath } from './utils/project-env.js';

/** Optional seams so tests can drive dispatch without a real DB or network. */
export interface CollectorMainDeps {
  env?: NodeJS.ProcessEnv;
  createDb?: typeof createDb;
  collectPrices?: typeof collectPrices;
  backfillPrices?: typeof backfillPrices;
}

/**
 * Parse argv, open the DB only when a valid collect/backfill is requested, and
 * return an exit code. Never calls process.exit — the CLI wrapper below does.
 * Invalid --backfill dates and a missing DATABASE_URL both return 1 without
 * opening a connection, so a bad flag cannot walk sahkotin into Helsinki today.
 */
export async function main(
  argv: string[] = process.argv,
  deps: CollectorMainDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const makeDb = deps.createDb ?? createDb;
  const collect = deps.collectPrices ?? collectPrices;
  const backfill = deps.backfillPrices ?? backfillPrices;

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    return 1;
  }

  const parsed = parseBackfillArg(argv);
  if (parsed.kind === 'invalid') {
    console.error(
      `Invalid --backfill date: "${parsed.dateStr}" — use an ISO date, e.g. --backfill=2024-01-01`,
    );
    return 1;
  }

  const db = makeDb(databaseUrl);

  try {
    if (parsed.kind === 'backfill') {
      const result = await backfill(
        db,
        parsed.walkBackFrom ? { walkBackFrom: parsed.walkBackFrom } : {},
      );
      console.log(`Backfill complete: ${result.totalUpserted} total rows upserted`);
    } else {
      const result = await collect(db);
      console.log(`Collection complete: ${result.upserted} rows upserted`);
    }
    return 0;
  } catch (err) {
    console.error('Operation failed:', err instanceof Error ? err.message : err);
    return 1;
  }
}

// CLI entry: run directly with `node dist/collector.js` (prod / systemd timer)
// or `tsx src/collector.ts` (dev). Guarded so importing this module (vitest)
// does not trigger a collect or process.exit.
const currentFile = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && resolve(process.argv[1]) === currentFile;

if (isMainModule) {
  config({ path: projectEnvPath(import.meta.url) });
  process.exit(await main());
}
