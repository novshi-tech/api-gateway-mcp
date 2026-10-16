import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { canonicalJson, deriveComm, fold, emptyProjections, type DomainEvent } from '../src/domain';
import { pgRepo } from '../src/store/drizzle';
import { pgliteDb } from '../scripts/lib/pglite';
import { FsRecordingStore } from '../scripts/lib/recordings';
import { ingestMetrics, listScenarios, loadScenario, runScenario, sha256, verifyScenario, type IngestMetrics } from '../scripts/lib/scenario';

// 4 シナリオを end-to-end で回す。仮説ごとにテスト名へ番号を付ける。

const names = listScenarios();

describe.each(names)('シナリオ %s', (name) => {
  const scenario = loadScenario(name);

  it(`expected.json と一致する（${scenario.config.hypotheses.join(' ')}）`, async () => {
    const run = await runScenario(scenario);
    const v = await verifyScenario(run);
    expect(v.errors).toEqual([]);
  });

  it('H1 投影を全削除してリプレイしても Task 投影のハッシュが一致し、Postgres でも同じになる', async () => {
    const mem = await runScenario(scenario);
    const memHash = await sha256(canonicalJson((await mem.service.state(scenario.config.tenant)).tasks));
    const rebuilt = await mem.service.rebuild(scenario.config.tenant);
    expect(await sha256(canonicalJson(rebuilt.tasks))).toBe(memHash);

    const { db, close } = await pgliteDb();
    try {
      const pg = await runScenario(scenario, { repo: pgRepo(db) });
      const pgState = await pg.service.state(scenario.config.tenant);
      expect(await sha256(canonicalJson(pgState.tasks))).toBe(memHash);
      await pg.repo.projections.clear(scenario.config.tenant);
      const pgRebuilt = await pg.service.state(scenario.config.tenant);
      expect(await sha256(canonicalJson(pgRebuilt.tasks))).toBe(memHash);
      expect(canonicalJson(pgRebuilt)).toBe(canonicalJson(pgState));
    } finally {
      await close();
    }
  });

  it('H1 fold は決定的（同じイベント列から何度でも同じ投影、1 件ずつ畳んでも同じ）', async () => {
    const run = await runScenario(scenario);
    const events = await run.repo.events.read(scenario.config.tenant);
    const whole = canonicalJson(fold(events));
    expect(canonicalJson(fold(events))).toBe(whole);
    const stepwise = events.reduce((p, e) => fold([e], p), emptyProjections(scenario.config.tenant));
    expect(canonicalJson(stepwise)).toBe(whole);
  });

  it('H2 通信状態は事前定義の項目だけから導出され、作業状態はカスタム属性だけで表現される', async () => {
    const run = await runScenario(scenario);
    const tenant = scenario.config.tenant;
    const p = await run.service.state(tenant);
    const events = await run.repo.events.read(tenant);

    // 属性・open/closed のイベントを抜いて畳んでも、通信状態は変わらない
    const withoutWork = fold(
      renumber(events.filter((e) => !['TaskAttributeSet', 'TaskClosed', 'TaskReopened'].includes(e.type))),
      emptyProjections(tenant),
    );
    const commOf = (t: (typeof p.tasks)[string]) => ({
      ballAt: t.ballAt,
      lastInboundAt: t.lastInboundAt,
      lastOutboundAt: t.lastOutboundAt,
      replyExpectedBy: t.replyExpectedBy,
      unansweredSince: t.unansweredSince,
      overdue: t.overdue,
    });
    for (const t of Object.values(p.tasks)) {
      expect(commOf(withoutWork.tasks[t.id]!)).toEqual(commOf(t));
      // タイムラインの事前定義の項目から deriveComm で同じものが出る
      expect(deriveComm(t.listId, p.timeline.filter((e) => e.taskId === t.id))).toEqual(commOf(t));
    }

    // 作業状態はすべて、そのリストで定義されたカスタム属性
    for (const t of Object.values(p.tasks)) {
      const defined = scenario.seed.attributeDefs.filter((d) => d.listId === t.listId).map((d) => d.name);
      for (const name of Object.keys(t.attributes)) expect(defined).toContain(name);
    }
    for (const d of scenario.seed.attributeDefs) expect(d.description.trim().length).toBeGreaterThan(0);
  });
});

