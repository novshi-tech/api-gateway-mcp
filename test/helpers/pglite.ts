import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { Db } from '../../src/store/drizzle';

/** drizzle/ のマイグレーションを当てたインメモリ Postgres */
export async function pgliteDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const dir = join(import.meta.dirname, '../../drizzle');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of readFileSync(join(dir, file), 'utf8').split('--> statement-breakpoint')) {
      if (stmt.trim()) await client.exec(stmt);
    }
  }
  return { db: drizzle(client) as unknown as Db, close: () => client.close() };
}
