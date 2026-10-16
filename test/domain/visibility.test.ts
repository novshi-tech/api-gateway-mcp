import { describe, expect, it } from 'vitest';
import {
  approveDerivation,
  deriveViewer,
  explainIgnore,
  getListView,
  getTaskView,
  listMyTasks,
  listProposalsFor,
  proposeDerivation,
  recordSent,
  visibleSignals,
  Directory,
  type AiDecision,
} from '../../src/domain';
import { alice, bob, dir, email, EventLog, eve, ingestPure, makeCtx, seed } from '../helpers/world';

const T0 = '2026-10-16T09:00:00.000Z';
const newIn = (list: string, title: string): AiDecision => ({ decision: 'new', task_id: null, list_id: list, title, reason: 'r', confidence: 0.9 });

/** 顧客タスク(l_cust) → 協力会社への外部派生(l_partner) を送った状態 */
function world() {
  const log = new EventLog();
  const ctx = makeCtx(T0);
  ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r1', body: '個人的な事情も書いた生の本文' }), () => newIn('l_cust', '雨漏り'));
  const custTask = Object.keys(log.state().tasks)[0]!;
  const { events, derivationId } = proposeDerivation(log.state(), alice, ctx, {
    taskId: custTask,
    targetListId: 'l_partner',
    body: '屋根の点検と見積をお願いします',
    toPartyIds: ['p_dave'],
    replyExpected: { by: '2026-10-20T00:00:00.000Z' },
  });
  log.push(events, T0);
  log.push(approveDerivation(log.state(), alice, ctx, { derivationId }).events, T0);
  log.push(recordSent(log.state(), derivationId, '<s1>'), T0);
  const partnerTask = log.state().derivations[derivationId]!.targetTaskId;
  // 迷惑メールの無視
  ingestPure(log, ctx, email({ from: 'ad@spam.example', sourceRef: 'r2' }), () => ({
    decision: 'ignore',
    task_id: null,
    list_id: null,
    title: null,
    reason: '広告',
    confidence: 0.95,
  }));
  return { log, ctx, custTask, partnerTask, derivationId };
}

describe('H3 可視性', () => {
  it('テナント外の Viewer は別テナントのシグナルもタスクも 0 件', () => {
    const { log, custTask } = world();
    const p = log.state();
    expect(visibleSignals(eve, p)).toHaveLength(0);
    expect(listMyTasks(eve, [p], 'all')).toHaveLength(0);
    expect(getTaskView(dir, eve, p, custTask)).toBeNull();
    expect(explainIgnore(dir, eve, p)).toHaveLength(0);
  });

  it('同一テナントの別リストのメンバーには派生の要約だけが見え、生ペイロードは見えない', () => {
    const { log, custTask, partnerTask } = world();
    const p = log.state();
    // Bob は協力会社リストだけのメンバー
    const view = getTaskView(dir, bob, p, custTask);
    expect(view?.access).toBe('summary');
    const json = JSON.stringify(view);
    expect(json).toContain('屋根の点検と見積をお願いします');
    expect(json).not.toContain('個人的な事情');
    expect(visibleSignals(bob, p).map((s) => s.body)).not.toContain('個人的な事情も書いた生の本文');
    // 自分のリストのタスクは全部見える
    expect(getTaskView(dir, bob, p, partnerTask)?.access).toBe('full');
  });

  it('ゴースト Party（User なし）は Viewer になれず、何も取れない', () => {
    const { log } = world();
    const ghost = deriveViewer(dir, 'p_carol'); // User ID として渡しても一致する User がない
    expect(ghost.memberships).toEqual([]);
    expect(visibleSignals(ghost, log.state())).toEqual([]);
    expect(listMyTasks(ghost, [log.state()], 'all')).toEqual([]);
  });

  it('派生で結ばれていない別リストのタスクは見えない', () => {
    const log = new EventLog();
    const ctx = makeCtx(T0);
    ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r1' }), () => newIn('l_cust', 'x'));
    const t = Object.keys(log.state().tasks)[0]!;
    expect(getTaskView(dir, bob, log.state(), t)).toBeNull();
  });

  it('提案中・却下の派生は別リストに要約を見せる根拠にならない', () => {
    const log = new EventLog();
    const ctx = makeCtx(T0);
    ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r1' }), () => newIn('l_cust', 'x'));
    const t = Object.keys(log.state().tasks)[0]!;
    log.push(
      proposeDerivation(log.state(), alice, ctx, {
        taskId: t,
        targetListId: 'l_partner',
        body: 'x',
        toPartyIds: ['p_dave'],
        replyExpected: { by: T0 },
      }).events,
      T0,
    );
    expect(getTaskView(dir, bob, log.state(), t)).toBeNull();
  });
});

