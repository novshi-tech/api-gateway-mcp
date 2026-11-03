import { describe, expect, it } from 'vitest';
import {
  deriveViewer,
  directionOf,
  Directory,
  draft,
  planMirror,
  recordSent,
  Seed,
  setAttribute,
  turnOf,
  type CoreContext,
  type InboundMirror,
  type InboundSignal,
} from '../../src/domain';
import { EventLog, ingestPure, seed as base } from '../helpers/world';

// 状態の写しを持つデータソース（Jira。ステップ 7・H9）

/** world に Jira のプロジェクト（読者は Alice と Bob、チームの資格情報）を足す。Alice と Bob の Jira アカウントは読者の Contact のアドレスなのでこちら（0030） */
const seed = Seed.parse({
  ...base,
  addresses: [
    ...base.addresses,
    { id: 'a_alice_jira', channel: 'jira', value: 'jira:alice', contactId: 'p_alice' },
    { id: 'a_bob_jira', channel: 'jira', value: 'jira:bob', contactId: 'p_bob' },
    { id: 'a_carol_jira', channel: 'jira', value: 'jira:carol', contactId: 'p_carol' },
  ],
  credentialRefs: [...base.credentialRefs, { id: 'c_jira', principal: { kind: 'team' }, address: { channel: 'jira', value: 'ubs.atlassian.net' } }],
  dataSources: [
    ...base.dataSources,
    {
      kind: 'service',
      id: 'ds_jira',
      channel: 'jira',
      name: 'Jira プロジェクト UBS',
      credentialRefId: 'c_jira',
      selfAddresses: [{ channel: 'jira', value: 'ubs.atlassian.net' }],
    },
  ],
  lists: [...base.lists, { id: 'l_jira', dataSourceId: 'ds_jira' }],
  listMembers: [...base.listMembers, { listId: 'l_jira', userId: 'u_alice' }, { listId: 'l_jira', userId: 'u_bob' }],
});
const dir = new Directory(seed);
const alice = deriveViewer(dir, 'u_alice');

function ctxAt(now = '2026-10-16T09:00:00.000Z'): CoreContext & { setNow(n: string): void } {
  let n = 0;
  const ctx = { dir, now, newId: (prefix: string) => `${prefix}_${++n}`, setNow: (v: string) => (ctx.now = v) };
  return ctx;
}

const issueEvent = (key: string, over: Partial<InboundSignal> = {}): InboundSignal => ({
  dataSourceId: 'ds_jira',
  channel: 'jira',
  from: { channel: 'jira', value: 'jira:carol' },
  to: [{ channel: 'jira', value: 'ubs.atlassian.net' }],
  subject: `[${key}] 雨漏りの修繕`,
  body: `Carol が ${key} を作成しました`,
  anchors: { messageId: `jira:${key}:created`, threadKey: key, jiraKeys: [key] },
  sourceRef: `jira:${key}:created`,
  ...over,
});

const mirror = (key: string, fields: InboundMirror['fields'], ref = 'u1'): InboundMirror => ({
  kind: 'mirror',
  dataSourceId: 'ds_jira',
  channel: 'jira',
  threadKey: key,
  fields,
  sourceRef: `jira:${key}:${ref}`,
});

const answer = (needs_response: boolean) => () => ({ thread: null, thread_id: null, title: null, needs_response, reason: 'r', confidence: 1 });

