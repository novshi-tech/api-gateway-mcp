import { describe, expect, it } from 'vitest';
import { canonicalJson, draft, fold, FoldError, type DomainEvent } from '../../src/domain';
import { EventLog } from '../helpers/world';

const T0 = '2026-10-16T09:00:00.000Z';
const T1 = '2026-10-16T10:00:00.000Z';

function received(signalId: string, extra: Record<string, unknown> = {}) {
  return draft('SignalReceived', {
    signalId,
    channel: 'email',
    from: { channel: 'email', value: 'carol@example.com' },
    to: [],
    fromPartyId: 'p_carol',
    body: '雨漏りしています',
    subject: '修繕のお願い',
    sourceRef: `src-${signalId}`,
    acquiredAs: { kind: 'organization', tenantId: 'ubs' },
    anchors: { messageId: `<${signalId}@x>` },
    ...extra,
  });
}

const newTask = (signalId: string, taskId: string, listId = 'l_cust') =>
  draft('IngestDecided', {
    signalId,
    decision: { kind: 'new', taskId, listId, title: '雨漏り' },
    reason: 'r',
    decidedBy: 'ai',
    confidence: 0.9,
  });

describe('fold', () => {
  it('SignalReceived + IngestDecided(new) でタスクができ、通信状態が導出される', () => {
    const log = new EventLog();
    log.push([received('s1'), newTask('s1', 't1')], T0);
    const p = log.state();
    expect(p.tasks.t1).toMatchObject({
      listId: 'l_cust',
      title: '雨漏り',
      status: 'open',
      ballAt: { kind: 'list', listId: 'l_cust' },
      unansweredSince: T0,
    });
    expect(p.signals.s1).toMatchObject({ taskId: 't1', decision: 'new', direction: 'in' });
    expect(p.index).toEqual({ sourceRefs: { 'src-s1': 's1' }, messageIds: { '<s1@x>': 's1' }, sentRefs: {} });
    expect(p.lastSeq).toBe(2);
  });

  it('入力のイベント列も base の投影も変更しない（純関数）', () => {
    const log = new EventLog();
    log.push([received('s1')], T0);
    const snapshot = structuredClone(log.events);
    const base = log.state();
    const baseSnapshot = structuredClone(base);
    log.push([newTask('s1', 't1')], T1);
    fold(log.events.slice(1), base);
    expect(log.events.slice(0, 1)).toEqual(snapshot);
    expect(base).toEqual(baseSnapshot);
  });

  it('一括の fold と、途中の投影からの増分 fold が一致する', () => {
    const log = new EventLog();
    log.push([received('s1'), newTask('s1', 't1')], T0);
    log.push([draft('TaskAttributeSet', { taskId: 't1', name: 'status', value: 'doing' })], T1);
    log.push([draft('TaskClosed', { taskId: 't1' })], T1);
    const whole = fold(log.events);
    const incremental = fold(log.events.slice(2), fold(log.events.slice(0, 2)));
    expect(canonicalJson(incremental)).toBe(canonicalJson(whole));
  });

  it('seq が単調でないイベント・別テナントのイベントは拒否する', () => {
    const log = new EventLog();
    const [e1] = log.push([received('s1')], T0) as [DomainEvent];
    expect(() => fold([e1, e1])).toThrow(FoldError);
    expect(() => fold([e1, { ...e1, seq: 2, tenantId: 'nvt' }])).toThrow(/tenant mismatch/);
  });

  it('存在しないタスクへの操作は FoldError', () => {
    const log = new EventLog();
    log.push([draft('TaskClosed', { taskId: 'nope' })], T0);
    expect(() => log.state()).toThrow(FoldError);
  });

  it('ignore は IgnoreLog に理由付きで残り、後の訂正で overridden が付く', () => {
    const log = new EventLog();
    log.push(
      [
        received('s1'),
        draft('IngestDecided', { signalId: 's1', decision: { kind: 'ignore' }, reason: '広告', decidedBy: 'ai', confidence: 0.95 }),
      ],
      T0,
    );
    let p = log.state();
    expect(p.ignoreLog).toHaveLength(1);
    expect(p.ignoreLog[0]).toMatchObject({ signalId: 's1', reason: '広告', confidence: 0.95, overriddenAtSeq: null });
    expect(p.signals.s1!.taskId).toBeNull();

    log.push([{ ...newTask('s1', 't9'), payload: { ...newTask('s1', 't9').payload, decidedBy: 'human' } } as never], T1);
    p = log.state();
    expect(p.ignoreLog[0]!.overriddenAtSeq).toBe(3);
    expect(p.signals.s1).toMatchObject({ taskId: 't9', decision: 'new' });
  });

  it('訂正で別タスクへ付け替えると、元タスクのタイムラインと通信状態から外れる', () => {
    const log = new EventLog();
    log.push([received('s1'), newTask('s1', 't1')], T0);
    log.push([received('s2'), newTask('s2', 't2')], T1);
    log.push(
      [draft('IngestDecided', { signalId: 's2', decision: { kind: 'attach', taskId: 't1' }, reason: '同じ件', decidedBy: 'human', confidence: 1 })],
      T1,
    );
    const p = log.state();
    expect(p.timeline.filter((e) => e.taskId === 't2')).toHaveLength(0);
    expect(p.timeline.filter((e) => e.taskId === 't1').map((e) => e.signalId)).toEqual(['s1', 's2']);
    expect(p.tasks.t1!.lastInboundAt).toBe(T1);
    expect(p.tasks.t2!.lastInboundAt).toBeNull();
  });

  describe('派生のライフサイクル', () => {
    const setup = (mode: 'internal' | 'external', replyBy: string | null) => {
      const log = new EventLog();
      log.push([received('s1'), newTask('s1', 't1')], T0);
      log.push(
        [
          draft('DerivationProposed', {
            derivationId: 'd1',
            sourceTaskId: 't1',
            targetListId: mode === 'internal' ? 'l_int' : 'l_partner',
            targetTaskId: 't2',
            mode,
            title: '手配',
            body: '見積をお願いします',
            toPartyIds: mode === 'external' ? ['p_dave'] : [],
            replyExpected: replyBy ? { by: replyBy } : null,
            proposedBy: 'stand',
          }),
        ],
        T0,
      );
      return log;
    };

    it('proposed ではタスクもボールも動かない', () => {
      const p = setup('internal', null).state();
      expect(p.derivations.d1!.status).toBe('proposed');
      expect(p.tasks.t2).toBeUndefined();
      expect(p.tasks.t1!.ballAt).toEqual({ kind: 'list', listId: 'l_cust' });
    });

    it('内部派生は approved で適用され、返事期待がなければ completed', () => {
      const log = setup('internal', null);
      log.push([draft('DerivationApproved', { derivationId: 'd1', actorUserId: 'u_alice' })], T1);
      const p = log.state();
      expect(p.derivations.d1).toMatchObject({ status: 'completed', deliveredAt: T1, sentRef: null });
      expect(p.tasks.t2).toMatchObject({ listId: 'l_int', ballAt: { kind: 'list', listId: 'l_int' } });
      expect(p.tasks.t1!.ballAt).toEqual({ kind: 'list', listId: 'l_int' });
      expect(p.links).toEqual([{ derivationId: 'd1', sourceTaskId: 't1', targetTaskId: 't2' }]);
    });

    it('外部派生は approved では適用されず、sent で宛先 Party にボールが移る', () => {
      const log = setup('external', '2026-10-20T00:00:00.000Z');
      log.push(
        [
          draft('DerivationApproved', {
            derivationId: 'd1',
            actorUserId: 'u_alice',
            fromAddress: { channel: 'email', value: 'support@ubs.example' },
            toAddresses: [{ channel: 'email', value: 'info@dave.example' }],
          }),
        ],
        T1,
      );
      let p = log.state();
      expect(p.derivations.d1!.status).toBe('approved');
      expect(p.derivations.d1!.deliveredAt).toBeNull();
      expect(p.tasks.t1!.ballAt).toEqual({ kind: 'list', listId: 'l_cust' });

      log.push([draft('DerivationSent', { derivationId: 'd1', sentRef: '<m1>' })], T1);
      p = log.state();
      expect(p.derivations.d1).toMatchObject({ status: 'sent', sentRef: '<m1>' });
      expect(p.index.sentRefs['<m1>']).toBe('d1');
      expect(p.tasks.t2!.ballAt).toEqual({ kind: 'party', partyIds: ['p_dave'] });
      expect(p.tasks.t1).toMatchObject({ ballAt: { kind: 'list', listId: 'l_partner' }, replyExpectedBy: '2026-10-20T00:00:00.000Z' });

      log.push([draft('ReplyOverdue', { derivationId: 'd1' })], '2026-10-21T00:00:00.000Z');
      p = log.state();
      expect(p.derivations.d1!.status).toBe('overdue');
      expect(p.tasks.t1!.overdue).toBe(true);

      log.push([draft('DerivationReplied', { derivationId: 'd1', signalId: 'sX' })], '2026-10-22T00:00:00.000Z');
      p = log.state();
      expect(p.derivations.d1!.status).toBe('replied');
      expect(p.tasks.t1).toMatchObject({ ballAt: { kind: 'list', listId: 'l_cust' }, overdue: false });
    });

    it('rejected は何も動かさない', () => {
      const log = setup('internal', null);
      log.push([draft('DerivationRejected', { derivationId: 'd1', actorUserId: 'u_alice', reason: '不要' })], T1);
      const p = log.state();
      expect(p.derivations.d1).toMatchObject({ status: 'rejected', rejectedReason: '不要' });
      expect(p.tasks.t2).toBeUndefined();
    });
  });

  it('属性・クローズ・再オープンは作業状態だけを変える', () => {
    const log = new EventLog();
    log.push([received('s1'), newTask('s1', 't1')], T0);
    const before = log.state().tasks.t1!;
    log.push([draft('TaskAttributeSet', { taskId: 't1', name: 'status', value: 'doing' }), draft('TaskClosed', { taskId: 't1' })], T1);
    let t = log.state().tasks.t1!;
    expect(t.attributes).toEqual({ status: 'doing' });
    expect(t.status).toBe('closed');
    expect(t.ballAt).toEqual(before.ballAt);
    log.push([draft('TaskReopened', { taskId: 't1' })], T1);
    t = log.state().tasks.t1!;
    expect(t.status).toBe('open');
  });
});
