import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/d1';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import type { Db } from '../../src/store/d1';

/** drizzle/ のマイグレーションを当てたインメモリの D1（Miniflare。本物の D1 と同じ workerd の実装） */
export async function localD1(): Promise<{ db: Db; close: () => Promise<void> }> {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {}', d1Databases: ['DB'] }));
  const d1 = (await mf.getD1Database('DB')) as unknown as D1Database;
  const dir = join(import.meta.dirname, '../../drizzle');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of readFileSync(join(dir, file), 'utf8').split('--> statement-breakpoint')) {
      if (stmt.trim()) await d1.prepare(stmt).run();
    }
  }
  return { db: drizzle(d1), close: () => mf.dispose() };
}
