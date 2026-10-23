import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';
import { pgRepo, type Db } from '../src/store/drizzle';
import { loadScenario } from './lib/scenario';
import { parseUserMap, renameUsers } from './lib/seed';

// DATABASE_URL=... pnpm seed <scenario> [--user <seed の User ID>=<ゲートウェイの User ID>]...
// 実環境（Neon）の DB を空にして（イベント・投影・ダミーのキューも）、fixtures/<scenario>/seed.json を入れる。
// マスタはテナントをまたいで 1 組なので、シナリオは 1 つずつ回す（H7）

const TABLES = ['events', 'projection_meta', 'threads', 'signals', 'dummy_queue'];

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
    console.log(`${name}: users=${seed.users.map((u) => u.id).join(',')}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  // drizzle は Postgres のエラーを cause に包むので、原因までたどって出す（接続文字列は出さない）
  for (let err: unknown = e; err; err = err instanceof Error ? err.cause : undefined) {
    const code = (err as { code?: string }).code;
    console.error(err instanceof Error ? `${err.message}${code ? ` (code ${code})` : ''}` : err);
  }
  process.exitCode = 1;
});
