import { describe, expect, it } from 'vitest';
import {
  deriveViewer,
  Directory,
  isMyTurn,
  listThreads,
  planMirror,
  Seed,
  turnOf,
  type CoreContext,
  type InboundMirror,
  type InboundSignal,
} from '../../src/domain';
import { EventLog, ingestPure } from '../helpers/world';

// 再現: Jira の共有リスト（読者は直樹だけ）で、担当者でも起票者でもない読者の「自分の番」に回る（2026-11-06 の実測。SPW-2475）。
// - 担当者（会田さん）と起票者（山本さん）の accountId は Contact に結ばれていない
// - 起票のシグナル（山本さん → 会田さん）を AI が needs_response=true と判定すると、ボールは「こちら」になり、
//   holders が解決できないので holderTurn が効かず、「読者が 1 人」で直樹の番（by: reader）になる
// 期待: 自分の番になるのは、自分が holder・自分宛て・自分が持った（claim）もののいずれかだけ（H8・H9）
// 修正は docs/adr/0038（案）の採用後。それまでは今の挙動で失敗することを it.fails で示す。0038 を実装したら、
// 期待値を新しい形（担当・名指し）に書き直して it に戻す

const NAOKI = '5b44424e141cd45ff0698a68';
const AIDA = '712020:a9769c40-7345-4c70-8abe-7b57675aac93';
const YAMAMOTO = '63abca9efa5fbde2ba44a295';
const jira = (value: string) => ({ channel: 'jira' as const, value });

const seed = Seed.parse({
  users: [{ id: 'u_naoki', name: '直樹' }],
  contacts: [{ id: 'p_naoki', name: '直樹', userId: 'u_naoki' }],
  addresses: [{ id: 'a_naoki_jira', channel: 'jira', value: NAOKI, contactId: 'p_naoki' }],
  credentialRefs: [{ id: 'c_spw', principal: { kind: 'user', userId: 'u_naoki' }, address: jira(NAOKI) }],
  dataSources: [
    {
      kind: 'service',
      id: 'ds_423931eacf1448b08e6f',
      channel: 'jira',
      name: 'Jira SPW',
      credentialRefId: 'c_spw',
      selfAddresses: [],
      shared: { spaceKey: 'jira:urban-b/SPW', createdBy: 'u_naoki' },
    },
  ],
  lists: [{ id: 'l_spw', dataSourceId: 'ds_423931eacf1448b08e6f' }],
  listMembers: [{ listId: 'l_spw', userId: 'u_naoki' }],
});
const dir = new Directory(seed);
const naoki = deriveViewer(dir, 'u_naoki');
const DS = 'ds_423931eacf1448b08e6f';

function ctxAt(now: string): CoreContext {
  let n = 0;
  return { dir, now, newId: (prefix: string) => `${prefix}_${++n}` };
}

const mirror = (key: string, fields: InboundMirror['fields']): InboundMirror => ({
  kind: 'mirror',
  dataSourceId: DS,
  channel: 'jira',
  threadKey: key,
  fields,
  sourceRef: `jira:${key}@u1`,
});

/** normalize.ts の createdSignal と同じ形（宛先は担当者、起票した本人は除く） */
const created = (key: string, from: string, to: string[]): InboundSignal => ({
  dataSourceId: DS,
  channel: 'jira',
  from: jira(from),
  to: to.map(jira),
  subject: `[${key}] 件名`,
  body: '',
  anchors: { messageId: key, threadKey: key },
  sourceRef: `jira:${key}`,
  occurredAt: '2026-11-05T05:52:08.000Z',
});

const answer = (needs_response: boolean) => () => ({ thread: null, thread_id: null, title: null, needs_response, reason: 'r', confidence: 1 });

/** 写し → 起票のシグナルの順で取り込む（sync.ts の itemsOfIssue と同じ順） */
function issue(key: string, holders: string[], from: string, needsResponse: boolean) {
  const log = new EventLog();
  const ctx = ctxAt('2026-11-05T05:52:07.000Z');
  const plan = planMirror(log.state(), ctx, mirror(key, { closed: false, holders, title: key, statusLabel: '請求待ち', due: '2026-11-30' }));
  if (plan.kind !== 'mirrored') throw new Error('mirror not applied');
  log.push(plan.events, ctx.now);
  ingestPure(log, { ...ctx, now: '2026-11-05T05:52:08.000Z' }, created(key, from, holders.filter((h) => h !== from)), answer(needsResponse));
  const p = log.state();
  return { p, t: p.threads[plan.threadId]! };
}

describe('Jira の共有リストで、読者でない担当者の課題が読者の番に回らない（SPW-2475 の再現）', () => {
  it.fails('H8 H9 担当者が読者でない（Contact に解決できない）課題は、起票のシグナルが「求めている」でも、読者の番にしない', () => {
    const { p, t } = issue('SPW-2475', [AIDA], YAMAMOTO, true);
    // 前提（今の挙動の入力）: ボールはこちら、holders は会田さん
    expect(t.source?.holders).toEqual([AIDA]);
    const turn = turnOf(dir, p, t);
    expect(isMyTurn(turn, naoki)).toBe(false);
    expect(turn).toEqual({ kind: 'contact', contactIds: [], addresses: [jira(AIDA)] });
    expect(listThreads(dir, naoki, p, { filter: 'my_turn' })).toEqual([]);
  });

  it.fails('H8 H9 同じ形で AI が needs_response=false と判定した課題（SPW-2470 相当）と、誰の番が同じになる（AI の判定に依らない）', () => {
    const a = issue('SPW-2475', [AIDA], YAMAMOTO, true);
    const b = issue('SPW-2470', [AIDA], YAMAMOTO, false);
    expect(turnOf(dir, a.p, a.t)).toEqual(turnOf(dir, b.p, b.t));
  });

  it('H8 H9 担当者が読者なら、その人の番（BO-2093 相当。今も通る）', () => {
    const { p, t } = issue('BO-2093', [NAOKI], YAMAMOTO, true);
    expect(turnOf(dir, p, t)).toEqual({ kind: 'user', userIds: ['u_naoki'], by: 'holder' });
  });

  it.fails('H8 共有リストでは「読者が 1 人」を理由に番を決めない。担当者のいない課題の求めは仕分け待ち', () => {
    const { p, t } = issue('SPW-2483', [], YAMAMOTO, true);
    expect(turnOf(dir, p, t)).toEqual({ kind: 'triage' });
  });
});
