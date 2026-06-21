// CLI entry point for price collection. Compiled to dist/collector.js and run
// directly by the spot-price-collector systemd timer (live collect) and the
// `npm run backfill` script. The collection/backfill logic itself lives in the
// side-effect-free library modules under src/collectors/ — this file only wires
// env + DB and dispatches, so importing the library never triggers a CLI run.
//
// Usage: `tsx src/collector.ts`                  live 15-min collect
//        `tsx src/collector.ts --backfill`        full history backfill
//        `tsx src/collector.ts --backfill=DATE`   resume backfill from an ISO date
import { config } from 'dotenv';
import { createDb } from './db/connection.js';
import { collectPrices } from './collectors/spot-hinta.js';
import { backfillPrices } from './collectors/sahkotin.js';

config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const db = createDb(databaseUrl);

// `--backfill` runs a full history backfill; `--backfill=2024-01-01` resumes from
// an explicit UTC upper bound instead of re-walking from today.
const backfillArg = process.argv.find(
  (a) => a === '--backfill' || a.startsWith('--backfill='),
);

try {
  if (backfillArg) {
    let startFrom: Date | undefined;
    const eq = backfillArg.indexOf('=');
    if (eq !== -1) {
      const dateStr = backfillArg.slice(eq + 1);
      const parsed = new Date(dateStr);
      if (Number.isNaN(parsed.getTime())) {
        console.error(
          `Invalid --backfill date: "${dateStr}" — use an ISO date, e.g. --backfill=2024-01-01`,
        );
        process.exit(1);
      }
      startFrom = parsed;
    }
    const result = await backfillPrices(db, startFrom ? { startFrom } : {});
    console.log(`Backfill complete: ${result.totalUpserted} total rows upserted`);
  } else {
    const result = await collectPrices(db);
    console.log(`Collection complete: ${result.upserted} rows upserted`);
  }
  process.exit(0);
} catch (err) {
  console.error('Operation failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
