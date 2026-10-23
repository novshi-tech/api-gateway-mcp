import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenario } from './lib/scenario';
import { parseUserMap, renameUsers, seedSql } from './lib/seed';

// pnpm seed <scenario> [--env dev|prod] [--local] [--user <seed の User ID>=<ゲートウェイの User ID>]...
// 実環境の D1 を空にして（イベント・投影・ダミーのキューも）、fixtures/<scenario>/seed.json を入れる。
// SQL を作って wrangler d1 execute で流す（Cloudflare の認証は wrangler のもの）。シナリオは 1 つずつ回す（H7）

function main() {
  const [name, ...rest] = process.argv.slice(2);
  if (!name || name.startsWith('--')) {
    throw new Error('usage: pnpm seed <scenario> [--env dev|prod] [--local] [--user <seed の User ID>=<ゲートウェイの User ID>]...');
  }
  const envAt = rest.indexOf('--env');
  const env = envAt >= 0 ? rest[envAt + 1] : 'dev';
  if (env !== 'dev' && env !== 'prod') throw new Error('--env は dev か prod');
  const seed = renameUsers(loadScenario(name).seed, parseUserMap(rest));

  const dir = mkdtempSync(join(tmpdir(), 'murmur-seed-'));
  try {
    const file = join(dir, 'seed.sql');
    writeFileSync(file, seedSql(seed));
    execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--env', env, rest.includes('--local') ? '--local' : '--remote', `--file=${file}`], {
      stdio: 'inherit',
    });
    console.log(`${name}: users=${seed.users.map((u) => u.id).join(',')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
