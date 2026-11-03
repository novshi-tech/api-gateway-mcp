import { describe, expect, it } from 'vitest';
import { addNote, claimThread, derivedBall, dismissThread, draft, getThreadView, linkCandidates, linkThreads, listThreads, turnOf } from '../../src/domain';
import { alice, answer, bob, dir, email, EventLog, ingestPure, line, makeCtx } from '../helpers/world';

// クエリ層の「誰の番か」・リンク先から導出したボール・結び候補・タイムライン（H2・H8）

function world() {
  const log = new EventLog();
  const ctx = makeCtx();
  // support@（読者 2 人、宛先は組織）→ 仕分け待ち
  const shared = ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r1', anchors: { messageId: '<m1>', jiraKeys: ['UBS-7'] } }), () => answer({ title: '雨漏り' }));
  // support@ だが Alice 宛て（CC など）→ Alice の番
  const addressed = ingestPure(log, ctx, email({ from: 'info@dave.example', to: ['support@ubs.example', 'alice@ubs.example'], sourceRef: 'r2', anchors: { threadKey: 'UBS-7' } }), () =>
    answer({ title: '見積' }),
  );
  // LINE 公式アカウント（読者は Bob だけ）→ Bob の番
  const lineThread = ingestPure(log, ctx, line({ from: 'U_carol', sourceRef: 'l1' }), () => answer({ title: 'LINE' }));
  return { log, ctx, shared: shared.outcome!.threadId, addressed: addressed.outcome!.threadId, line: lineThread.outcome!.threadId };
}

describe('誰の番か（turnOf）', () => {
  it('H8 構造で決まる: 読者が 1 人ならその人、宛先に読者がいればその人、どれでもなければ仕分け待ち', () => {
    const { log, shared, addressed, line: l } = world();
    const p = log.state();
    expect(turnOf(dir, p, p.threads[shared]!)).toEqual({ kind: 'triage' });
    expect(turnOf(dir, p, p.threads[addressed]!)).toEqual({ kind: 'user', userIds: ['u_alice'], by: 'addressed' });
    expect(turnOf(dir, p, p.threads[l]!)).toEqual({ kind: 'user', userIds: ['u_bob'], by: 'reader' });
    expect(listThreads(dir, alice, p, { filter: 'my_turn' }).map((t) => t.id)).toEqual([addressed]);
    expect(listThreads(dir, bob, p, { filter: 'my_turn' }).map((t) => t.id)).toEqual([l]);
    expect(listThreads(dir, bob, p, { filter: 'triage' }).map((t) => t.id)).toEqual([shared]);
  });

  it('H8 持ち主の操作が構造より優先する。手放すと仕分け待ちに戻る', () => {
    const { log, shared } = world();
    log.push(claimThread(log.state(), bob, dir, { threadId: shared, userId: 'u_bob' }), '2026-10-16T10:00:00.000Z');
    let p = log.state();
    expect(turnOf(dir, p, p.threads[shared]!)).toEqual({ kind: 'user', userIds: ['u_bob'], by: 'owner' });
    expect(listThreads(dir, alice, p, { filter: 'triage' })).toEqual([]);
    expect(listThreads(dir, bob, p, { filter: 'my_turn' }).map((t) => t.id)).toContain(shared);
    log.push(claimThread(p, bob, dir, { threadId: shared, userId: null }), '2026-10-16T11:00:00.000Z');
    p = log.state();
    expect(listThreads(dir, alice, p, { filter: 'triage' }).map((t) => t.id)).toEqual([shared]);
  });

  it('H8 相手待ち・なし・片付けたスレッドは誰の番でもない', () => {
    const { log, ctx, shared } = world();
    ingestPure(log, ctx, email({ from: 'support@ubs.example', to: ['carol@example.com'], sourceRef: 'o1', anchors: { inReplyTo: '<m1>' } }));
    const p = log.state();
    expect(turnOf(dir, p, p.threads[shared]!)).toEqual({ kind: 'contact', contactIds: ['p_carol'] });
    log.push(dismissThread(p, alice, { threadId: shared, reason: 'x' }), '2026-10-16T10:00:00.000Z');
    expect(turnOf(dir, log.state(), log.state().threads[shared]!)).toEqual({ kind: 'none' });
  });
});

