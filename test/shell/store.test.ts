import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson, draft } from '../../src/domain';
import { pgRepo } from '../../src/store/drizzle';
import { memoryRepo } from '../../src/store/memory';
import { ConcurrencyError, type Repo } from '../../src/store/types';
import { pgliteDb } from '../helpers/pglite';
import { email, EventLog, ingestPure, makeCtx, seed } from '../helpers/world';

// メモリ実装と Postgres 実装（pglite）に同じ契約テストを当てる

const AT = '2026-10-16T09:00:00.000Z';
let closeDb: (() => Promise<void>) | undefined;
const impls: [string, () => Promise<Repo>][] = [
  ['memory', async () => memoryRepo()],
  [
    'postgres',
    async () => {
      const { db, close } = await pgliteDb();
      closeDb = close;
      return pgRepo(db);
    },
  ],
];

describe.each(impls)('Repo 契約（%s）', (_name, make) => {
  let repo: Repo;
  beforeAll(async () => {
    repo = await make();
  });
  afterAll(async () => {
    await closeDb?.();
    closeDb = undefined;
  });

  it('append した列が read でそのまま戻る（seq は tenant ごとに 1 から）', async () => {
    const a = await repo.events.append('t1', 0, [draft('TaskClosed', { taskId: 'x' }), draft('TaskReopened', { taskId: 'x' })], AT);
    const b = await repo.events.append('t2', 0, [draft('TaskClosed', { taskId: 'y' })], AT);
    expect(a.map((e) => e.seq)).toEqual([1, 2]);
    expect(b[0]!.seq).toBe(1);
    expect(await repo.events.read('t1')).toEqual(a);
    expect(await repo.events.read('t1', 1)).toEqual([a[1]]);
    expect(await repo.events.read('nobody')).toEqual([]);
  });

  it('期待した seq と違えば ConcurrencyError（楽観ロック）', async () => {
    await expect(repo.events.append('t1', 0, [draft('TaskClosed', { taskId: 'x' })], AT)).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(repo.events.append('t1', 5, [draft('TaskClosed', { taskId: 'x' })], AT)).rejects.toBeInstanceOf(ConcurrencyError);
    expect(await repo.events.append('t1', 2, [], AT)).toEqual([]);
    expect((await repo.events.read('t1')).length).toBe(2);
  });

  it('不正な payload は append できない', async () => {
    await expect(repo.events.append('t3', 0, [{ type: 'TaskClosed', payload: {} } as never], AT)).rejects.toThrow();
  });

  it('投影は保存・読み出しで同じものが戻り、clear で消える', async () => {
    const log = new EventLog();
    const ctx = makeCtx(AT);
    ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r1', anchors: { messageId: '<m1>' } }), () => ({
      decision: 'new',
      task_id: null,
      list_id: 'l_cust',
      title: '雨漏り',
      reason: 'r',
      confidence: 0.9,
    }));
    ingestPure(log, ctx, email({ from: 'ad@x', sourceRef: 'r2' }), () => ({
      decision: 'ignore',
      task_id: null,
      list_id: null,
      title: null,
      reason: '広告',
      confidence: 0.99,
    }));
    const p = log.state();
    await repo.projections.save(p);
    expect(canonicalJson(await repo.projections.load('ubs'))).toBe(canonicalJson(p));
    // 上書き保存も同じ
    await repo.projections.save(p);
    expect(canonicalJson(await repo.projections.load('ubs'))).toBe(canonicalJson(p));
    await repo.projections.clear('ubs');
    expect(await repo.projections.load('ubs')).toBeNull();
  });

  it('マスタを丸ごと入れ替えて読み出せる', async () => {
    await repo.master.replaceSeed(seed);
    expect(await repo.master.loadSeed()).toEqual(seed);
  });
});
