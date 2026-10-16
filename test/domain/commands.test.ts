import { describe, expect, it } from 'vitest';
import {
  approveDerivation,
  closeTask,
  correctIngest,
  DomainError,
  proposeDerivation,
  recordSent,
  rejectDerivation,
  reopenTask,
  scanOverdue,
  setAttribute,
  type DraftEvent,
} from '../../src/domain';
import { alice, bob, email, EventLog, eve, ingestPure, makeCtx } from '../helpers/world';

const T0 = '2026-10-16T09:00:00.000Z';

/** 顧客 Carol からの問い合わせが l_cust に new で入った状態 */
function withCustomerTask() {
  const log = new EventLog();
  const ctx = makeCtx(T0);
  ingestPure(log, ctx, email({ from: 'carol@example.com', sourceRef: 'm1', subject: '雨漏り', anchors: { messageId: '<m1>' } }), () => ({
    decision: 'new',
    task_id: null,
    list_id: 'l_cust',
    title: '雨漏りの修繕',
    reason: '新しい依頼',
    confidence: 0.9,
  }));
  const taskId = Object.keys(log.state().tasks)[0]!;
  return { log, ctx, taskId };
}

const expectDomainError = (fn: () => unknown, code: DomainError['code']) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    return;
  }
  throw new Error('expected DomainError');
};

describe('setAttribute', () => {
  it('定義済みの属性だけ、型を確かめて TaskAttributeSet を返す', () => {
    const { log, ctx, taskId } = withCustomerTask();
    // 内部リストのタスクを作る
    const { events, derivationId } = proposeDerivation(log.state(), alice, ctx, { taskId, targetListId: 'l_int', body: '手配して' });
    log.push(events, T0);
    log.push(approveDerivation(log.state(), alice, ctx, { derivationId }).events, T0);
    const internal = log.state().derivations[derivationId]!.targetTaskId;

    const p = log.state();
    expect(setAttribute(p, alice, ctx, { taskId: internal, name: 'status', value: 'doing' })).toEqual([
      { type: 'TaskAttributeSet', payload: { taskId: internal, name: 'status', value: 'doing', actorUserId: 'u_alice' } },
    ]);
    expect(setAttribute(p, alice, ctx, { taskId: internal, name: 'assignee', value: 'p_alice' })).toHaveLength(1);
    expect(setAttribute(p, alice, ctx, { taskId: internal, name: 'amount', value: null })).toHaveLength(1);
    expectDomainError(() => setAttribute(p, alice, ctx, { taskId: internal, name: 'status', value: 'unknown' }), 'invalid');
    expectDomainError(() => setAttribute(p, alice, ctx, { taskId: internal, name: 'amount', value: '100' }), 'invalid');
    expectDomainError(() => setAttribute(p, alice, ctx, { taskId: internal, name: 'due', value: 'tomorrow' }), 'invalid');
    expectDomainError(() => setAttribute(p, alice, ctx, { taskId: internal, name: 'urgent', value: 1 }), 'invalid');
    expectDomainError(() => setAttribute(p, alice, ctx, { taskId: internal, name: 'memo', value: 3 }), 'invalid');
    expectDomainError(() => setAttribute(p, alice, ctx, { taskId: internal, name: 'assignee', value: 'p_eve' }), 'invalid');
    expectDomainError(() => setAttribute(p, alice, ctx, { taskId: internal, name: 'nope', value: 1 }), 'invalid');
  });

  it('見えないタスクは not_found（存在を漏らさない）', () => {
    const { log, ctx, taskId } = withCustomerTask();
    expectDomainError(() => setAttribute(log.state(), bob, ctx, { taskId, name: 'status', value: 'doing' }), 'not_found');
    expectDomainError(() => setAttribute(log.state(), eve, ctx, { taskId, name: 'status', value: 'doing' }), 'not_found');
  });
});

describe('close / reopen', () => {
  it('状態が変わるときだけイベントを返す（冪等）', () => {
    const { log, taskId } = withCustomerTask();
    expect(reopenTask(log.state(), alice, { taskId })).toEqual([]);
    const closed = closeTask(log.state(), alice, { taskId, reason: '完了' });
    expect(closed).toHaveLength(1);
    log.push(closed, T0);
    expect(closeTask(log.state(), alice, { taskId })).toEqual([]);
    expect(reopenTask(log.state(), alice, { taskId })).toHaveLength(1);
  });
});

