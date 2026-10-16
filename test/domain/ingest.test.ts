import { describe, expect, it } from 'vitest';
import {
  AiDecision,
  approveDerivation,
  buildDecisionPrompt,
  candidateTasks,
  finalizeDecision,
  normalizeEstimate,
  planDecision,
  prepareInbound,
  proposeDerivation,
  recordSent,
  resolveAnchors,
  type DecisionRequest,
} from '../../src/domain';
import { alice, email, EventLog, ingestPure, makeCtx } from '../helpers/world';

const T0 = '2026-10-16T09:00:00.000Z';
const newIn = (list = 'l_cust', title = '件名'): AiDecision => ({
  decision: 'new',
  task_id: null,
  list_id: list,
  title,
  reason: '新規',
  confidence: 0.9,
});

describe('prepareInbound', () => {
  it('source_ref が既出なら duplicate', () => {
    const log = new EventLog();
    const ctx = makeCtx(T0);
    ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r1' }), () => newIn());
    expect(prepareInbound(log.state(), ctx, email({ from: 'carol@example.com', sourceRef: 'r1' }))).toEqual({
      kind: 'duplicate',
      signalId: 'sig_1',
    });
  });

  it('自分側のアドレスからなら観測された送信、外からなら受信。Party を解決して載せる', () => {
    const ctx = makeCtx(T0);
    const p = new EventLog().state();
    const out = prepareInbound(p, ctx, email({ from: 'alice@ubs.example', to: [{ channel: 'email', value: 'carol@example.com' }], sourceRef: 'o1' }));
    expect(out).toMatchObject({ kind: 'signal', direction: 'out', payload: { fromPartyId: 'p_alice', toPartyIds: ['p_carol'] } });
    const inn = prepareInbound(p, ctx, email({ from: 'stranger@example.net', sourceRef: 'i1' }));
    expect(inn).toMatchObject({ kind: 'signal', direction: 'in', payload: { fromPartyId: null } });
  });

  it('H5: 観測された送信の Message-ID が DerivationSent の sent_ref と一致すれば統合する', () => {
    const log = new EventLog();
    const ctx = makeCtx(T0);
    ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r1' }), () => newIn());
    const taskId = Object.keys(log.state().tasks)[0]!;
    const { events, derivationId } = proposeDerivation(log.state(), alice, ctx, {
      taskId,
      targetListId: 'l_partner',
      body: '見積を',
      toPartyIds: ['p_dave'],
      replyExpected: { by: '2026-10-20T00:00:00.000Z' },
    });
    log.push(events, T0);
    log.push(approveDerivation(log.state(), alice, ctx, { derivationId }).events, T0);
    log.push(recordSent(log.state(), derivationId, '<sent-1>'), T0);

    const echo = email({
      from: 'support@ubs.example',
      to: [{ channel: 'email', value: 'info@dave.example' }],
      sourceRef: 'observed:<sent-1>',
      anchors: { messageId: '<sent-1>' },
    });
    expect(prepareInbound(log.state(), ctx, echo)).toEqual({ kind: 'merged', derivationId });
    // 受信側（外から）の同じ ID は統合しない
    expect(prepareInbound(log.state(), ctx, { ...echo, from: { channel: 'email', value: 'info@dave.example' } }).kind).toBe('signal');
  });
});

