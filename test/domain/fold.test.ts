import { describe, expect, it } from 'vitest';
import { canonicalJson, draft, fold, FoldError, type DomainEvent } from '../../src/domain';
import { EventLog } from '../helpers/world';

// fold の純関数テスト（イベント型を変えたらここも更新する）

const T0 = '2026-10-16T09:00:00.000Z';
const T1 = '2026-10-16T10:00:00.000Z';
const T2 = '2026-10-16T11:00:00.000Z';

function observed(signalId: string, extra: Record<string, unknown> = {}) {
  return draft('SignalObserved', {
    signalId,
    dataSourceId: 'ds_support',
    direction: 'inbound',
    channel: 'email',
    from: { channel: 'email', value: 'carol@example.com' },
    to: [{ channel: 'email', value: 'support@ubs.example' }],
    fromPartyId: 'p_carol',
    body: '雨漏りしています',
    subject: '修繕のお願い',
    sourceRef: `src-${signalId}`,
    anchors: { messageId: `<${signalId}@x>` },
    ...extra,
  });
}

const sent = (signalId: string, toPartyIds = ['p_carol']) =>
  observed(signalId, {
    direction: 'outbound',
    from: { channel: 'email', value: 'support@ubs.example' },
    to: [{ channel: 'email', value: 'carol@example.com' }],
    fromPartyId: 'p_ubs',
    toPartyIds,
  });

const intoNew = (signalId: string, threadId: string, needsResponse: boolean | null = true) =>
  draft('SignalThreaded', {
    signalId,
    thread: { kind: 'new', threadId, title: '雨漏り' },
    by: 'no_match',
    confidence: 1,
    reason: 'r',
    needsResponse,
  });

const into = (signalId: string, threadId: string, needsResponse: boolean | null = true, by: 'anchor' | 'human' = 'anchor') =>
  draft('SignalThreaded', { signalId, thread: { kind: 'existing', threadId }, by, confidence: 1, reason: 'r', needsResponse });

