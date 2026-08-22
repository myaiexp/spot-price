// CLI entry point for price collection. Compiled to dist/collector.js and run
// directly by the spot-price-collector systemd timer (live collect) and the
// `npm run backfill` script. The collection/backfill logic itself lives in the
// side-effect-free library modules under src/collectors/ — this file only wires
// env + DB and dispatches, so importing the library never triggers a CLI run.
//
// Usage: `tsx src/collector.ts`                  live 15-min collect
//        `tsx src/collector.ts --backfill`        full history backfill
//        `tsx src/collector.ts --backfill=DATE`   resume from Helsinki midnight of DATE
import { config } from 'dotenv';
import { createDb } from './db/connection.js';
import { collectPrices } from './collectors/spot-hinta.js';
import { backfillPrices } from './collectors/sahkotin.js';
import { parseBackfillArg } from './collectors/backfill-arg.js';

config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const db = createDb(databaseUrl);

const backfill = parseBackfillArg(process.argv);

try {
  if (backfill.kind === 'invalid') {
    console.error(
      `Invalid --backfill date: "${backfill.dateStr}" — use an ISO date, e.g. --backfill=2024-01-01`,
    );
    process.exit(1);
  } else if (backfill.kind === 'backfill') {
    const result = await backfillPrices(
      db,
      backfill.walkBackFrom ? { walkBackFrom: backfill.walkBackFrom } : {},
    );
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