describe('resolveAnchors', () => {
  function base() {
    const log = new EventLog();
    const ctx = makeCtx(T0);
    ingestPure(
      log,
      ctx,
      email({ from: 'carol@example.com', sourceRef: 'r1', anchors: { messageId: '<m1>', jiraKeys: ['UBS-1'], prRefs: ['repo#7'] } }),
      () => newIn(),
    );
    return { log, ctx, taskId: Object.keys(log.state().tasks)[0]! };
  }
  const sig = (anchors: Record<string, unknown>) =>
    ({
      signalId: 'sig_x',
      channel: 'email',
      from: { channel: 'email', value: 'carol@example.com' },
      to: [],
      fromPartyId: 'p_carol',
      toPartyIds: [],
      body: '',
      anchors,
      attachments: [],
      sourceRef: 'x',
      acquiredAs: { kind: 'organization', tenantId: 'ubs' },
    }) as const;

  it('In-Reply-To・Jira キー・PR 番号で既存タスクに決まる', () => {
    const { log, taskId } = base();
    const p = log.state();
    expect(resolveAnchors(p, sig({ inReplyTo: '<m1>' }), ['l_cust'])).toMatchObject({ taskId });
    expect(resolveAnchors(p, sig({ jiraKeys: ['UBS-1'] }), ['l_cust'])?.reason).toContain('UBS-1');
    expect(resolveAnchors(p, sig({ prRefs: ['repo#7'] }), ['l_cust'])?.reason).toContain('repo#7');
    expect(resolveAnchors(p, sig({ inReplyTo: '<unknown>' }), ['l_cust'])).toBeNull();
  });

  it('スレッド: thread_ts が親メッセージの ID か、同じスレッドの他のメッセージに一致', () => {
    const log = new EventLog();
    const ctx = makeCtx(T0);
    const slack = (sourceRef: string, anchors: Record<string, string>) => ({
      ...email({ from: 'U_X', sourceRef }),
      channel: 'slack' as const,
      from: { channel: 'slack' as const, value: 'U_X' },
      to: [],
      anchors,
      acquiredAs: { kind: 'user' as const, userId: 'u_alice' },
    });
    ingestPure(log, ctx, slack('s1', { messageId: '100.1' }), () => newIn('l_int'));
    const r = ingestPure(log, ctx, slack('s2', { messageId: '100.2', threadTs: '100.1' }));
    expect(r.events[1]).toMatchObject({ type: 'IngestDecided', payload: { decidedBy: 'anchor' } });
    const r3 = ingestPure(log, ctx, slack('s3', { messageId: '100.3', threadTs: '100.1' }));
    expect(r3.events[1]).toMatchObject({ payload: { decision: { kind: 'attach' } } });
  });

  it('取得主体ルールで置けないリストのタスクには付けない', () => {
    const { log } = base();
    expect(resolveAnchors(log.state(), sig({ inReplyTo: '<m1>' }), ['l_int'])).toBeNull();
  });
});

describe('planDecision', () => {
  it('アンカーで決まれば AI を呼ばず decidedBy=anchor、confidence=1', () => {
    const log = new EventLog();
    const ctx = makeCtx(T0);
    ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r1', anchors: { messageId: '<m1>' } }), () => newIn());
    const r = ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r2', anchors: { inReplyTo: '<m1>' } }));
    expect(r.events[1]).toMatchObject({ type: 'IngestDecided', payload: { decidedBy: 'anchor', confidence: 1 } });
  });

  it('置けるリストがなければ ignore（理由付き）', () => {
    const log = new EventLog();
    const ctx = makeCtx(T0);
    const r = ingestPure(log, ctx, { ...email({ from: 'x@y', sourceRef: 'r1' }), channel: 'line', from: { channel: 'line', value: 'x' } });
    expect(r.events[1]).toMatchObject({ payload: { decision: { kind: 'ignore' }, reason: '取得主体ルールで置けるリストがない' } });
  });

  it('決まらなければ置けるリストと候補タスクを AI に渡す', () => {
    const log = new EventLog();
    const ctx = makeCtx(T0);
    ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r1' }), () => newIn());
    const prepared = prepareInbound(log.state(), ctx, email({ from: 'carol@example.com', sourceRef: 'r2' }));
    if (prepared.kind !== 'signal') throw new Error();
    const plan = planDecision(log.state(), ctx, 'in', prepared.payload);
    expect(plan.kind).toBe('needs_decision');
    if (plan.kind !== 'needs_decision') return;
    expect(plan.request.allowedLists.map((l) => l.id)).toEqual(['l_cust', 'l_partner']);
    expect(plan.request.candidates.map((c) => c.taskId)).toEqual(['task_2']);
  });
});