describe('一覧の並び（lastActivityAt）', () => {
  it('H2 一覧は自分か見える結んだ先の最新の更新の降順。結んだ先が動けば、メモにだれも書く前でもタスクが上に来る（0031 の 5）', () => {
    const { log, ctx, shared } = world();
    const task = addNote(log.state(), alice, ctx, { title: '雨漏りの対応', body: '着手する' });
    log.push(task.events, '2026-10-16T10:00:00.000Z');
    log.push(linkThreads(log.state(), alice, { threadId: task.threadId, otherThreadId: shared }), '2026-10-16T10:01:00.000Z');
    const other = addNote(log.state(), alice, ctx, { title: '別の件', body: 'メモ' });
    log.push(other.events, '2026-10-16T11:00:00.000Z');
    const mine = () => listThreads(dir, alice, log.state(), { filter: 'mine' });
    expect(mine().map((t) => t.id)).toEqual([other.threadId, task.threadId]);
    // 結んだ先（support@ のスレッド）に返事が来る
    ctx.setNow('2026-10-16T12:00:00.000Z');
    ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r9', anchors: { inReplyTo: '<m1>' } }), () => answer({}));
    expect(mine().map((t) => t.id)).toEqual([task.threadId, other.threadId]);
    expect(mine()[0]).toMatchObject({ updatedAt: '2026-10-16T10:01:00.000Z', lastActivityAt: '2026-10-16T12:00:00.000Z' });
    // 見えない結んだ先は数えない（Bob から見た Bob のメモ）
    const bobs = addNote(log.state(), bob, ctx, { body: 'Bob の件' });
    log.push(bobs.events, '2026-10-16T09:00:00.000Z');
    expect(listThreads(dir, bob, log.state(), { filter: 'mine' })[0]!.lastActivityAt).toBe('2026-10-16T09:00:00.000Z');
  });
});

describe('リンク先から導出したボール（derivedBall）', () => {
  it('H2 メモのスレッドのボールは、見えるリンク先から決まる（どれかが自分の番 → my_turn、全部相手待ち → waiting）', () => {
    const { log, ctx, shared, addressed } = world();
    const n = addNote(log.state(), alice, ctx, { body: '雨漏りの件' });
    log.push(n.events, '2026-10-16T10:00:00.000Z');
    expect(derivedBall(dir, alice, log.state(), log.state().threads[n.threadId]!)).toBeNull();

    log.push(linkThreads(log.state(), alice, { threadId: n.threadId, otherThreadId: shared }), '2026-10-16T10:01:00.000Z');
    expect(derivedBall(dir, alice, log.state(), log.state().threads[n.threadId]!)).toEqual({ kind: 'none' });
    log.push(linkThreads(log.state(), alice, { threadId: n.threadId, otherThreadId: addressed }), '2026-10-16T10:02:00.000Z');
    expect(derivedBall(dir, alice, log.state(), log.state().threads[n.threadId]!)).toEqual({ kind: 'my_turn', threadIds: [addressed] });

    // 両方に返事を送ると相手待ち
    ctx.setNow('2026-10-16T11:00:00.000Z');
    ingestPure(log, ctx, email({ from: 'support@ubs.example', to: ['carol@example.com'], sourceRef: 'o1', anchors: { inReplyTo: '<m1>' } }));
    ingestPure(log, ctx, email({ from: 'support@ubs.example', to: ['info@dave.example'], sourceRef: 'o2', anchors: { threadKey: 'UBS-7' } }));
    const p = log.state();
    expect(derivedBall(dir, alice, p, p.threads[n.threadId]!)).toEqual({ kind: 'waiting', threadIds: [addressed, shared].sort() });
    // メモのスレッド自身のボールは動かない（本人の側の状態を Murmur は変えない）
    expect(p.threads[n.threadId]!.ball).toEqual({ kind: 'none' });
  });

  it('H2 閉じたメモのスレッドに結ばれた先が動いても開き直さず、linkedActiveSinceDismissed で知らせるだけ', () => {
    const { log, ctx, shared } = world();
    const n = addNote(log.state(), alice, ctx, { body: '件' });
    log.push(n.events, '2026-10-16T10:00:00.000Z');
    log.push(linkThreads(log.state(), alice, { threadId: n.threadId, otherThreadId: shared }), '2026-10-16T10:01:00.000Z');
    log.push(dismissThread(log.state(), alice, { threadId: n.threadId, reason: '済み' }), '2026-10-16T10:02:00.000Z');
    let view = getThreadView(dir, alice, log.state(), n.threadId)!;
    expect(view.thread).toMatchObject({ dismissed: true, linkedActiveSinceDismissed: false });
    ctx.setNow('2026-10-16T12:00:00.000Z');
    ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r9', anchors: { inReplyTo: '<m1>' } }), () => answer({ thread: null }));
    view = getThreadView(dir, alice, log.state(), n.threadId)!;
    expect(view.thread).toMatchObject({ dismissed: true, linkedActiveSinceDismissed: true });
    expect(log.events.filter((e) => e.type === 'ThreadReopened')).toEqual([]);
  });
});