describe('状態の写し（planMirror）', () => {
  it('H9 課題キーのスレッドに、決まった形の写しの変わった項目だけを写す。holders はアカウントのまま（Contact への解決はクエリ層、0030）。同じ値なら何もしない（0031）', () => {
    const log = new EventLog();
    const ctx = ctxAt();
    expect(planMirror(log.state(), ctx, mirror('UBS-1', { statusLabel: '未着手' }))).toEqual({ kind: 'no_thread', threadKey: 'UBS-1' });
    const created = ingestPure(log, ctx, issueEvent('UBS-1'), answer(false));
    const id = created.outcome!.threadId;
    const plan = planMirror(log.state(), ctx, mirror('UBS-1', { statusLabel: '未着手', holders: ['jira:alice'], due: '2026-10-20', closed: false }));
    // closed: false は今と同じなので写さない
    expect(plan).toMatchObject({ kind: 'mirrored', threadId: id, fields: { statusLabel: '未着手', holders: ['jira:alice'], due: '2026-10-20' } });
    expect(plan.kind === 'mirrored' && 'closed' in plan.fields).toBe(false);
    log.push(plan.kind === 'mirrored' ? plan.events : [], '2026-10-16T09:10:00.000Z');
    expect(log.state().threads[id]!.source).toEqual({ holders: ['jira:alice'], statusLabel: '未着手', due: '2026-10-20' });
    expect(log.state().threads[id]!.attributes).toEqual({});
    expect(planMirror(log.state(), ctx, mirror('UBS-1', { statusLabel: '未着手', holders: ['jira:alice', 'jira:alice'] }, 'u2'))).toEqual({ kind: 'unchanged', threadId: id });
    expect(planMirror(log.state(), ctx, mirror('UBS-1', { statusLabel: '進行中', holders: ['jira:alice'] }, 'u3'))).toEqual(expect.objectContaining({ fields: { statusLabel: '進行中' } }));
    // 知らないアカウントもそのまま写す（名寄せされるまで誰の番にもならない）。holders は重複を除いて並べる
    expect(planMirror(log.state(), ctx, mirror('UBS-1', { holders: ['jira:unknown', 'jira:alice'] }, 'u4'))).toMatchObject({ fields: { holders: ['jira:alice', 'jira:unknown'] } });
    // 件名も写す
    expect(planMirror(log.state(), ctx, mirror('UBS-1', { title: '雨漏りの修繕（2F）' }, 'u5'))).toMatchObject({ fields: { title: '雨漏りの修繕（2F）' } });
    // 決まった形のほかは受けない
    expect(() => planMirror(log.state(), ctx, mirror('UBS-1', { priority: '高' } as never))).toThrow(/mirror fields/);
    expect(() => planMirror(log.state(), ctx, mirror('UBS-1', { due: 'あした' }))).toThrow(/not a date/);
    expect(() => planMirror(log.state(), ctx, { ...mirror('UBS-1', {}), dataSourceId: 'ds_support' })).toThrow(/is email, not jira/);
  });

  it('H9 課題キーのスレッドがまだなければ、件名のある写しでスレッドを作る。あとから届いた作成の通知は課題キーで同じスレッドに入る（0031 の 8）', () => {
    const log = new EventLog();
    const ctx = ctxAt();
    // 件名がなければ作らない
    expect(planMirror(log.state(), ctx, mirror('UBS-3', { statusLabel: '未着手' }))).toEqual({ kind: 'no_thread', threadKey: 'UBS-3' });
    const plan = planMirror(log.state(), ctx, mirror('UBS-3', { title: '雨漏りの修繕', statusLabel: '未着手', holders: ['jira:bob', 'jira:bob'], closed: false }));
    expect(plan).toMatchObject({ kind: 'mirrored', newThread: true, fields: { title: '雨漏りの修繕', statusLabel: '未着手', holders: ['jira:bob'], closed: false } });
    if (plan.kind !== 'mirrored') throw new Error('unreachable');
    log.push(plan.events, '2026-10-16T09:00:00.000Z');
    let p = log.state();
    const t = p.threads[plan.threadId]!;
    expect(t).toMatchObject({ dataSourceId: 'ds_jira', title: '雨漏りの修繕', signalIds: [], sourceKey: 'UBS-3', source: { holders: ['jira:bob'], statusLabel: '未着手', due: null } });
    expect(turnOf(dir, p, t)).toEqual({ kind: 'user', userIds: ['u_bob'], by: 'holder' });
    // 同じ写しがもう一度来ても作らない
    expect(planMirror(p, ctx, mirror('UBS-3', { title: '雨漏りの修繕', holders: ['jira:bob'] }, 'u2'))).toEqual({ kind: 'unchanged', threadId: plan.threadId });
    // 作成の通知があとから届く
    const created = ingestPure(log, ctx, issueEvent('UBS-3'), answer(false));
    expect(created.outcome).toMatchObject({ threadId: plan.threadId, newThread: false, by: 'anchor' });
    p = log.state();
    expect(p.threads[plan.threadId]).toMatchObject({ title: '雨漏りの修繕', signalIds: [created.signalId] });
    expect(Object.keys(p.threads)).toHaveLength(1);
  });

  it('H9 写しは Murmur の側では書けない（外のサービスのスレッドに set_attribute は断る）', () => {
    const log = new EventLog();
    const ctx = ctxAt();
    const created = ingestPure(log, ctx, issueEvent('UBS-1'), answer(false));
    expect(() => setAttribute(log.state(), alice, dir, { threadId: created.outcome!.threadId, name: 'status', value: '完了' })).toThrow(/mirrored from Jira/);
  });
});