describe('candidateTasks', () => {
  it('置けるリストの open なタスクを新しい順に、上限つきで返す', () => {
    const log = new EventLog();
    const ctx = makeCtx(T0);
    for (let i = 0; i < 5; i++) {
      ctx.setNow(`2026-10-16T0${i}:00:00.000Z`);
      ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: `r${i}`, body: `b${i}` }), () => newIn('l_cust', `t${i}`));
    }
    const c = candidateTasks(log.state(), ['l_cust'], 3);
    expect(c.map((x) => x.title)).toEqual(['t4', 't3', 't2']);
    expect(c[0]!.recent[0]).toMatchObject({ direction: 'in', excerpt: 'b4' });
    expect(candidateTasks(log.state(), ['l_int'])).toEqual([]);
  });
});

describe('finalizeDecision', () => {
  const request = (): DecisionRequest => ({
    tenantId: 'ubs',
    direction: 'in',
    signal: {
      signalId: 'sig_9',
      channel: 'email',
      from: { channel: 'email', value: 'carol@example.com' },
      to: [],
      fromPartyId: 'p_carol',
      toPartyIds: [],
      subject: '件名あり',
      body: '本文',
      anchors: {},
      attachments: [],
      sourceRef: 'x',
      acquiredAs: { kind: 'organization', tenantId: 'ubs' },
    },
    allowedLists: [
      { id: 'l_cust', name: '', description: '' },
      { id: 'l_partner', name: '', description: '' },
    ],
    candidates: [],
  });
  const p = new EventLog().state();
  const policy = { ignoreThreshold: 0.8 };

  it('閾値以上の ignore は自動で無視、未満は new に倒す', () => {
    const ctx = makeCtx(T0);
    const hi = finalizeDecision(p, ctx, request(), { ...newIn(), decision: 'ignore', confidence: 0.85, reason: '広告' }, 'ai', policy);
    expect(hi.events[0]).toMatchObject({ payload: { decision: { kind: 'ignore' }, reason: '広告' } });
    expect(hi.taskId).toBeNull();
    const lo = finalizeDecision(p, ctx, request(), { ...newIn(), decision: 'ignore', confidence: 0.5, reason: '広告' }, 'ai', policy);
    expect(lo.events[0]).toMatchObject({ payload: { decision: { kind: 'new', listId: 'l_cust', title: '件名' } } });
    expect((lo.events[0]!.payload as { reason: string }).reason).toContain('閾値');
  });

  it('候補外の attach は new に倒し、置けない list_id は最初の許可リストにする', () => {
    const ctx = makeCtx(T0);
    const r = finalizeDecision(p, ctx, request(), { ...newIn(), decision: 'attach', task_id: 'task_zzz' }, 'ai', policy);
    expect(r.events[0]).toMatchObject({ payload: { decision: { kind: 'new' } } });
    const r2 = finalizeDecision(p, ctx, request(), newIn('l_int'), 'ai', policy);
    expect(r2.events[0]).toMatchObject({ payload: { decision: { kind: 'new', listId: 'l_cust' } } });
    const r3 = finalizeDecision(p, ctx, request(), newIn('l_partner', '  '), 'ai', policy);
    expect(r3.events[0]).toMatchObject({ payload: { decision: { kind: 'new', listId: 'l_partner', title: '件名あり' } } });
  });

  it('空の理由も監査用に埋める', () => {
    const r = finalizeDecision(p, makeCtx(T0), request(), { ...newIn(), reason: ' ' }, 'ai', policy);
    expect((r.events[0]!.payload as { reason: string }).reason).toBe('(理由なし)');
  });
});

