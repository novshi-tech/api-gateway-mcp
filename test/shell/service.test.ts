import { describe, expect, it } from 'vitest';
import { canonicalJson, DomainError, draft, type AiDecision } from '../../src/domain';
import { memoryRepo } from '../../src/store/memory';
import { ConcurrencyError, type Repo } from '../../src/store/types';
import { makeService, ManualClock } from '../helpers/service';
import { email, seed } from '../helpers/world';

const newIn = (list = 'l_cust', title = '雨漏り'): AiDecision => ({ decision: 'new', task_id: null, list_id: list, title, reason: '新規', confidence: 0.9 });

describe('MurmurService.ingest', () => {
  it('受信 → AI 判断 → タスク。同じ source_ref は duplicate', async () => {
    const { service, decider } = await makeService(seed, { decide: () => newIn() });
    const r = await service.ingest('ubs', email({ from: 'carol@example.com', sourceRef: 'r1', anchors: { messageId: '<m1>' } }));
    expect(r).toMatchObject({ status: 'created', decidedBy: 'ai' });
    expect(decider.requests).toHaveLength(1);
    expect(await service.ingest('ubs', email({ from: 'carol@example.com', sourceRef: 'r1' }))).toMatchObject({ status: 'duplicate' });
    // アンカーで決まるものは AI に渡さない
    const r2 = await service.ingest('ubs', email({ from: 'carol@example.com', sourceRef: 'r2', anchors: { inReplyTo: '<m1>' } }));
    expect(r2).toMatchObject({ status: 'attached', decidedBy: 'anchor' });
    expect(decider.requests).toHaveLength(1);
  });

  it('自分側からの送信は observed-sent になり、返事期待は推定器が埋める', async () => {
    const { service } = await makeService(seed, {
      decide: () => newIn(),
      estimator: { estimate: async () => ({ replyExpectedBy: '2026-10-20T00:00:00.000Z', by: 'ai' }) },
    });
    await service.ingest('ubs', email({ from: 'alice@ubs.example', to: [{ channel: 'email', value: 'carol@example.com' }], sourceRef: 'o1', acquiredAs: { kind: 'user', userId: 'u_alice' } }));
    const p = await service.state('ubs');
    const t = Object.values(p.tasks)[0]!;
    expect(t).toMatchObject({ ballAt: { kind: 'party', partyIds: ['p_carol'] }, replyExpectedBy: '2026-10-20T00:00:00.000Z' });
  });
});