/** 一部を抜いたイベント列の seq を詰め直す（fold は単調な seq を要求する） */
function renumber(events: DomainEvent[]): DomainEvent[] {
  return events.map((e, i) => ({ ...e, seq: i + 1 }));
}

describe('H4 派生のライフサイクル', () => {
  it('全シナリオで proposed → approved → sent → replied が双方向に流れ、内部派生は sent を経ない', async () => {
    let internal = 0;
    let external = 0;
    let reverse = 0;
    for (const name of names) {
      const run = await runScenario(loadScenario(name));
      const tenant = run.scenario.config.tenant;
      const p = await run.service.state(tenant);
      const events = await run.repo.events.read(tenant);
      for (const d of Object.values(p.derivations)) {
        const types = events
          .filter((e) => 'derivationId' in e.payload && e.payload.derivationId === d.id)
          .map((e) => e.type);
        if (d.mode === 'internal') {
          internal++;
          expect(types).not.toContain('DerivationSent');
          expect(d.sentRef).toBeNull();
        } else {
          external++;
          expect(types.indexOf('DerivationApproved')).toBeLessThan(types.indexOf('DerivationSent'));
        }
        if (d.replyToDerivationId) reverse++;
      }
    }
    expect(internal).toBeGreaterThan(0);
    expect(external).toBeGreaterThan(0);
    // 返事の派生（逆向き）も流れている
    expect(reverse).toBeGreaterThan(0);
  });
});

describe('H5 観測された送信の重複排除', () => {
  it('修繕見積: echoObserved で戻った送信がすべて既存の DerivationSent に統合される', async () => {
    const run = await runScenario(loadScenario('repair-estimate'));
    const merged = run.records.flatMap((r) => r.cron?.ingested ?? []).filter((i) => i.status === 'merged');
    const events = await run.repo.events.read('ubs');
    expect(merged).toHaveLength(events.filter((e) => e.type === 'DerivationSent').length);
    expect(events.filter((e) => e.type === 'SignalObservedSent')).toHaveLength(0);
  });
});

// ---- H6 ----

describe('H6 Ingest', () => {
  it('アンカーで決まったものはすべて正解ラベルと一致し、無視は全件理由付きで残る', async () => {
    for (const name of names) {
      const run = await runScenario(loadScenario(name));
      const m = await ingestMetrics(run);
      expect(m.anchor.correct).toBe(m.anchor.total);
      const p = await run.service.state(run.scenario.config.tenant);
      for (const e of p.ignoreLog) expect(e.reason.trim()).not.toBe('');
    }
  });

  const withRecordings = names.filter((n) => new FsRecordingStore(join(loadScenario(n).dir, 'recordings')).count() > 0);

  it.skipIf(withRecordings.length < names.length)(
    'Claude の判断（再生モード）が目標値を超える: アンカー込み 90%、AI 判断のみ 80%',
    async () => {
      const total: IngestMetrics = { total: 0, correct: 0, anchor: { total: 0, correct: 0 }, ai: { total: 0, correct: 0 }, mismatches: [], confidences: [] };
      for (const name of withRecordings) {
        const run = await runScenario(loadScenario(name), { decider: { kind: 'ai', mode: 'replay', model: 'claude-sonnet-5-5' } });
        const m = await ingestMetrics(run);
        total.total += m.total;
        total.correct += m.correct;
        total.anchor.total += m.anchor.total;
        total.anchor.correct += m.anchor.correct;
        total.ai.total += m.ai.total;
        total.ai.correct += m.ai.correct;
      }
      expect(total.correct / total.total).toBeGreaterThanOrEqual(0.9);
      expect(total.ai.correct / total.ai.total).toBeGreaterThanOrEqual(0.8);
    },
  );
});