describe('ソースでボールを持つ人で決まる誰の番（turnOf）', () => {
  it('H9 H8 holders に読者のユーザーがいればその人の番（通知でボールが「なし」でも）。持ち主がいればそちら。読者でない相手ならその相手。完了なら誰の番でもない', () => {
    const log = new EventLog();
    const ctx = ctxAt();
    const { outcome } = ingestPure(log, ctx, issueEvent('UBS-1'), answer(false));
    const id = outcome!.threadId;
    const turn = () => turnOf(dir, log.state(), log.state().threads[id]!);
    // 担当者なし: 求めていない通知でボールは「なし」
    expect(turn()).toEqual({ kind: 'none' });
    const apply = (fields: InboundMirror['fields'], ref: string, at: string) => {
      const plan = planMirror(log.state(), ctx, mirror('UBS-1', fields, ref));
      if (plan.kind === 'mirrored') log.push(plan.events, at);
    };
    apply({ holders: ['jira:alice'], closed: false }, 'u1', '2026-10-16T09:10:00.000Z');
    expect(turn()).toEqual({ kind: 'user', userIds: ['u_alice'], by: 'holder' });
    log.push([draft('ThreadClaimed', { threadId: id, userId: 'u_bob', actorUserId: 'u_bob' })], '2026-10-16T09:20:00.000Z');
    expect(turn()).toEqual({ kind: 'user', userIds: ['u_bob'], by: 'owner' });
    log.push([draft('ThreadClaimed', { threadId: id, userId: null, actorUserId: 'u_bob' })], '2026-10-16T09:30:00.000Z');
    apply({ holders: ['jira:carol'] }, 'u2', '2026-10-16T09:40:00.000Z');
    expect(turn()).toEqual({ kind: 'contact', contactIds: ['p_carol'] });
    // だれも持っていなければシグナルのボールのまま（手放したのでこちら → 仕分け待ち）
    apply({ holders: [] }, 'u3', '2026-10-16T09:45:00.000Z');
    expect(turn()).toEqual({ kind: 'triage' });
    apply({ holders: ['jira:alice'], closed: true }, 'u4', '2026-10-16T09:50:00.000Z');
    expect(turn()).toEqual({ kind: 'none' });
  });

  it('H9 holders が複数（PR のレビュアーなど）なら、読者のユーザー全員の番。読者がいなければ相手全員。解決できないアカウントは数えない（0031）', () => {
    const log = new EventLog();
    const ctx = ctxAt();
    const { outcome } = ingestPure(log, ctx, issueEvent('UBS-2'), answer(false));
    const id = outcome!.threadId;
    const turn = () => turnOf(dir, log.state(), log.state().threads[id]!);
    const apply = (fields: InboundMirror['fields'], ref: string, at: string) => {
      const plan = planMirror(log.state(), ctx, mirror('UBS-2', fields, ref));
      if (plan.kind === 'mirrored') log.push(plan.events, at);
    };
    apply({ holders: ['jira:bob', 'jira:carol', 'jira:alice'] }, 'u1', '2026-10-16T09:10:00.000Z');
    expect(turn()).toEqual({ kind: 'user', userIds: ['u_alice', 'u_bob'], by: 'holder' });
    apply({ holders: ['jira:carol', 'jira:unknown'] }, 'u2', '2026-10-16T09:20:00.000Z');
    expect(turn()).toEqual({ kind: 'contact', contactIds: ['p_carol'] });
    // だれにも解決できなければ、シグナルのボールのまま
    apply({ holders: ['jira:unknown'] }, 'u3', '2026-10-16T09:30:00.000Z');
    expect(turn()).toEqual({ kind: 'none' });
  });
});

