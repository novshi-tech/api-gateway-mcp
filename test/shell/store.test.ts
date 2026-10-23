import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson, draft } from '../../src/domain';
import { pgRepo } from '../../src/store/drizzle';
import { memoryRepo } from '../../src/store/memory';
import { ConcurrencyError, type Repo } from '../../src/store/types';
import { pgliteDb } from '../../scripts/lib/pglite';
import { answer, email, EventLog, ingestPure, makeCtx, seed } from '../helpers/world';

// メモリ実装と Postgres 実装（pglite）に同じ契約テストを当てる

const AT = '2026-10-16T09:00:00.000Z';
const dismissed = (threadId: string) => draft('ThreadDismissed', { threadId, actorUserId: 'u', reason: 'r' });
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

  it('append した列が read でそのまま戻る（seq は 1 から）', async () => {
    expect(await repo.events.read()).toEqual([]);
    const a = await repo.events.append(0, [dismissed('x'), draft('ThreadReopened', { threadId: 'x', actorUserId: 'u' })], AT);
    const b = await repo.events.append(2, [dismissed('y')], AT);
    expect(a.map((e) => e.seq)).toEqual([1, 2]);
    expect(b[0]!.seq).toBe(3);
    expect(await repo.events.read()).toEqual([...a, ...b]);
    expect(await repo.events.read(1)).toEqual([a[1], b[0]]);
    expect(await repo.events.read(3)).toEqual([]);
  });

  it('期待した seq と違えば ConcurrencyError（楽観ロック）', async () => {
    await expect(repo.events.append(0, [dismissed('x')], AT)).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(repo.events.append(5, [dismissed('x')], AT)).rejects.toBeInstanceOf(ConcurrencyError);
    expect(await repo.events.append(3, [], AT)).toEqual([]);
    expect((await repo.events.read()).length).toBe(3);
  });

  it('不正な payload は append できない', async () => {
    await expect(repo.events.append(3, [{ type: 'ThreadDismissed', payload: {} } as never], AT)).rejects.toThrow();
    expect((await repo.events.read()).length).toBe(3);
  });

  it('投影は保存・読み出しで同じものが戻り、clear で消える', async () => {
    const log = new EventLog();
    const ctx = makeCtx(AT);
    ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r1', anchors: { messageId: '<m1>' } }), () => answer({ title: '雨漏り' }));
    ingestPure(log, ctx, email({ from: 'support@ubs.example', to: ['carol@example.com'], sourceRef: 'r2', anchors: { inReplyTo: '<m1>' } }));
    ingestPure(log, ctx, email({ from: 'ad@x', sourceRef: 'r3' }), () => answer({ needs_response: false, confidence: 0.99 }));
    const p = log.state();
    await repo.projections.save(p);
    expect(canonicalJson(await repo.projections.load())).toBe(canonicalJson(p));
    // 上書き保存も同じ
    await repo.projections.save(p);
    expect(canonicalJson(await repo.projections.load())).toBe(canonicalJson(p));
    await repo.projections.clear();
    expect(await repo.projections.load()).toBeNull();
  });

  it('マスタを丸ごと入れ替えて読み出せる', async () => {
    await repo.master.replaceSeed(seed);
    expect(await repo.master.loadSeed()).toEqual(seed);
  });
});
