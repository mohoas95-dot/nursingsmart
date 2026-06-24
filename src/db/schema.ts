import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const documents = pgTable('documents', {
  path: text('path').primaryKey(),
  data: jsonb('data').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