describe('fold', () => {
  it('H1 SignalObserved + SignalThreaded(new) でスレッドができ、ボールがこちらに来る', () => {
    const log = new EventLog();
    log.push([observed('s1'), intoNew('s1', 't1')], T0);
    const p = log.state();
    expect(p.threads.t1).toMatchObject({
      dataSourceId: 'ds_support',
      title: '雨漏り',
      ball: { kind: 'us' },
      counterpartPartyIds: ['p_carol'],
      signalIds: ['s1'],
      unansweredSince: T0,
      lastInboundAt: T0,
      dismissed: false,
    });
    expect(p.signals.s1).toMatchObject({ threadId: 't1', threadedBy: 'no_match', direction: 'inbound', needsResponse: true });
    expect(p.index).toEqual({ sourceRefs: { 'ds_support|src-s1': 's1' }, messageIds: { 'ds_support|<s1@x>': 's1' } });
    expect(p.lastSeq).toBe(2);
  });

  it('H1 観測された送信でボールは相手へ、返事でこちらへ戻る。求めていない受信は相手待ちを「なし」にする', () => {
    const log = new EventLog();
    log.push([observed('s1'), intoNew('s1', 't1')], T0);
    log.push([sent('o1'), into('o1', 't1', null)], T1);
    expect(log.state().threads.t1).toMatchObject({ ball: { kind: 'party', partyIds: ['p_carol'] }, lastOutboundAt: T1, unansweredSince: null });
    expect(log.state().signals.o1!.needsResponse).toBeNull();

    log.push([observed('s2'), into('s2', 't1', false)], T2);
    expect(log.state().threads.t1!.ball).toEqual({ kind: 'none' });
    log.push([observed('s3'), into('s3', 't1', true)], '2026-10-16T12:00:00.000Z');
    expect(log.state().threads.t1).toMatchObject({ ball: { kind: 'us' }, unansweredSince: '2026-10-16T12:00:00.000Z' });
  });

  it('H1 観測された送信の SignalThreaded に needsResponse が付いていても無視する', () => {
    const log = new EventLog();
    log.push([sent('o1'), intoNew('o1', 't1', true)], T0);
    expect(log.state().signals.o1!.needsResponse).toBeNull();
    expect(log.state().threads.t1!.ball).toEqual({ kind: 'party', partyIds: ['p_carol'] });
  });

  it('H1 片付けるとボールは「なし」、その後のシグナルは綴じるが片付けたまま（開き直しで戻る）', () => {
    const log = new EventLog();
    log.push([observed('s1'), intoNew('s1', 't1')], T0);
    log.push([draft('ThreadDismissed', { threadId: 't1', actorUserId: 'u_alice', reason: '対応不要' })], T1);
    expect(log.state().threads.t1).toMatchObject({ ball: { kind: 'none' }, dismissed: true, dismissReason: '対応不要', dismissedAt: T1 });

    log.push([observed('s2'), into('s2', 't1', true)], T2);
    expect(log.state().threads.t1).toMatchObject({ ball: { kind: 'none' }, dismissed: true, activeSinceDismissed: true, signalIds: ['s1', 's2'] });

    log.push([draft('ThreadReopened', { threadId: 't1', actorUserId: 'u_alice' })], '2026-10-16T12:00:00.000Z');
    expect(log.state().threads.t1).toMatchObject({ ball: { kind: 'us' }, dismissed: false, activeSinceDismissed: false, dismissReason: null });
    expect(log.state().threads.t1!.log.map((l) => l.kind)).toEqual(['signal', 'dismissed', 'signal', 'reopened']);
  });

  it('H1 移し替え: 元のスレッドから外れて通信状態が計算し直され、移し先に時刻順で入る', () => {
    const log = new EventLog();
    log.push([observed('s1'), intoNew('s1', 't1', false)], T0);
    log.push([observed('s2'), into('s2', 't1', true)], T1);
    expect(log.state().threads.t1!.ball).toEqual({ kind: 'us' });
    log.push([draft('SignalThreaded', { signalId: 's2', thread: { kind: 'new', threadId: 't2', title: '別件' }, by: 'human', confidence: 1, reason: '別の話題', needsResponse: true, actorUserId: 'u_alice' })], T2);
    const p = log.state();
    expect(p.threads.t1).toMatchObject({ signalIds: ['s1'], ball: { kind: 'none' }, unansweredSince: null });
    // 新しいスレッドの作成時刻はシグナルの時刻
    expect(p.threads.t2).toMatchObject({ signalIds: ['s2'], ball: { kind: 'us' }, createdAt: T1, title: '別件' });
    expect(p.signals.s2).toMatchObject({ threadId: 't2', threadedBy: 'human' });

    // 戻すと元の順番に戻る
    log.push([into('s2', 't1', true, 'human')], '2026-10-16T12:00:00.000Z');
    expect(log.state().threads.t1!.signalIds).toEqual(['s1', 's2']);
    expect(log.state().threads.t2!.signalIds).toEqual([]);
  });

  it('H1 入力のイベント列も base の投影も変更しない（純関数）', () => {
    const log = new EventLog();
    log.push([observed('s1')], T0);
    const snapshot = structuredClone(log.events);
    const base = log.state();
    const baseSnapshot = structuredClone(base);
    log.push([intoNew('s1', 't1')], T1);
    fold(log.events.slice(1), base);
    expect(log.events.slice(0, 1)).toEqual(snapshot);
    expect(base).toEqual(baseSnapshot);
  });

  it('H1 一括で畳んでも 1 件ずつ畳んでも同じ投影になる', () => {
    const log = new EventLog();
    log.push([observed('s1'), intoNew('s1', 't1')], T0);
    log.push([sent('o1'), into('o1', 't1', null)], T1);
    log.push([draft('ThreadDismissed', { threadId: 't1', actorUserId: 'u_alice', reason: 'x' })], T2);
    const whole = fold(log.events);
    const stepwise = log.events.reduce((p, e) => fold([e], p), fold([]));
    expect(canonicalJson(stepwise)).toBe(canonicalJson(whole));
  });

  it('H1 不正な列は FoldError（seq の逆行・別テナント・未知のシグナルやスレッド・データソースをまたぐ置き先）', () => {
    const log = new EventLog();
    log.push([observed('s1'), intoNew('s1', 't1')], T0);
    const [a, b] = log.events as [DomainEvent, DomainEvent];
    expect(() => fold([b, a])).toThrow(FoldError);
    expect(() => fold([a, { ...b, tenantId: 'nvt' }])).toThrow(/tenant mismatch/);
    expect(() => fold([{ ...b, seq: 1 }])).toThrow(/unknown signal/);
    expect(() => fold([a, { ...into('s1', 'nope'), tenantId: 'ubs', seq: 2, at: T0 } as DomainEvent])).toThrow(/unknown thread/);
    expect(() => fold([...log.events, { ...intoNew('s1', 't1'), tenantId: 'ubs', seq: 3, at: T0 } as DomainEvent])).toThrow(/already exists/);
    const other = { ...observed('s9', { dataSourceId: 'ds_alice', sourceRef: 'x' }), tenantId: 'ubs', seq: 3, at: T0 } as DomainEvent;
    expect(() => fold([...log.events, other, { ...into('s9', 't1'), tenantId: 'ubs', seq: 4, at: T0 } as DomainEvent])).toThrow(/cannot go into/);
  });
});
