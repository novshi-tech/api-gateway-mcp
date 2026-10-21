import { describe, expect, it } from 'vitest';
import {
  addNote,
  claimThread,
  dismissThread,
  DomainError,
  linkThreads,
  moveSignal,
  reopenThread,
  setAttribute,
  unlinkThreads,
} from '../../src/domain';
import { alice, answer, bob, dir, email, eve, EventLog, ingestPure, makeCtx } from '../helpers/world';

// スタンドの操作（片付け・開き直し・シグナルの移し替え・メモ・持ち主・リンク・属性）。操作できるのはスレッドが見えている人だけ

function world() {
  const log = new EventLog();
  const ctx = makeCtx();
  const a = ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r1', anchors: { messageId: '<m1>' } }), () => answer({ title: '雨漏り' }));
  const b = ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r2', anchors: { inReplyTo: '<m1>' }, body: '別件で照明も' }), () =>
    answer({ thread: null }),
  );
  const mine = ingestPure(log, ctx, email({ dataSourceId: 'ds_alice', from: 'info@dave.example', to: ['alice@ubs.example'], sourceRef: 'r3' }), () => answer());
  return { log, ctx, threadId: a.outcome!.threadId, signalId: b.signalId!, privateThread: mine.outcome!.threadId };
}

describe('片付けと開き直し', () => {
  it('H3 読者だけが片付けられる。理由は必須で、片付け済みなら何もしない', () => {
    const { log, threadId, privateThread } = world();
    const p = log.state();
    expect(dismissThread(p, alice, { threadId, reason: '対応不要' })).toHaveLength(1);
    expect(() => dismissThread(p, alice, { threadId, reason: ' ' })).toThrow(/reason/);
    // Bob は support@ の読者なので片付けられるが、Alice の個人のメールボックスは見えない
    expect(dismissThread(p, bob, { threadId, reason: 'x' })).toHaveLength(1);
    expect(() => dismissThread(p, bob, { threadId: privateThread, reason: 'x' })).toThrow(DomainError);
    expect(() => dismissThread(p, eve, { threadId, reason: 'x' })).toThrow(/not found/);

    log.push(dismissThread(p, alice, { threadId, reason: '対応不要' }), '2026-10-16T10:00:00.000Z');
    expect(dismissThread(log.state(), alice, { threadId, reason: '対応不要' })).toEqual([]);
    expect(reopenThread(log.state(), bob, { threadId })).toHaveLength(1);
    expect(reopenThread(p, bob, { threadId })).toEqual([]);
  });
});