describe('結び候補（linkCandidates）', () => {
  it('H8 アンカーのキー（ソースの区切り・Jira キー・PR）が一致する見えるスレッドを候補に出す。結べば候補から消える。自分では張らない', () => {
    const { log, shared, addressed, line: l } = world();
    let p = log.state();
    expect(linkCandidates(alice, p, p.threads[shared]!)).toEqual([{ threadId: addressed, dataSourceId: 'ds_support', title: '見積', keys: ['UBS-7'] }]);
    expect(linkCandidates(bob, p, p.threads[l]!)).toEqual([]);
    expect(log.events.filter((e) => e.type === 'ThreadLinked')).toEqual([]);
    log.push(linkThreads(p, alice, { threadId: shared, otherThreadId: addressed }), '2026-10-16T10:00:00.000Z');
    p = log.state();
    expect(linkCandidates(alice, p, p.threads[shared]!)).toEqual([]);
    expect(p.threads[shared]!.links[0]!.route).toBe('anchor');
  });

  it('H3 見えないスレッドは候補に出ない', () => {
    const { log, ctx, shared } = world();
    const priv = ingestPure(log, ctx, email({ dataSourceId: 'ds_alice', from: 'info@dave.example', to: ['alice@ubs.example'], sourceRef: 'p1', anchors: { jiraKeys: ['UBS-7'] } }), () =>
      answer(),
    );
    const p = log.state();
    expect(linkCandidates(alice, p, p.threads[shared]!).map((c) => c.threadId)).toContain(priv.outcome!.threadId);
    expect(linkCandidates(bob, p, p.threads[shared]!).map((c) => c.threadId)).not.toContain(priv.outcome!.threadId);
  });
});

describe('タイムライン（getThreadView）', () => {
  it('H2 自分のスレッドの綴じたものと、見えるリンク先のシグナルを時刻順に並べる。since で差分に絞る。見えない先は id だけ', () => {
    const { log, ctx, shared } = world();
    const n = addNote(log.state(), alice, ctx, { body: '電話で聞いた' });
    log.push(n.events, '2026-10-16T10:00:00.000Z');
    log.push(linkThreads(log.state(), alice, { threadId: n.threadId, otherThreadId: shared }), '2026-10-16T10:01:00.000Z');
    log.push([draft('ThreadAttributeSet', { threadId: n.threadId, name: 'status', value: 'todo', actorUserId: 'u_alice' })], '2026-10-16T10:02:00.000Z');
    const view = getThreadView(dir, alice, log.state(), n.threadId)!;
    expect(view.timeline.map((e) => [e.kind, e.threadId])).toEqual([
      ['signal', shared],
      ['note', n.threadId],
      ['linked', n.threadId],
      ['attribute', n.threadId],
    ]);
    expect(getThreadView(dir, alice, log.state(), n.threadId, { since: '2026-10-16T10:00:30.000Z' })!.timeline.map((e) => e.kind)).toEqual(['linked', 'attribute']);

    const bobView = getThreadView(dir, bob, log.state(), shared)!;
    expect(bobView.linked).toEqual([{ threadId: n.threadId, route: 'manual', linkedAt: '2026-10-16T10:01:00.000Z', actorUserId: 'u_alice', visible: false }]);
    expect(JSON.stringify(bobView)).not.toContain('電話で聞いた');
    expect(getThreadView(dir, bob, log.state(), n.threadId)).toBeNull();
  });
});
