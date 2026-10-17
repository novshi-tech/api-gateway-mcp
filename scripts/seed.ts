import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';
import { pgRepo, type Db } from '../src/store/drizzle';
import { loadScenario } from './lib/scenario';
import { parseUserMap, renameUsers } from './lib/seed';

// DATABASE_URL=... pnpm seed <scenario> [--user <seed の User ID>=<ゲートウェイの User ID>]...
// 実環境（Neon）の DB を空にして（イベント・投影・ダミーのキューも）、fixtures/<scenario>/seed.json を入れる。
// マスタはテナントをまたいで 1 組なので、シナリオは 1 つずつ回す（H7）

const TABLES = ['events', 'projection_meta', 'tasks', 'signals', 'derivations', 'task_links', 'timeline', 'ignore_log', 'dummy_queue'];

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  if (!name || name.startsWith('--')) throw new Error('usage: pnpm seed <scenario> [--user <seed の User ID>=<ゲートウェイの User ID>]...');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL がない');
  const seed = renameUsers(loadScenario(name).seed, parseUserMap(rest));

  const pool = new Pool({ connectionString: url });
  try {
    const db = drizzle(pool) as unknown as Db;
    await db.execute(sql.raw(`TRUNCATE ${TABLES.join(', ')}`));
    await pgRepo(db).master.replaceSeed(seed);
    console.log(`${name}: tenants=${seed.tenants.map((t) => t.id).join(',')} users=${seed.users.map((u) => u.id).join(',')}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
