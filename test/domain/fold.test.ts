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

  it('H1 不正な列は FoldError（seq の逆行・未知のシグナルやスレッド・データソースをまたぐ置き先）', () => {
    const log = new EventLog();
    log.push([observed('s1'), intoNew('s1', 't1')], T0);
    const [a, b] = log.events as [DomainEvent, DomainEvent];
    expect(() => fold([b, a])).toThrow(FoldError);
    expect(() => fold([{ ...b, seq: 1 }])).toThrow(/unknown signal/);
    expect(() => fold([a, { ...into('s1', 'nope'), seq: 2, at: T0 } as DomainEvent])).toThrow(/unknown thread/);
    expect(() => fold([...log.events, { ...intoNew('s1', 't1'), seq: 3, at: T0 } as DomainEvent])).toThrow(/already exists/);
    const other = { ...observed('s9', { dataSourceId: 'ds_alice', sourceRef: 'x' }), seq: 3, at: T0 } as DomainEvent;
    expect(() => fold([...log.events, other, { ...into('s9', 't1'), seq: 4, at: T0 } as DomainEvent])).toThrow(/cannot go into/);
  });

  it('H1 個人のメモ: SignalObserved（channel note）+ SignalThreaded（by self）。ボールは動かず、シグナルとして並ぶ', () => {
    const log = new EventLog();
    log.push([note('n1'), draft('SignalThreaded', { signalId: 'n1', thread: { kind: 'new', threadId: 'm1', title: '雨漏りの件' }, by: 'self', confidence: 1, reason: 'r', needsResponse: null })], T0);
    log.push([note('n2'), draft('SignalThreaded', { signalId: 'n2', thread: { kind: 'existing', threadId: 'm1' }, by: 'self', confidence: 1, reason: 'r', needsResponse: null })], T1);
    const t = log.state().threads.m1!;
    expect(t).toMatchObject({ dataSourceId: 'ds_notes_alice', ball: { kind: 'none' }, signalIds: ['n1', 'n2'], counterpartPartyIds: [], lastOutboundAt: null });
    expect(t.log.map((l) => l.kind)).toEqual(['note', 'note']);
  });

  it('H4 ThreadClaimed: 持つ・引き継ぐ・手放すでボールと持ち主が変わり、ログに残る', () => {
    const log = new EventLog();
    log.push([observed('s1'), intoNew('s1', 't1')], T0);
    log.push([draft('ThreadClaimed', { threadId: 't1', userId: 'u_alice', actorUserId: 'u_alice', reason: '持つ' })], T1);
    expect(log.state().threads.t1).toMatchObject({ ownerUserId: 'u_alice', ball: { kind: 'user', userId: 'u_alice' } });
    log.push([draft('ThreadClaimed', { threadId: 't1', userId: null, actorUserId: 'u_alice' })], T2);
    expect(log.state().threads.t1).toMatchObject({ ownerUserId: null, ball: { kind: 'us' } });
    expect(log.state().threads.t1!.log.map((l) => [l.kind, l.userId])).toEqual([['signal', undefined], ['claimed', 'u_alice'], ['claimed', null]]);
  });

  it('H1 ThreadLinked は無向: 1 つのイベントが両端に同じ辺を載せ、unlink で両端から外れる。リンク先の状態は読まない', () => {
    const log = new EventLog();
    log.push([observed('s1'), intoNew('s1', 't1')], T0);
    log.push([note('n1'), draft('SignalThreaded', { signalId: 'n1', thread: { kind: 'new', threadId: 'm1', title: '件' }, by: 'self', confidence: 1, reason: 'r', needsResponse: null })], T0);
    log.push([draft('ThreadLinked', { a: 'm1', b: 't1', route: 'manual', actorUserId: 'u_alice', reason: 'この件' })], T1);
    let p = log.state();
    const edge = { route: 'manual', linkedAt: T1, actorUserId: 'u_alice' };
    expect(p.threads.m1!.links).toEqual([{ threadId: 't1', ...edge }]);
    expect(p.threads.t1!.links).toEqual([{ threadId: 'm1', ...edge }]);
    // リンクしてもボールはそれぞれのまま
    expect(p.threads.m1!.ball).toEqual({ kind: 'none' });
    expect(p.threads.t1!.ball).toEqual({ kind: 'us' });
    log.push([draft('ThreadLinked', { a: 't1', b: 'm1', op: 'unlink', route: 'manual', actorUserId: 'u_alice' })], T2);
    p = log.state();
    expect(p.threads.m1!.links).toEqual([]);
    expect(p.threads.t1!.links).toEqual([]);
    expect(p.threads.t1!.log.map((l) => l.kind)).toEqual(['signal', 'linked', 'unlinked']);
    expect(() => fold([...log.events, { ...draft('ThreadLinked', { a: 't1', b: 't1', route: 'manual', actorUserId: 'u' }), seq: 99, at: T2 } as DomainEvent])).toThrow(/itself/);
    expect(() => fold([...log.events, { ...draft('ThreadLinked', { a: 't1', b: 'nope', route: 'manual', actorUserId: 'u' }), seq: 99, at: T2 } as DomainEvent])).toThrow(/unknown thread/);
  });

  it('H2 ThreadAttributeSet: 値を付け、null で外す。ボールは動かない', () => {
    const log = new EventLog();
    log.push([observed('s1'), intoNew('s1', 't1')], T0);
    log.push([draft('ThreadAttributeSet', { threadId: 't1', name: 'status', value: 'todo', actorUserId: 'u_alice' })], T1);
    expect(log.state().threads.t1).toMatchObject({ attributes: { status: 'todo' }, ball: { kind: 'us' } });
    log.push([draft('ThreadAttributeSet', { threadId: 't1', name: 'status', value: null, actorUserId: 'u_alice' })], T2);
    expect(log.state().threads.t1!.attributes).toEqual({});
  });

  it('H4 OutboundRecorded（新しい送信）でシグナルができ、SignalThreaded で置かれる。返事期待が載り、ReplyOverdue で超過、受信で解消', () => {
    const log = new EventLog();
    log.push([observed('s1'), intoNew('s1', 't1')], T0);
    log.push([recorded('o1', false, T2), into('o1', 't1', null, 'human')], T1);
    let p = log.state();
    expect(p.signals.o1).toMatchObject({ direction: 'outbound', sourceRef: 'sent:<o1@x>', anchors: { messageId: '<o1@x>' }, recorded: { actorUserId: 'u_alice', replyExpectedBy: T2 } });
    expect(p.index.messageIds['ds_support|<o1@x>']).toBe('o1');
    expect(p.threads.t1).toMatchObject({ ball: { kind: 'party', partyIds: ['p_carol'] }, replyExpectedBy: T2, replyExpectedSignalId: 'o1', overdue: false });
    log.push([draft('ReplyOverdue', { threadId: 't1', signalId: 'o1', replyExpectedBy: T2 })], '2026-10-16T12:00:00.000Z');
    expect(log.state().threads.t1!.overdue).toBe(true);
    log.push([observed('s2'), into('s2', 't1', false)], '2026-10-16T13:00:00.000Z');
    p = log.state();
    expect(p.threads.t1).toMatchObject({ overdue: false, replyExpectedBy: null, ball: { kind: 'none' } });
  });

  it('H5 OutboundRecorded（merged）は観測された送信のシグナルに記録を重ねるだけで、シグナルもボールも増えない', () => {
    const log = new EventLog();
    log.push([observed('s1'), intoNew('s1', 't1')], T0);
    log.push([sent('o1'), into('o1', 't1', null)], T1);
    const before = log.state().threads.t1!;
    log.push([recorded('o1', true, T2)], '2026-10-16T10:30:00.000Z');
    const p = log.state();
    expect(p.threads.t1).toMatchObject({ signalIds: before.signalIds, ball: before.ball, lastOutboundAt: T1, replyExpectedBy: T2 });
    expect(p.signals.o1!.recorded).toMatchObject({ replyExpectedBy: T2 });
    expect(() => fold([...log.events, { ...recorded('s1', true, T2), seq: 99, at: T2 } as DomainEvent])).toThrow(/cannot merge/);
  });

  it('H9 ThreadMirrored: 変わった属性を写し（null は空）、done でボールは「なし」・返事期待の超過も消える。done が外れたら綴じた分から戻る', () => {
    const log = new EventLog();
    log.push([observed('s1'), intoNew('s1', 't1')], T0);
    const mirrored = (fields: Record<string, string | boolean | null>) =>
      draft('ThreadMirrored', { threadId: 't1', dataSourceId: 'ds_support', threadKey: 'UBS-1', fields, sourceRef: 'jira:UBS-1:x' });
    log.push([mirrored({ status: '進行中', assignee: 'p_alice', done: false })], T1);
    let t = log.state().threads.t1!;
    expect(t).toMatchObject({ attributes: { status: '進行中', assignee: 'p_alice', done: false }, ball: { kind: 'us' }, closedAtSource: false });
    expect(t.log.at(-1)).toMatchObject({ kind: 'mirrored', fields: { status: '進行中', assignee: 'p_alice', done: false } });
    log.push([recorded('o1', false, T2), into('o1', 't1', null, 'human')], T1);
    log.push([draft('ReplyOverdue', { threadId: 't1', signalId: 'o1', replyExpectedBy: T2 })], '2026-10-16T12:00:00.000Z');
    expect(log.state().threads.t1!.overdue).toBe(true);
    log.push([mirrored({ status: '完了', assignee: null, done: true })], '2026-10-16T13:00:00.000Z');
    t = log.state().threads.t1!;
    expect(t).toMatchObject({ attributes: { status: '完了', done: true }, ball: { kind: 'none' }, closedAtSource: true, overdue: false, dismissed: false });
    log.push([mirrored({ done: false })], '2026-10-16T14:00:00.000Z');
    expect(log.state().threads.t1).toMatchObject({ closedAtSource: false, ball: { kind: 'party', partyIds: ['p_carol'] }, overdue: true });
    expect(() => fold([...log.events, { ...mirrored({ done: true }), payload: { ...mirrored({}).payload, dataSourceId: 'ds_line' }, seq: 99, at: T2 } as DomainEvent])).toThrow(
      /mirror of ds_line/,
    );
  });
});

function recorded(signalId: string, merged: boolean, replyExpectedBy: string | null) {
  return draft('OutboundRecorded', {
    signalId,
    merged,
    dataSourceId: 'ds_support',
    channel: 'email',
    from: { channel: 'email', value: 'support@ubs.example' },
    to: [{ channel: 'email', value: 'carol@example.com' }],
    fromPartyId: 'p_ubs',
    toPartyIds: ['p_carol'],
    body: '調査します',
    sentRef: `<${signalId}@x>`,
    replyExpectedBy,
    actorUserId: 'u_alice',
  });
}


function note(signalId: string) {
  return draft('SignalObserved', {
    signalId,
    dataSourceId: 'ds_notes_alice',
    direction: 'outbound',
    channel: 'note',
    from: { channel: 'note', value: 'p_alice' },
    to: [],
    fromPartyId: 'p_alice',
    body: '電話で聞いた',
    sourceRef: `note:${signalId}`,
  });
}
