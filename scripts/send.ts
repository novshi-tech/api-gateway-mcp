import { createHmac } from 'node:crypto';
import { loadScenario } from './lib/scenario';

// WEBHOOK_SECRET=... pnpm send <scenario> <signal の id>... [--url <本体の URL>]
// fixtures/<scenario>/signals.jsonl の signal 行を、実環境の Webhook（POST /webhooks/dummy/{tenant}）に 1 件ずつ流す（H7）。
// action 行と cron 行は流さない（スタンドの操作と見回りは実環境で起こす）。受信時刻は本体の時計になる

const DEFAULT_URL = 'https://murmur-dev.nose-0d2.workers.dev';

async function main() {
  const args = process.argv.slice(2);
  const urlAt = args.indexOf('--url');
  const base = urlAt >= 0 ? args.splice(urlAt, 2)[1] : (process.env.MURMUR_URL ?? DEFAULT_URL);
  const [name, ...ids] = args;
  if (!name || ids.length === 0) throw new Error('usage: pnpm send <scenario> <signal の id>... [--url <本体の URL>]');
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) throw new Error('WEBHOOK_SECRET がない');

  const scenario = loadScenario(name);
  for (const id of ids) {
    const step = scenario.steps.find((s) => s.id === id);
    if (!step || !('signal' in step)) throw new Error(`${name}: signal 行 ${id} がない`);
    const body = JSON.stringify([step.signal]);
    const res = await fetch(`${base}/webhooks/dummy/${scenario.config.tenant}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-murmur-signature': createHmac('sha256', secret).update(body).digest('hex') },
      body,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${id}: ${res.status} ${text}`);
    console.log(`${id}: ${text}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