describe('proposeDerivation', () => {
  it('宛先 Party がいれば external、いなければ internal', () => {
    const { log, ctx, taskId } = withCustomerTask();
    const p = log.state();
    const internal = proposeDerivation(p, alice, ctx, { taskId, targetListId: 'l_int', body: 'x' }).events[0]!;
    expect(internal.type === 'DerivationProposed' && internal.payload.mode).toBe('internal');
    const external = proposeDerivation(p, alice, ctx, {
      taskId,
      targetListId: 'l_partner',
      body: 'x',
      toPartyIds: ['p_dave'],
      replyExpected: { by: '2026-10-20T00:00:00.000Z' },
    }).events[0]!;
    expect(external.type === 'DerivationProposed' && external.payload.mode).toBe('external');
  });

  it('外部派生は返事期待が必須、内部派生は省略可', () => {
    const { log, ctx, taskId } = withCustomerTask();
    expectDomainError(
      () => proposeDerivation(log.state(), alice, ctx, { taskId, targetListId: 'l_partner', body: 'x', toPartyIds: ['p_dave'] }),
      'invalid',
    );
    expect(() => proposeDerivation(log.state(), alice, ctx, { taskId, targetListId: 'l_int', body: 'x' })).not.toThrow();
  });

  it('同じリスト・別テナントのリスト・別テナントの Party・空の本文は拒否', () => {
    const { log, ctx, taskId } = withCustomerTask();
    const p = log.state();
    expectDomainError(() => proposeDerivation(p, alice, ctx, { taskId, targetListId: 'l_cust', body: 'x' }), 'invalid');
    expectDomainError(() => proposeDerivation(p, alice, ctx, { taskId, targetListId: 'l_dev', body: 'x' }), 'invalid');
    expectDomainError(
      () =>
        proposeDerivation(p, alice, ctx, {
          taskId,
          targetListId: 'l_partner',
          body: 'x',
          toPartyIds: ['p_eve'],
          replyExpected: { by: T0 },
        }),
      'invalid',
    );
    expectDomainError(() => proposeDerivation(p, alice, ctx, { taskId, targetListId: 'l_int', body: '  ' }), 'invalid');
    expectDomainError(() => proposeDerivation(p, bob, ctx, { taskId, targetListId: 'l_int', body: 'x' }), 'not_found');
  });

  it('派生先のタスクから元のリストへ出す派生は、自動で返事として扱う', () => {
    const { log, ctx, taskId } = withCustomerTask();
    const first = proposeDerivation(log.state(), alice, ctx, {
      taskId,
      targetListId: 'l_int',
      body: '手配して',
      replyExpected: { by: '2026-10-18T00:00:00.000Z' },
    });
    log.push(first.events, T0);
    log.push(approveDerivation(log.state(), alice, ctx, { derivationId: first.derivationId }).events, T0);
    const internalTask = log.state().derivations[first.derivationId]!.targetTaskId;

    const reply = proposeDerivation(log.state(), alice, ctx, { taskId: internalTask, targetListId: 'l_cust', body: '手配済み' });
    const ev = reply.events[0]!;
    expect(ev.type === 'DerivationProposed' && ev.payload).toMatchObject({
      replyToDerivationId: first.derivationId,
      targetTaskId: taskId,
    });

    // 承認すると元の派生が replied になる
    log.push(reply.events, T0);
    const approved = approveDerivation(log.state(), alice, ctx, { derivationId: reply.derivationId }).events;
    expect(approved.map((e) => e.type)).toEqual(['DerivationReplied', 'DerivationApproved']);
    log.push(approved, T0);
    const p = log.state();
    expect(p.derivations[first.derivationId]!.status).toBe('replied');
    expect(p.tasks[taskId]!.ballAt).toEqual({ kind: 'list', listId: 'l_cust' });
  });

  it('外部への返事の派生: 元の派生は replied、適用先のボールは宛先 Party に残る', () => {
    const { log, ctx, taskId } = withCustomerTask();
    const first = proposeDerivation(log.state(), alice, ctx, { taskId, targetListId: 'l_int', body: '見積して' });
    log.push(first.events, T0);
    log.push(approveDerivation(log.state(), alice, ctx, { derivationId: first.derivationId }).events, T0);
    const internalTask = log.state().derivations[first.derivationId]!.targetTaskId;
    const reply = proposeDerivation(log.state(), alice, ctx, {
      taskId: internalTask,
      targetListId: 'l_cust',
      body: '見積は 38 万円です',
      toPartyIds: ['p_carol'],
      replyExpected: { by: '2026-10-20T00:00:00.000Z' },
    });
    log.push(reply.events, T0);
    log.push(approveDerivation(log.state(), alice, ctx, { derivationId: reply.derivationId }).events, T0);
    const sent = recordSent(log.state(), reply.derivationId, '<q1>');
    expect(sent.map((e) => e.type)).toEqual(['DerivationReplied', 'DerivationSent']);
    log.push(sent, T0);
    const p = log.state();
    expect(p.derivations[first.derivationId]!.status).toBe('replied');
    expect(p.tasks[taskId]!.ballAt).toEqual({ kind: 'party', partyIds: ['p_carol'] });
    expect(p.tasks[internalTask]!.ballAt).toEqual({ kind: 'list', listId: 'l_cust' });
  });

  it('replyToDerivationId の明示が合わなければ invalid', () => {
    const { log, ctx, taskId } = withCustomerTask();
    expectDomainError(
      () => proposeDerivation(log.state(), alice, ctx, { taskId, targetListId: 'l_int', body: 'x', replyToDerivationId: 'drv_x' }),
      'invalid',
    );
  });
});