describe('getTaskView（full）', () => {
  it('タイムライン・属性定義・リンクを返す', () => {
    const { log, custTask, partnerTask } = world();
    const view = getTaskView(dir, alice, log.state(), custTask);
    if (view?.access !== 'full') throw new Error('expected full');
    expect(view.timeline.map((e) => e.kind)).toEqual(['inbound', 'derivation_out']);
    expect(view.timeline[0]!.signal?.body).toContain('生の本文');
    expect(view.timeline[1]!.derivation?.status).toBe('sent');
    expect(view.linkedTasks).toEqual([{ taskId: partnerTask, listId: 'l_partner', derivationId: expect.any(String) }]);
    expect(view.attributeDefs).toEqual([]);
  });
});

describe('listMyTasks', () => {
  it('User 横断で、フィルタ（open / ball_at_me / overdue / all）が効く', () => {
    const { log, custTask, partnerTask } = world();
    const p = log.state();
    expect(listMyTasks(alice, [p], 'open').map((t) => t.id)).toEqual([custTask]);
    // ボールは協力会社リストにあるので Alice の手元ではない
    expect(listMyTasks(alice, [p], 'ball_at_me')).toEqual([]);
    expect(listMyTasks(alice, [p], 'overdue')).toEqual([]);
    // 協力会社リストのタスクはボールが外部（Dave）にある
    expect(listMyTasks(bob, [p], 'open').map((t) => t.id)).toEqual([partnerTask]);
    expect(listMyTasks(bob, [p], 'ball_at_me')).toEqual([]);
    expect(listMyTasks(alice, [p], 'open', 'nvt')).toEqual([]);
  });

  it('両テナントに Party を持つ User は両方のタスクを束ねて見る', () => {
    const ubs = world().log.state();
    const nvtLog = new EventLog('nvt');
    const ctx = makeCtx(T0);
    const two = new Directory({
      ...seed,
      listMembers: [...seed.listMembers, { listId: 'l_dev', partyId: 'p_alice_nvt' }],
    });
    const aliceBoth = deriveViewer(two, 'u_alice');
    ingestPure(
      nvtLog,
      { ...ctx, dir: two },
      {
        channel: 'slack',
        from: { channel: 'slack', value: 'U_X' },
        to: [],
        body: 'PR 見て',
        sourceRef: 'n1',
        acquiredAs: { kind: 'user', userId: 'u_alice' },
      },
      () => newIn('l_dev', 'レビュー'),
    );
    const tasks = listMyTasks(aliceBoth, [ubs, nvtLog.state()], 'open');
    expect(tasks.map((t) => t.tenantId).sort()).toEqual(['nvt', 'ubs']);
  });
});

describe('提案・無視・リスト', () => {
  it('承認待ちは送信元リストのメンバーにだけ見える', () => {
    const log = new EventLog();
    const ctx = makeCtx(T0);
    ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'r1' }), () => newIn('l_cust', 'x'));
    const t = Object.keys(log.state().tasks)[0]!;
    log.push(proposeDerivation(log.state(), alice, ctx, { taskId: t, targetListId: 'l_int', body: 'b' }).events, T0);
    expect(listProposalsFor(log.state(), alice)).toHaveLength(1);
    expect(listProposalsFor(log.state(), alice, 'l_int')).toHaveLength(1);
    expect(listProposalsFor(log.state(), alice, 'l_partner')).toHaveLength(0);
    expect(listProposalsFor(log.state(), bob)).toHaveLength(0);
  });

  it('無視の監査ログは、置けたリストのメンバーに理由付きで見える', () => {
    const { log } = world();
    const entries = explainIgnore(dir, alice, log.state());
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ reason: '広告', confidence: 0.95, decidedBy: 'ai' });
    expect(explainIgnore(dir, alice, log.state(), '2027-01-01')).toHaveLength(0);
    // Bob も l_partner のメンバー（email の許可リスト）なので見える
    expect(explainIgnore(dir, bob, log.state())).toHaveLength(1);
  });

  it('リストはメンバーにだけ、メンバー・ゴースト・属性定義・接続チャネルつきで見える', () => {
    const v = getListView(dir, alice, 'l_cust');
    expect(v?.members).toContainEqual({ partyId: 'p_carol', name: 'Carol（顧客）', kind: 'person', ghost: true });
    expect(v?.channels).toEqual([{ channel: 'email', via: 'organization' }]);
    expect(getListView(dir, bob, 'l_cust')).toBeNull();
    expect(getListView(dir, eve, 'l_cust')).toBeNull();
    expect(getListView(dir, alice, 'nope')).toBeNull();
  });
});
