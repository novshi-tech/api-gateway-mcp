import Anthropic from '@anthropic-ai/sdk';
import { AnthropicLlm } from '../src/ingest/llm';
import { pgRepo } from '../src/store/drizzle';
import { pgliteDb } from './lib/pglite';
import { listScenarios, loadScenario, runScenario, verifyScenario, type DeciderMode } from './lib/scenario';

// pnpm scenario run <name|all> [--ai replay|record|rerecord] [--db memory|pglite]
// pnpm scenario verify <name|all> [...]   expected.json と比較し、H1 のリプレイ比較も行う

const USAGE = 'usage: pnpm scenario <run|verify> <name|all> [--ai replay|record|rerecord] [--db memory|pglite] [--model <id>]';

async function main() {
  const [cmd, target, ...rest] = process.argv.slice(2);
  if (!cmd || !target || !['run', 'verify'].includes(cmd)) throw new Error(USAGE);
  const flag = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const aiMode = flag('ai') as 'replay' | 'record' | 'rerecord' | undefined;
  const model = flag('model') ?? process.env.CLAUDE_MODEL ?? 'claude-sonnet-5-5';
  const decider: DeciderMode = aiMode
    ? {
        kind: 'ai',
        mode: aiMode,
        model,
        live: aiMode === 'replay' ? undefined : new AnthropicLlm(new Anthropic()),
      }
    : { kind: 'hint' };

  const names = target === 'all' ? listScenarios() : [target];
  let failed = false;
  for (const name of names) {
    const scenario = loadScenario(name);
    let close: (() => Promise<void>) | undefined;
    let repo;
    if (flag('db') === 'pglite') {
      const db = await pgliteDb();
      close = db.close;
      repo = pgRepo(db.db);
    }
    const run = await runScenario(scenario, { repo, decider });
    const p = await run.service.state(scenario.config.tenant);
    console.log(`\n# ${name}（${scenario.config.title}） ${scenario.config.hypotheses.join(' ')} [${scenario.config.status}]`);
    console.log(`  steps=${scenario.steps.length} events=${p.lastSeq} threads=${Object.keys(p.threads).length}`);
    if (cmd === 'verify') {
      const v = await verifyScenario(run);
      const pct = (c: number, t: number) => (t === 0 ? '-' : `${((100 * c) / t).toFixed(1)}% (${c}/${t})`);
      console.log(`  H1 replay: ${v.replayHashMatches ? 'OK' : 'NG'} thread-hash=${v.threadHash.slice(0, 16)}`);
      const who = decider.kind === 'hint' ? 'ヒント' : 'AI';
      const m = v.metrics;
      console.log(
        `  H6 ingest: 全体 ${pct(m.correct, m.total)} / 構造の区切り ${pct(m.structural.correct, m.structural.total)} / ${who}の区切り ${pct(m.ai.correct, m.ai.total)} / 求めているか ${pct(m.needsResponse.correct, m.needsResponse.total)}`,
      );
      if (m.confidences.length) console.log(`  confidence: ${m.confidences.map((c) => c.toFixed(2)).join(' ')}`);
      if (v.errors.length) {
        failed = true;
        for (const e of v.errors) console.log(`  ✗ ${e}`);
      } else console.log('  ✓ expected.json と一致');
    }
    await close?.();
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
