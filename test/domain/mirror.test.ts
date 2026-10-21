import { describe, expect, it } from 'vitest';
import {
  deriveViewer,
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

/** world に Jira のプロジェクト（読者は Alice と Bob、組織の資格情報）を足す。Alice と Bob の Jira アカウントは送信元（こちら） */
const seed = Seed.parse({
  ...base,
  addresses: [
    ...base.addresses,
    { id: 'a_jira_site', tenantId: 'ubs', channel: 'jira', value: 'ubs.atlassian.net', partyId: 'p_ubs' },
    { id: 'a_alice_jira', tenantId: 'ubs', channel: 'jira', value: 'jira:alice', partyId: 'p_alice' },
    { id: 'a_bob_jira', tenantId: 'ubs', channel: 'jira', value: 'jira:bob', partyId: 'p_bob' },
    { id: 'a_carol_jira', tenantId: 'ubs', channel: 'jira', value: 'jira:carol', partyId: 'p_carol' },
  ],
  credentialRefs: [...base.credentialRefs, { id: 'c_jira', tenantId: 'ubs', principal: { kind: 'organization', tenantId: 'ubs' }, addressId: 'a_jira_site' }],
  dataSources: [
    ...base.dataSources,
    {
      kind: 'service',
      id: 'ds_jira',
      tenantId: 'ubs',
      channel: 'jira',
      name: 'Jira プロジェクト UBS',
      credentialRefId: 'c_jira',
      selfAddressIds: ['a_jira_site', 'a_alice_jira', 'a_bob_jira'],
    },
  ],
  lists: [...base.lists, { id: 'l_jira', tenantId: 'ubs', dataSourceId: 'ds_jira' }],
  listMembers: [...base.listMembers, { listId: 'l_jira', partyId: 'p_alice' }, { listId: 'l_jira', partyId: 'p_bob' }],
  attributeDefs: [
    ...base.attributeDefs,
    { dataSourceId: 'ds_jira', name: 'status', type: 'string', description: '課題のステータス' },
    { dataSourceId: 'ds_jira', name: 'assignee', type: 'party', description: '担当者' },
    { dataSourceId: 'ds_jira', name: 'due', type: 'date', description: '期日' },
    { dataSourceId: 'ds_jira', name: 'done', type: 'boolean', description: '完了しているか' },
  ],
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
  it('H9 課題キーのスレッドに、変わった属性だけを写す。担当者のアカウントは Party に直す。同じ値なら何もしない', () => {
    const log = new EventLog();
    const ctx = ctxAt();
    expect(planMirror(log.state(), ctx, mirror('UBS-1', { status: '未着手' }))).toEqual({ kind: 'no_thread', threadKey: 'UBS-1' });
    const created = ingestPure(log, ctx, issueEvent('UBS-1'), answer(false));
    const plan = planMirror(log.state(), ctx, mirror('UBS-1', { status: '未着手', assignee: 'jira:alice', due: '2026-10-20', done: false }));
    expect(plan).toMatchObject({ kind: 'mirrored', threadId: created.outcome!.threadId, fields: { status: '未着手', assignee: 'p_alice', due: '2026-10-20', done: false } });
    log.push(plan.kind === 'mirrored' ? plan.events : [], '2026-10-16T09:10:00.000Z');
    expect(planMirror(log.state(), ctx, mirror('UBS-1', { status: '未着手', assignee: 'jira:alice' }, 'u2'))).toEqual({ kind: 'unchanged', threadId: created.outcome!.threadId });
    expect(planMirror(log.state(), ctx, mirror('UBS-1', { status: '進行中', assignee: 'jira:alice' }, 'u3'))).toMatchObject({ fields: { status: '進行中' } });
    // 知らないアカウントは空として写す（誰の番にもならない）
    expect(planMirror(log.state(), ctx, mirror('UBS-1', { assignee: 'jira:unknown' }, 'u4'))).toMatchObject({ fields: { assignee: null } });
    expect(() => planMirror(log.state(), ctx, mirror('UBS-1', { priority: '高' }))).toThrow(/not defined/);
    expect(() => planMirror(log.state(), ctx, mirror('UBS-1', { due: 'あした' }))).toThrow(/not a date/);
    expect(() => planMirror(log.state(), ctx, { ...mirror('UBS-1', {}), dataSourceId: 'ds_support' })).toThrow(/is email, not jira/);
  });

  it('H9 写しの属性は Murmur の側では書けない（set_attribute は断る）', () => {
    const log = new EventLog();
    const ctx = ctxAt();
    const created = ingestPure(log, ctx, issueEvent('UBS-1'), answer(false));
    expect(() => setAttribute(log.state(), alice, dir, { threadId: created.outcome!.threadId, name: 'status', value: '完了' })).toThrow(/mirrored from Jira/);
  });
});

describe('担当者で決まる誰の番（turnOf）', () => {
  it('H9 H8 担当者が読者のユーザーならその人の番（通知でボールが「なし」でも）。持ち主がいればそちら。読者でない相手ならその相手。完了なら誰の番でもない', () => {
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
    apply({ assignee: 'jira:alice', done: false }, 'u1', '2026-10-16T09:10:00.000Z');
    expect(turn()).toEqual({ kind: 'user', userIds: ['u_alice'], by: 'assignee' });
    log.push([draft('ThreadClaimed', { threadId: id, userId: 'u_bob', actorUserId: 'u_bob' })], '2026-10-16T09:20:00.000Z');
    expect(turn()).toEqual({ kind: 'user', userIds: ['u_bob'], by: 'owner' });
    log.push([draft('ThreadClaimed', { threadId: id, userId: null, actorUserId: 'u_bob' })], '2026-10-16T09:30:00.000Z');
    apply({ assignee: 'jira:carol' }, 'u2', '2026-10-16T09:40:00.000Z');
    expect(turn()).toEqual({ kind: 'party', partyIds: ['p_carol'] });
    apply({ assignee: 'jira:alice', done: true }, 'u3', '2026-10-16T09:50:00.000Z');
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
      toPartyIds: ['p_bob'],
      subject: '雨漏りの修繕',
      body: 'Carol さんから雨漏りの連絡。Bob さん現地確認をお願いします',
      sentRef: 'UBS-9',
      sourceThreadId: support.outcome!.threadId,
    });
    log.push(filed.events, ctx.now);
    let p = log.state();
    expect(p.signals[filed.signalId]).toMatchObject({ direction: 'outbound', from: { value: 'jira:alice' }, toPartyIds: ['p_bob'] });
    expect(p.threads[filed.threadId]!.links).toMatchObject([{ threadId: support.outcome!.threadId, route: 'sent' }]);

    const plan = planMirror(p, ctx, mirror('UBS-9', { status: '未着手', assignee: 'jira:bob', done: false }));
    expect(plan).toMatchObject({ kind: 'mirrored', threadId: filed.threadId });
    log.push(plan.kind === 'mirrored' ? plan.events : [], '2026-10-16T10:01:00.000Z');
    p = log.state();
    expect(turnOf(dir, p, p.threads[filed.threadId]!)).toEqual({ kind: 'user', userIds: ['u_bob'], by: 'assignee' });

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
      toPartyIds: [],
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
