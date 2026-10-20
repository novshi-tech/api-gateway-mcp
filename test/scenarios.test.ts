import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { canonicalJson, deriveComm, emptyProjections, fold, type DomainEvent } from '../src/domain';
import { pgRepo } from '../src/store/drizzle';
import { pgliteDb } from '../scripts/lib/pglite';
import { FsRecordingStore } from '../scripts/lib/recordings';
import { addMetrics, emptyMetrics, ingestMetrics, listScenarios, loadScenario, runScenario, sha256, verifyScenario } from '../scripts/lib/scenario';

// 4 シナリオを end-to-end で回す。仮説ごとにテスト名へ番号を付ける。

const names = listScenarios();

describe.each(names)('シナリオ %s', (name) => {
  const scenario = loadScenario(name);

  it(`expected.json と一致する（${scenario.config.hypotheses.join(' ')}）`, async () => {
    const run = await runScenario(scenario);
    const v = await verifyScenario(run);
    expect(v.errors).toEqual([]);
  });

  it('H1 投影を全削除してリプレイしてもスレッドの投影のハッシュが一致し、Postgres でも同じになる', async () => {
    const mem = await runScenario(scenario);
    const memHash = await sha256(canonicalJson((await mem.service.state(scenario.config.tenant)).threads));
    const rebuilt = await mem.service.rebuild(scenario.config.tenant);
    expect(await sha256(canonicalJson(rebuilt.threads))).toBe(memHash);

    const { db, close } = await pgliteDb();
    try {
      const pg = await runScenario(scenario, { repo: pgRepo(db) });
      const pgState = await pg.service.state(scenario.config.tenant);
      expect(await sha256(canonicalJson(pgState.threads))).toBe(memHash);
      await pg.repo.projections.clear(scenario.config.tenant);
      const pgRebuilt = await pg.service.state(scenario.config.tenant);
      expect(await sha256(canonicalJson(pgRebuilt.threads))).toBe(memHash);
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

  it('H1 fold は 1 段: 各スレッドの投影は、そのスレッドに綴じたものだけから決まる', async () => {
    const run = await runScenario(scenario);
    const tenant = scenario.config.tenant;
    const p = await run.service.state(tenant);
    const events = await run.repo.events.read(tenant);
    for (const t of Object.values(p.threads)) {
      // スレッドのログだけからボールが同じに導出できる
      const { ball, dismissed, lastInboundAt, lastOutboundAt } = deriveComm(t.log);
      expect({ ball, dismissed, lastInboundAt, lastOutboundAt }).toEqual({ ball: t.ball, dismissed: t.dismissed, lastInboundAt: t.lastInboundAt, lastOutboundAt: t.lastOutboundAt });
      // 他のスレッドだけに関わるイベントを抜いて畳んでも、このスレッドの投影は変わらない
      // （seq は抜けがあってよい。単調であればよい）
      const mine = events.filter((e) => touches(e, t.id, events));
      expect(canonicalJson(fold(mine, emptyProjections(tenant)).threads[t.id])).toBe(canonicalJson(t));
    }
  });
});

/**
 * そのスレッドに関わるイベントか。そのスレッドに一度でも入ったシグナルの置き先の判断は全部残し、
 * そのシグナルが一時的に置かれた他のスレッドは、作った判断だけ残す（移し替えの元として存在が要るため）
 */
function touches(e: DomainEvent, threadId: string, all: readonly DomainEvent[]): boolean {
  const threadedOf = (signalId: string) =>
    all.filter((x): x is Extract<DomainEvent, { type: 'SignalThreaded' }> => x.type === 'SignalThreaded' && x.payload.signalId === signalId);
  const ours = new Set(
    all.flatMap((x) => (x.type === 'SignalThreaded' && x.payload.thread.threadId === threadId ? [x.payload.signalId] : [])),
  );
  const visited = new Set([...ours].flatMap((id) => threadedOf(id).map((x) => x.payload.thread.threadId)));
  switch (e.type) {
    case 'SignalObserved':
      return true; // シグナルの観測は置き先を決める前提（索引）なので全部残す
    case 'SignalThreaded':
      return ours.has(e.payload.signalId) || (e.payload.thread.kind === 'new' && visited.has(e.payload.thread.threadId));
    case 'ThreadDismissed':
    case 'ThreadReopened':
      return e.payload.threadId === threadId;
  }
}

// ---- H6 ----

describe('H6 Ingest', () => {
  it('H6 構造で決まった区切りはすべて正解ラベルと一致し、どのシグナルもどこかのスレッドに入る', async () => {
    for (const name of names) {
      const run = await runScenario(loadScenario(name));
      const m = ingestMetrics(run);
      expect(m.structural.correct).toBe(m.structural.total);
      const p = await run.service.state(run.scenario.config.tenant);
      for (const s of Object.values(p.signals)) expect(s.threadId).not.toBeNull();
      const events = await run.repo.events.read(run.scenario.config.tenant);
      for (const e of events) if (e.type === 'SignalThreaded') expect(e.payload.reason.trim()).not.toBe('');
    }
  });

  const withRecordings = names.filter((n) => new FsRecordingStore(join(loadScenario(n).dir, 'recordings')).count() > 0);

  it.skipIf(withRecordings.length < names.length)(
    'H6 Claude の判断（再生モード）が目標値を超える: アンカー込み 90%、AI 判断のみ 80%',
    async () => {
      const total = emptyMetrics();
      for (const name of withRecordings) {
        const run = await runScenario(loadScenario(name), { decider: { kind: 'ai', mode: 'replay', model: 'claude-sonnet-5-5' } });
        addMetrics(total, ingestMetrics(run));
      }
      expect(total.correct / total.total).toBeGreaterThanOrEqual(0.9);
      expect(total.ai.correct / total.ai.total).toBeGreaterThanOrEqual(0.8);
    },
  );
});