describe('approve / reject / recordSent', () => {
  function proposedExternal() {
    const { log, ctx, taskId } = withCustomerTask();
    const { events, derivationId } = proposeDerivation(log.state(), alice, ctx, {
      taskId,
      targetListId: 'l_partner',
      body: '見積をお願いします',
      toPartyIds: ['p_dave'],
      replyExpected: { by: '2026-10-20T00:00:00.000Z' },
    });
    log.push(events, T0);
    return { log, ctx, taskId, derivationId };
  }

  it('承認時に宛先 Address を解決して凍結し、送信元を選び、SendPlan を返す', () => {
    const { log, ctx, derivationId } = proposedExternal();
    const { events, send } = approveDerivation(log.state(), alice, ctx, { derivationId });
    expect(events[0]).toMatchObject({
      type: 'DerivationApproved',
      payload: {
        fromAddress: { channel: 'email', value: 'support@ubs.example' },
        // 期間切れの old@dave.example は使わない
        toAddresses: [{ channel: 'email', value: 'info@dave.example' }],
      },
    });
    expect(send).toMatchObject({
      principal: { kind: 'organization', tenantId: 'ubs' },
      to: [{ channel: 'email', value: 'info@dave.example' }],
      body: '見積をお願いします',
    });
  });

  it('送信元を指定でき、Viewer が使えない資格情報は forbidden', () => {
    const { log, ctx, derivationId } = proposedExternal();
    const own = approveDerivation(log.state(), alice, ctx, { derivationId, fromAddress: { channel: 'email', value: 'alice@ubs.example' } });
    expect(own.send?.principal).toEqual({ kind: 'user', userId: 'u_alice' });
    expectDomainError(
      () => approveDerivation(log.state(), alice, ctx, { derivationId, fromAddress: { channel: 'email', value: 'carol@example.com' } }),
      'forbidden',
    );
  });

  it('承認できるのは提案中だけ。送信元リストのメンバーでなければ not_found', () => {
    const { log, ctx, derivationId } = proposedExternal();
    expectDomainError(() => approveDerivation(log.state(), bob, ctx, { derivationId }), 'not_found');
    log.push(rejectDerivation(log.state(), alice, { derivationId, reason: '不要' }), T0);
    expectDomainError(() => approveDerivation(log.state(), alice, ctx, { derivationId }), 'conflict');
    expectDomainError(() => rejectDerivation(log.state(), alice, { derivationId, reason: 'x' }), 'conflict');
  });

  it('recordSent は承認済みの外部派生だけ', () => {
    const { log, ctx, derivationId } = proposedExternal();
    expectDomainError(() => recordSent(log.state(), derivationId, '<m>'), 'conflict');
    log.push(approveDerivation(log.state(), alice, ctx, { derivationId }).events, T0);
    expect(recordSent(log.state(), derivationId, '<m>')).toEqual([
      { type: 'DerivationSent', payload: { derivationId, sentRef: '<m>' } },
    ]);
    expectDomainError(() => recordSent(log.state(), 'drv_none', '<m>'), 'not_found');
  });
});

