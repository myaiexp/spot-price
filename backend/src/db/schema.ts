import { pgTable, timestamp, numeric } from 'drizzle-orm/pg-core';

export const prices = pgTable('prices', {
  datetime: timestamp('datetime', { withTimezone: true, mode: 'string' }).primaryKey(),
  priceNoTax: numeric('price_no_tax', { precision: 10, scale: 5 }).notNull(),
  priceWithTax: numeric('price_with_tax', { precision: 10, scale: 5 }).notNull(),
});