describe('派生の承認と送信（ダミーコネクタ）', () => {
  async function setup(echoObserved = false) {
    const ctx = await makeService(seed, { decide: () => newIn(), echoObserved });
    await ctx.service.ingest('ubs', email({ from: 'carol@example.com', sourceRef: 'r1', anchors: { messageId: '<m1>' } }));
    const [task] = await ctx.service.listMyTasks('u_alice');
    return { ...ctx, taskId: task!.id };
  }

  it('外部派生は承認でそのまま送られ sent になる。送信ログに宛先・返信先が残る', async () => {
    const { service, backend, taskId } = await setup();
    const d = await service.proposeDerivation('u_alice', {
      taskId,
      targetListId: 'l_partner',
      body: '見積を',
      toPartyIds: ['p_dave'],
      replyExpected: { by: '2026-10-20T00:00:00.000Z' },
    });
    expect(d.status).toBe('proposed');
    expect(await service.listProposals('u_alice')).toHaveLength(1);
    const approved = await service.approveDerivation('u_alice', { derivationId: d.id });
    expect(approved.status).toBe('sent');
    expect(backend.sent).toHaveLength(1);
    expect(backend.sent[0]!.message).toMatchObject({ to: [{ value: 'info@dave.example' }], body: '見積を' });
    expect(await service.listProposals('u_alice')).toHaveLength(0);
  });

  it('H5: echoObserved で戻ってきた送信は 1 本に統合され、状態が二重に変わらない', async () => {
    const { service, taskId } = await setup(true);
    const d = await service.proposeDerivation('u_alice', {
      taskId,
      targetListId: 'l_partner',
      body: '見積を',
      toPartyIds: ['p_dave'],
      replyExpected: { by: '2026-10-20T00:00:00.000Z' },
    });
    await service.approveDerivation('u_alice', { derivationId: d.id });
    const before = await service.state('ubs');
    const results = await service.pollConnectors();
    expect(results).toEqual([{ status: 'merged', derivationId: d.id }]);
    const after = await service.state('ubs');
    expect(canonicalJson(after)).toBe(canonicalJson(before));
  });

  it('本文を省略すると境界越えの要約を使う', async () => {
    const { service, taskId } = await setup();
    const d = await service.proposeDerivation('u_alice', { taskId, targetListId: 'l_int', instruction: '手配を依頼' });
    expect(d.body).toBe('[工事部向け要約] 手配を依頼');
  });

  it('見えない派生・タスクは not_found', async () => {
    const { service, taskId } = await setup();
    await expect(service.getTask('u_bob', taskId)).rejects.toBeInstanceOf(DomainError);
    await expect(service.approveDerivation('u_alice', { derivationId: 'drv_none' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(service.correctIngest('u_eve', { signalId: 'sig_1', decision: { kind: 'ignore' }, reason: 'x' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('期限の見回り', () => {
  it('H4: 見回りを止めて再開しても ReplyOverdue は二重に出ない', async () => {
    const clock = new ManualClock('2026-10-16T09:00:00.000Z');
    const { service, repo } = await makeService(seed, { decide: () => newIn(), clock });
    await service.ingest('ubs', email({ from: 'carol@example.com', sourceRef: 'r1' }));
    const [task] = await service.listMyTasks('u_alice');
    const d = await service.proposeDerivation('u_alice', {
      taskId: task!.id,
      targetListId: 'l_partner',
      body: 'x',
      toPartyIds: ['p_dave'],
      replyExpected: { by: '2026-10-17T00:00:00.000Z' },
    });
    await service.approveDerivation('u_alice', { derivationId: d.id });

    expect(await service.checkOverdue()).toBe(0);
    // 見回りが止まっている間に期限が過ぎ、何度も再開される
    clock.set('2026-10-18T00:00:00.000Z');
    expect(await service.checkOverdue()).toBe(1);
    expect(await service.checkOverdue()).toBe(0);
    clock.set('2026-10-25T00:00:00.000Z');
    expect((await service.tick()).overdue).toBe(0);
    const overdue = (await repo.events.read('ubs')).filter((e) => e.type === 'ReplyOverdue');
    expect(overdue).toHaveLength(1);
    expect(await service.listMyTasks('u_alice', 'overdue')).toHaveLength(1);

    // 遅れて返事が来れば replied に進む
    const sentRef = (await service.state('ubs')).derivations[d.id]!.sentRef!;
    await service.ingest('ubs', email({ from: 'info@dave.example', sourceRef: 'r9', anchors: { inReplyTo: sentRef } }));
    expect((await service.state('ubs')).derivations[d.id]!.status).toBe('replied');
    expect(await service.listMyTasks('u_alice', 'overdue')).toHaveLength(0);
  });
});

describe('投影と並行性', () => {
  it('投影が遅れていても state() がイベントから追いつき、rebuild で作り直せる', async () => {
    const { service, repo } = await makeService(seed, { decide: () => newIn() });
    await service.ingest('ubs', email({ from: 'carol@example.com', sourceRef: 'r1' }));
    const full = await service.state('ubs');
    // 投影の保存に失敗したのと同じ状態を作る
    await repo.events.append('ubs', full.lastSeq, [draft('TaskClosed', { taskId: Object.keys(full.tasks)[0]! })], '2026-10-16T10:00:00.000Z');
    const caughtUp = await service.state('ubs');
    expect(Object.values(caughtUp.tasks)[0]!.status).toBe('closed');
    expect(canonicalJson(await service.rebuild('ubs'))).toBe(canonicalJson(caughtUp));
  });

  it('追記が競合したら読み直してやり直す', async () => {
    const inner = memoryRepo();
    let conflicts = 1;
    const repo: Repo = {
      ...inner,
      events: {
        read: (t, a) => inner.events.read(t, a),
        append: async (t, seq, drafts, at) => {
          if (conflicts-- > 0) {
            // 別のリクエストが先に書いた
            await inner.events.append(t, seq, [draft('SignalReceived', {
              signalId: 'sig_other',
              channel: 'email',
              from: { channel: 'email', value: 'x@y' },
              to: [],
              body: 'other',
              sourceRef: 'other',
              acquiredAs: { kind: 'organization', tenantId: 'ubs' },
            })], at);
            throw new ConcurrencyError(t, seq);
          }
          return inner.events.append(t, seq, drafts, at);
        },
      },
    };
    const { service } = await makeService(seed, { repo, decide: () => newIn() });
    await service.ingest('ubs', email({ from: 'carol@example.com', sourceRef: 'r1' }));
    const events = await repo.events.read('ubs');
    expect(events.map((e) => e.type)).toEqual(['SignalReceived', 'SignalReceived', 'IngestDecided']);
  });

  it('/me は User と各テナントの Party を返す', async () => {
    const { service } = await makeService(seed);
    const me = await service.me('u_alice');
    expect(me.parties.map((p) => [p.tenantId, p.partyId])).toEqual([
      ['ubs', 'p_alice'],
      ['nvt', 'p_alice_nvt'],
    ]);
    await expect(service.me('u_ghost')).rejects.toMatchObject({ code: 'not_found' });
  });
});