describe('scanOverdue（期限の見回り）', () => {
  it('期限を過ぎた sent と、適用済みの内部派生にだけ出し、2 回目以降は出さない', () => {
    const { log, ctx, taskId } = withCustomerTask();
    const ext = proposeDerivation(log.state(), alice, ctx, {
      taskId,
      targetListId: 'l_partner',
      body: 'x',
      toPartyIds: ['p_dave'],
      replyExpected: { by: '2026-10-17T00:00:00.000Z' },
    });
    log.push(ext.events, T0);
    const int = proposeDerivation(log.state(), alice, ctx, {
      taskId,
      targetListId: 'l_int',
      body: 'y',
      replyExpected: { by: '2026-10-18T00:00:00.000Z' },
    });
    log.push(int.events, T0);
    const noReply = proposeDerivation(log.state(), alice, ctx, { taskId, targetListId: 'l_int', body: 'z' });
    log.push(noReply.events, T0);

    // 提案中は対象外
    expect(scanOverdue(log.state(), '2026-12-31T00:00:00.000Z')).toEqual([]);

    log.push(approveDerivation(log.state(), alice, ctx, { derivationId: ext.derivationId }).events, T0);
    // 承認済みでも未送信の外部派生は対象外
    expect(scanOverdue(log.state(), '2026-12-31T00:00:00.000Z')).toEqual([]);
    log.push(recordSent(log.state(), ext.derivationId, '<s1>'), T0);
    log.push(approveDerivation(log.state(), alice, ctx, { derivationId: int.derivationId }).events, T0);
    log.push(approveDerivation(log.state(), alice, ctx, { derivationId: noReply.derivationId }).events, T0);

    const ids = (evs: DraftEvent[]) => evs.map((e) => (e.type === 'ReplyOverdue' ? e.payload.derivationId : ''));
    expect(scanOverdue(log.state(), '2026-10-16T23:00:00.000Z')).toEqual([]);
    const first = scanOverdue(log.state(), '2026-10-17T00:00:00.000Z');
    expect(ids(first)).toEqual([ext.derivationId]);
    log.push(first, '2026-10-17T00:00:00.000Z');
    expect(scanOverdue(log.state(), '2026-10-17T00:00:00.000Z')).toEqual([]);
    expect(ids(scanOverdue(log.state(), '2026-10-19T00:00:00.000Z'))).toEqual([int.derivationId]);
  });
});

describe('correctIngest', () => {
  it('人の訂正は decidedBy=human で追記され、元の判断は消えない', () => {
    const { log, ctx, taskId } = withCustomerTask();
    const signalId = log.state().tasks[taskId] && Object.keys(log.state().signals)[0]!;
    const events = correctIngest(log.state(), alice, ctx, { signalId, decision: { kind: 'ignore' }, reason: '迷惑メール' });
    expect(events[0]).toMatchObject({
      type: 'IngestDecided',
      payload: { decision: { kind: 'ignore' }, decidedBy: 'human', confidence: 1, actorUserId: 'u_alice' },
    });
    log.push(events, T0);
    expect(log.events.filter((e) => e.type === 'IngestDecided')).toHaveLength(2);
  });

  it('取得主体ルールで置けないリストへの付け替えは invalid、見えないシグナルは not_found', () => {
    const { log, ctx } = withCustomerTask();
    const signalId = Object.keys(log.state().signals)[0]!;
    // l_int は email の Organization 主体の許可リストにない
    expectDomainError(
      () => correctIngest(log.state(), alice, ctx, { signalId, decision: { kind: 'new', listId: 'l_int', title: 'x' }, reason: 'r' }),
      'invalid',
    );
    expectDomainError(
      () => correctIngest(log.state(), bob, ctx, { signalId, decision: { kind: 'ignore' }, reason: 'r' }),
      'not_found',
    );
    expectDomainError(() => correctIngest(log.state(), eve, ctx, { signalId, decision: { kind: 'ignore' }, reason: 'r' }), 'not_found');
  });

  it('付け替え先がリストのメンバーでなければ invalid（Bob の協力会社リストには Alice は置けない）', () => {
    const { log, ctx } = withCustomerTask();
    const signalId = Object.keys(log.state().signals)[0]!;
    expectDomainError(
      () => correctIngest(log.state(), alice, ctx, { signalId, decision: { kind: 'new', listId: 'l_partner', title: 'x' }, reason: 'r' }),
      'invalid',
    );
  });
});
