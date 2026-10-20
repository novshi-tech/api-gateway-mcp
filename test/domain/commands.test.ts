import { describe, expect, it } from 'vitest';
import { dismissThread, DomainError, moveSignal, reopenThread } from '../../src/domain';
import { alice, answer, bob, email, eve, EventLog, ingestPure, makeCtx } from '../helpers/world';

// スタンドの操作（片付け・開き直し・シグナルの移し替え）。操作できるのはスレッドが見えている人だけ

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