describe('返事の紐づけ（DerivationReplied）', () => {
  function sentToDave() {
    const log = new EventLog();
    const ctx = makeCtx(T0);
    ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r1' }), () => newIn());
    const taskId = Object.keys(log.state().tasks)[0]!;
    const { events, derivationId } = proposeDerivation(log.state(), alice, ctx, {
      taskId,
      targetListId: 'l_partner',
      body: '見積を',
      toPartyIds: ['p_dave'],
      replyExpected: { by: '2026-10-20T00:00:00.000Z' },
    });
    log.push(events, T0);
    log.push(approveDerivation(log.state(), alice, ctx, { derivationId }).events, T0);
    log.push(recordSent(log.state(), derivationId, '<sent-1>'), T0);
    return { log, ctx, derivationId, taskId };
  }

  it('In-Reply-To が sent_ref なら、派生の適用先タスクに付き replied になる', () => {
    const { log, ctx, derivationId, taskId } = sentToDave();
    const r = ingestPure(log, ctx, email({ from: 'info@dave.example', sourceRef: 'r2', anchors: { inReplyTo: '<sent-1>' } }));
    expect(r.events.map((e) => e.type)).toEqual(['SignalReceived', 'IngestDecided', 'DerivationReplied']);
    const p = log.state();
    expect(p.derivations[derivationId]!.status).toBe('replied');
    expect(p.tasks[taskId]!.ballAt).toEqual({ kind: 'list', listId: 'l_cust' });
  });

  it('アンカーなしでも、AI が適用先タスクに付け、送り主が宛先なら replied', () => {
    const { log, ctx, derivationId } = sentToDave();
    const target = log.state().derivations[derivationId]!.targetTaskId;
    const r = ingestPure(log, ctx, email({ from: 'info@dave.example', sourceRef: 'r2' }), () => ({
      ...newIn(),
      decision: 'attach',
      task_id: target,
    }));
    expect(r.events.map((e) => e.type)).toContain('DerivationReplied');
  });

  it('宛先以外からのメッセージや送信は返事にしない', () => {
    const { log, ctx, derivationId } = sentToDave();
    const target = log.state().derivations[derivationId]!.targetTaskId;
    const attach = () => ({ ...newIn(), decision: 'attach' as const, task_id: target });
    const r = ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r2' }), attach);
    expect(r.events.map((e) => e.type)).not.toContain('DerivationReplied');
  });
});

describe('プロンプトと推定の正規化', () => {
  it('判断プロンプトは本文・候補・リストを含む JSON', () => {
    const json = JSON.parse(
      buildDecisionPrompt({
        tenantId: 'ubs',
        direction: 'out',
        signal: {
          signalId: 's',
          channel: 'email',
          from: { channel: 'email', value: 'a@x' },
          to: [{ channel: 'email', value: 'b@x' }],
          fromPartyId: null,
          toPartyIds: [],
          body: '本文',
          anchors: {},
          attachments: [{ path: 'f/q.pdf', sha256: 'h', name: '見積.pdf' }],
          sourceRef: 's',
          acquiredAs: { kind: 'organization', tenantId: 'ubs' },
        },
        allowedLists: [{ id: 'l', name: 'L', description: 'd' }],
        candidates: [{ taskId: 't', listId: 'l', title: 'T', status: 'open', updatedAt: T0, recent: [] }],
      }),
    );
    expect(json.signal).toMatchObject({ direction: 'sent_by_us', body: '本文', attachments: ['見積.pdf'] });
    expect(json.candidates[0]).toEqual({ task_id: 't', list_id: 'l', title: 'T', recent: [] });
    expect(json.lists).toEqual([{ id: 'l', name: 'L', description: 'd' }]);
  });

  it('返事期待の推定は、不要・不正・過去の日時を null にする', () => {
    expect(normalizeEstimate({ expects_reply: true, reply_expected_by: '2026-10-18T09:00:00+09:00', reason: '' }, T0)).toBe(
      '2026-10-18T00:00:00.000Z',
    );
    expect(normalizeEstimate({ expects_reply: false, reply_expected_by: '2026-10-18', reason: '' }, T0)).toBeNull();
    expect(normalizeEstimate({ expects_reply: true, reply_expected_by: 'あした', reason: '' }, T0)).toBeNull();
    expect(normalizeEstimate({ expects_reply: true, reply_expected_by: '2026-10-01', reason: '' }, T0)).toBeNull();
  });

  it('AiDecision スキーマは範囲外の confidence を拒否する', () => {
    expect(AiDecision.safeParse({ ...newIn(), confidence: 1.2 }).success).toBe(false);
  });
});