describe('起票とコメントの記録（Jira）', () => {
  it('H9 起票を記録すると課題のスレッドができ、元のスレッドと経路 sent で結ばれる。写しとコメントは課題キーでそのスレッドに入る', () => {
    const log = new EventLog();
    const ctx = ctxAt();
    const support = ingestPure(
      log,
      ctx,
      { dataSourceId: 'ds_support', channel: 'email', from: { channel: 'email', value: 'carol@example.com' }, to: [{ channel: 'email', value: 'support@ubs.example' }], body: '雨漏りです', sourceRef: 'm1' },
      answer(true),
    );
    ctx.setNow('2026-10-16T10:00:00.000Z');
    // スタンドがゲートウェイ経由で起票し、課題キーを sent_ref にして記録する（thread_key は付け忘れても課題キーで引ける）
    const filed = recordSent(log.state(), alice, ctx, {
      dataSourceId: 'ds_jira',
      to: [],
      toContactIds: ['p_bob'],
      from: 'jira:alice',
      subject: '雨漏りの修繕',
      body: 'Carol さんから雨漏りの連絡。Bob さん現地確認をお願いします',
      sentRef: 'UBS-9',
      sourceThreadId: support.outcome!.threadId,
    });
    log.push(filed.events, ctx.now);
    let p = log.state();
    expect(p.signals[filed.signalId]).toMatchObject({ from: { value: 'jira:alice' }, to: [{ value: 'jira:bob' }] });
    expect(directionOf(dir, p.signals[filed.signalId]!)).toBe('outbound');
    expect(p.threads[filed.threadId]!.links).toMatchObject([{ threadId: support.outcome!.threadId, route: 'sent' }]);

    const plan = planMirror(p, ctx, mirror('UBS-9', { statusLabel: '未着手', holders: ['jira:bob'], closed: false }));
    expect(plan).toMatchObject({ kind: 'mirrored', threadId: filed.threadId });
    log.push(plan.kind === 'mirrored' ? plan.events : [], '2026-10-16T10:01:00.000Z');
    p = log.state();
    expect(turnOf(dir, p, p.threads[filed.threadId]!)).toEqual({ kind: 'user', userIds: ['u_bob'], by: 'holder' });

    // Bob が Jira で直接書いたコメント（観測された送信）は課題キーで同じスレッドに入る
    ctx.setNow('2026-10-16T11:00:00.000Z');
    const comment = ingestPure(log, ctx, issueEvent('UBS-9', {
      from: { channel: 'jira', value: 'jira:bob' },
      subject: undefined,
      body: '明日見に行きます',
      anchors: { messageId: 'UBS-9#c1', threadKey: 'UBS-9' },
      sourceRef: 'jira:UBS-9#c1',
    }));
    expect(comment.outcome).toMatchObject({ threadId: filed.threadId, newThread: false, by: 'anchor', needsResponse: null });
  });

  it('H5 H9 スタンド経由のコメントを記録してから観測が届いても 1 本（コメント ID が sent_ref）', () => {
    const log = new EventLog();
    const ctx = ctxAt();
    const { outcome } = ingestPure(log, ctx, issueEvent('UBS-1'), answer(false));
    ctx.setNow('2026-10-16T10:00:00.000Z');
    const rec = recordSent(log.state(), alice, ctx, {
      dataSourceId: 'ds_jira',
      to: ['jira:carol'],
      toContactIds: [],
      body: '明日伺います',
      sentRef: 'UBS-1#c7',
      anchors: { threadKey: 'UBS-1' },
    });
    log.push(rec.events, ctx.now);
    expect(rec.threadId).toBe(outcome!.threadId);
    ctx.setNow('2026-10-16T10:01:00.000Z');
    const echo = ingestPure(log, ctx, issueEvent('UBS-1', { from: { channel: 'jira', value: 'jira:alice' }, body: '明日伺います', anchors: { messageId: 'UBS-1#c7', threadKey: 'UBS-1' }, sourceRef: 'jira:UBS-1#c7' }));
    expect(echo.duplicate).toBe(true);
    expect(log.state().threads[outcome!.threadId]!.signalIds).toHaveLength(2);
  });
});