describe('シグナルの移し替え', () => {
  it('H6 同じデータソースの新しいスレッドへ移し、「求めているか」も直せる（追記で、元の判断は残る）', () => {
    const { log, ctx, threadId, signalId } = world();
    const { events, threadId: to } = moveSignal(log.state(), alice, ctx, {
      signalId,
      to: { kind: 'new', title: '照明の交換' },
      needsResponse: true,
      reason: '1 通に 2 つの話',
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.type === 'SignalThreaded' && events[0]!.payload).toMatchObject({
      by: 'human',
      actorUserId: 'u_alice',
      thread: { kind: 'new', title: '照明の交換' },
      needsResponse: true,
    });
    log.push(events, '2026-10-16T10:00:00.000Z');
    const p = log.state();
    expect(p.signals[signalId]!.threadId).toBe(to);
    expect(p.threads[threadId]!.signalIds).toHaveLength(1);
    expect(log.events.filter((e) => e.type === 'SignalThreaded')).toHaveLength(4);
  });

  it('H6 既存のスレッドへ戻せる。同じ置き先・同じ判断なら何もしない', () => {
    const { log, ctx, threadId, signalId } = world();
    expect(moveSignal(log.state(), alice, ctx, { signalId, to: { kind: 'existing', threadId }, reason: 'x' }).events).toEqual([]);
    const flip = moveSignal(log.state(), alice, ctx, { signalId, to: { kind: 'existing', threadId }, needsResponse: false, reason: 'お礼だけ' });
    expect(flip.events).toHaveLength(1);
  });

  it('H3 データソースをまたいでは移せない。見えないシグナルは not_found', () => {
    const { log, ctx, signalId, privateThread } = world();
    expect(() => moveSignal(log.state(), alice, ctx, { signalId, to: { kind: 'existing', threadId: privateThread }, reason: 'x' })).toThrow(
      /different data source/,
    );
    expect(() => moveSignal(log.state(), eve, ctx, { signalId, to: { kind: 'new', title: 't' }, reason: 'x' })).toThrow(/not found/);
    expect(() => moveSignal(log.state(), alice, ctx, { signalId, to: { kind: 'new', title: ' ' }, reason: 'x' })).toThrow(/title/);
    expect(() => moveSignal(log.state(), alice, ctx, { signalId, to: { kind: 'new', title: 't' }, reason: '' })).toThrow(/reason/);
  });

  it('H6 観測された送信には「求めているか」を付けられない', () => {
    const { log, ctx } = world();
    const sent = ingestPure(log, ctx, email({ from: 'support@ubs.example', to: ['carol@example.com'], sourceRef: 'o1', anchors: { inReplyTo: '<m1>' } }));
    expect(() =>
      moveSignal(log.state(), alice, ctx, { signalId: sent.signalId!, to: { kind: 'new', title: 't' }, needsResponse: true, reason: 'x' }),
    ).toThrow(/outbound/);
    const ok = moveSignal(log.state(), alice, ctx, { signalId: sent.signalId!, to: { kind: 'new', title: 't' }, reason: 'x' });
    expect(ok.events[0]!.type === 'SignalThreaded' && ok.events[0]!.payload.needsResponse).toBeNull();
  });
});

describe('個人のメモ（add_note）', () => {
  it('H3 自分のメモのデータソースに書く。thread_id がなければ新しいスレッド、件名は最初の行', () => {
    const { log, ctx, threadId: support } = world();
    const first = addNote(log.state(), alice, ctx, { body: 'Carol さんの雨漏り\n電話で状況を聞いた' });
    log.push(first.events, '2026-10-16T10:00:00.000Z');
    expect(log.state().threads[first.threadId]).toMatchObject({ dataSourceId: 'ds_notes_alice', title: 'Carol さんの雨漏り', ball: { kind: 'none' } });
    expect(log.state().signals[first.signalId]).toMatchObject({ channel: 'note', direction: 'outbound', threadedBy: 'self', fromPartyId: 'p_alice' });

    const second = addNote(log.state(), alice, ctx, { threadId: first.threadId, body: '見積を頼む' });
    log.push(second.events, '2026-10-16T11:00:00.000Z');
    expect(log.state().threads[first.threadId]!.signalIds).toEqual([first.signalId, second.signalId]);

    // 他人のメモのスレッドには書けない（見えない）。外のソースのスレッドにも書けない
    expect(() => addNote(log.state(), bob, ctx, { threadId: first.threadId, body: 'x' })).toThrow(/not found/);
    expect(() => addNote(log.state(), alice, ctx, { threadId: support, body: 'x' })).toThrow(/not in your notes/);
    expect(() => addNote(log.state(), alice, ctx, { body: ' ' })).toThrow(/body/);
    expect(() => addNote(log.state(), alice, ctx, { threadId: first.threadId, title: 't', body: 'x' })).toThrow(/title/);
    // 別テナントにメモのデータソースがなければ not_found
    expect(() => addNote(log.state(), eve, ctx, { body: 'x' })).toThrow(/notes/);
  });

  it('H1 メモのシグナルも移し替えられる（同じ件のメモのスレッドを 1 つにまとめる）', () => {
    const { log, ctx } = world();
    const a = addNote(log.state(), alice, ctx, { title: 'A', body: '1' });
    log.push(a.events, '2026-10-16T10:00:00.000Z');
    const b = addNote(log.state(), alice, ctx, { title: 'B', body: '2' });
    log.push(b.events, '2026-10-16T10:05:00.000Z');
    const moved = moveSignal(log.state(), alice, ctx, { signalId: b.signalId, to: { kind: 'existing', threadId: a.threadId }, reason: '同じ件' });
    log.push(moved.events, '2026-10-16T10:10:00.000Z');
    expect(log.state().threads[a.threadId]!.signalIds).toEqual([a.signalId, b.signalId]);
    expect(log.state().signals[b.signalId]!.needsResponse).toBeNull();
  });
});

describe('持ち主（claim_thread）', () => {
  it('H4 読者が持つ・引き継ぐ・手放す。読者でない人には持たせられない。同じ持ち主なら何もしない', () => {
    const { log, threadId, privateThread } = world();
    const claim = claimThread(log.state(), alice, dir, { threadId, userId: 'u_alice', reason: '持つ' });
    expect(claim).toHaveLength(1);
    log.push(claim, '2026-10-16T10:00:00.000Z');
    expect(log.state().threads[threadId]!.ball).toEqual({ kind: 'user', userId: 'u_alice' });
    expect(claimThread(log.state(), alice, dir, { threadId, userId: 'u_alice' })).toEqual([]);
    expect(claimThread(log.state(), alice, dir, { threadId, userId: 'u_bob' })).toHaveLength(1);
    expect(claimThread(log.state(), bob, dir, { threadId, userId: null })).toHaveLength(1);
    expect(() => claimThread(log.state(), alice, dir, { threadId, userId: 'u_eve' })).toThrow(/not a reader/);
    expect(() => claimThread(log.state(), alice, dir, { threadId: privateThread, userId: 'u_bob' })).toThrow(/not a reader/);
    expect(() => claimThread(log.state(), bob, dir, { threadId: privateThread, userId: 'u_bob' })).toThrow(/not found/);
  });

  it('H2 個人のメモのスレッドは持ち主を持たない', () => {
    const { log, ctx } = world();
    const n = addNote(log.state(), alice, ctx, { body: 'メモ' });
    log.push(n.events, '2026-10-16T10:00:00.000Z');
    expect(() => claimThread(log.state(), alice, dir, { threadId: n.threadId, userId: 'u_alice' })).toThrow(/no owner/);
  });
});

describe('リンク（link_threads / unlink_threads）', () => {
  it('H3 両端が見えていれば結べる。自分自身・見えない先は不可。結び済みなら何もしない。外すのは見えている側から', () => {
    const { log, ctx, threadId, privateThread } = world();
    const n = addNote(log.state(), alice, ctx, { body: '件' });
    log.push(n.events, '2026-10-16T10:00:00.000Z');
    const link = linkThreads(log.state(), alice, { threadId: n.threadId, otherThreadId: threadId, reason: 'この件' });
    expect(link[0]!.type === 'ThreadLinked' && link[0]!.payload).toMatchObject({ a: n.threadId, b: threadId, op: 'link', route: 'manual' });
    log.push(link, '2026-10-16T10:01:00.000Z');
    expect(linkThreads(log.state(), alice, { threadId, otherThreadId: n.threadId })).toEqual([]);
    expect(() => linkThreads(log.state(), alice, { threadId, otherThreadId: threadId })).toThrow(/itself/);
    expect(() => linkThreads(log.state(), bob, { threadId, otherThreadId: privateThread })).toThrow(/not found/);

    // Bob はメモのスレッドの中身は見えないが、support@ のスレッドに載った辺は外せる
    const off = unlinkThreads(log.state(), bob, { threadId, otherThreadId: n.threadId });
    expect(off[0]!.type === 'ThreadLinked' && off[0]!.payload).toMatchObject({ op: 'unlink', route: 'manual', actorUserId: 'u_bob' });
    log.push(off, '2026-10-16T10:02:00.000Z');
    expect(unlinkThreads(log.state(), bob, { threadId, otherThreadId: n.threadId })).toEqual([]);
  });

  it('H8 結び候補（アンカーの一致）から張ると経路は anchor', () => {
    const log = new EventLog();
    const ctx = makeCtx();
    const a = ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r1', anchors: { jiraKeys: ['UBS-7'] } }), () => answer());
    const b = ingestPure(log, ctx, email({ from: 'info@dave.example', sourceRef: 'r2', anchors: { jiraKeys: ['UBS-7'] } }), () => answer({ thread: 'new' }));
    const link = linkThreads(log.state(), alice, { threadId: a.outcome!.threadId, otherThreadId: b.outcome!.threadId });
    expect(link[0]!.type === 'ThreadLinked' && link[0]!.payload.route).toBe('anchor');
  });
});

describe('属性（set_attribute）', () => {
  it('H2 データソースの属性定義に従って型を確かめる。null で外す。同じ値なら何もしない', () => {
    const { log, ctx, threadId } = world();
    const n = addNote(log.state(), alice, ctx, { body: '件' });
    log.push(n.events, '2026-10-16T10:00:00.000Z');
    const set = setAttribute(log.state(), alice, dir, { threadId: n.threadId, name: 'status', value: 'todo' });
    expect(set).toHaveLength(1);
    log.push(set, '2026-10-16T10:01:00.000Z');
    expect(setAttribute(log.state(), alice, dir, { threadId: n.threadId, name: 'status', value: 'todo' })).toEqual([]);
    expect(() => setAttribute(log.state(), alice, dir, { threadId: n.threadId, name: 'status', value: 'later' })).toThrow(/not one of/);
    expect(() => setAttribute(log.state(), alice, dir, { threadId: n.threadId, name: 'nope', value: 'x' })).toThrow(/not defined/);
    expect(() => setAttribute(log.state(), alice, dir, { threadId, name: 'status', value: 'todo' })).toThrow(/not defined/);
    expect(setAttribute(log.state(), alice, dir, { threadId: n.threadId, name: 'status', value: null })).toHaveLength(1);
  });
});
