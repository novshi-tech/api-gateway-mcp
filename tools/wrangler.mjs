#!/usr/bin/env node
// デプロイの設定 deployments/<名前>.jsonc を渡して wrangler を呼ぶ（docs/adr/0029）。
// deployments/ はこのリポジトリの git の管理外。デプロイする人の private リポジトリを clone する。
//
//   pnpm run deploy <名前> [wrangler deploy のオプション]（pnpm deploy は pnpm の組み込みなので run を付ける）
//   pnpm secret <名前> put <KEY>          （list・delete も）
//   pnpm tail <名前> [--format json]
//   pnpm db:migrate <名前>                 （wrangler d1 migrations apply DB --remote）
//   node tools/wrangler.mjs <wrangler のコマンド> <名前> [オプション]
//
// 直下に wrangler.jsonc を置かないので、名前のない wrangler deploy はどこにもデプロイしない。
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALIASES = { 'd1-migrate': ['d1', 'migrations', 'apply', 'DB', '--remote'] };

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'deployments');
const [command, name, ...rest] = process.argv.slice(2);
const names = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith('.jsonc'))
      .map((f) => f.slice(0, -'.jsonc'.length))
  : [];

if (!command || !name) {
  console.error(`usage: pnpm ${command ?? '<deploy|secret|tail|db:migrate>'} <deployment> [options]`);
  console.error(
    names.length
      ? `deployments: ${names.join(', ')}`
      : 'no deployments yet: git clone <your deployments repository> deployments, or create deployments/<name>.jsonc from wrangler.example.jsonc',
  );
  process.exit(2);
}
const config = join(dir, `${name}.jsonc`);
if (!existsSync(config)) {
  console.error(`no such deployment: ${relative(root, config)}`);
  if (names.length) console.error(`deployments: ${names.join(', ')}`);
  process.exit(2);
}

const args = [...(ALIASES[command] ?? [command]), ...rest, '--config', relative(root, config)];
const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
