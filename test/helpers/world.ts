import {
  DEFAULT_POLICY,
  Directory,
  Seed,
  deriveViewer,
  emptyProjections,
  finalizeIngest,
  fold,
  planIngest,
  prepareInbound,
  signalEvent,
  type AiIngestDecision,
  type CoreContext,
  type DomainEvent,
  type DraftEvent,
  type InboundSignal,
  type IngestOutcome,
  type IngestRequest,
  type Projections,
} from '../../src/domain';

/**
 * コアのユニットテスト用の小さな世界。
 * 1 デプロイ = 1 チーム（UBS）:
 *   ds_support   support@（組織の資格情報、読者は Alice と Bob）
 *   ds_alice     Alice の個人のメールボックス（読者は Alice だけ）
 *   ds_line      LINE 公式アカウント（組織、読者は Bob だけ）
 *   ds_notes_*   個人のメモ（Alice と Bob）
 *   ds_slack     Slack の #general（グループ、組織の資格情報、読者は Eve だけ。Eve はメモを持たない）
 * u_mallory: ゲートウェイの User だが、このデプロイに Contact がない（チームの外）
 */
export const seed = Seed.parse({
  users: [
    { id: 'u_alice', name: 'Alice' },
    { id: 'u_bob', name: 'Bob' },
    { id: 'u_eve', name: 'Eve' },
    { id: 'u_mallory', name: 'Mallory（チームの外）' },
  ],
  contacts: [
    { id: 'p_ubs', name: 'UBS' },
    { id: 'p_alice', name: 'Alice', userId: 'u_alice' },
    { id: 'p_bob', name: 'Bob', userId: 'u_bob' },
    { id: 'p_carol', name: 'Carol（顧客）' },
    { id: 'p_dave', name: 'Dave 工務店' },
    { id: 'p_eve', name: 'Eve', userId: 'u_eve' },
  ],
  addresses: [
    { id: 'a_support', channel: 'email', value: 'support@ubs.example', contactId: 'p_ubs' },
    { id: 'a_alice', channel: 'email', value: 'alice@ubs.example', contactId: 'p_alice' },
    { id: 'a_carol', channel: 'email', value: 'carol@example.com', contactId: 'p_carol' },
    { id: 'a_dave', channel: 'email', value: 'info@dave.example', contactId: 'p_dave' },
    {
      id: 'a_dave_old',
      channel: 'email',
      value: 'old@dave.example',
      contactId: 'p_dave',
      validTo: '2026-01-01T00:00:00.000Z',
    },
    { id: 'a_oa', channel: 'line', value: '@ubs', contactId: 'p_ubs' },
    { id: 'a_carol_line', channel: 'line', value: 'U_carol', contactId: 'p_carol' },
    { id: 'a_slack', channel: 'slack', value: 'T_UBS/C_GENERAL', contactId: 'p_ubs' },
    { id: 'a_eve', channel: 'slack', value: 'T_UBS/U_EVE', contactId: 'p_eve' },
  ],
  credentialRefs: [
    { id: 'c_support', principal: { kind: 'team' }, addressId: 'a_support' },
    { id: 'c_alice', principal: { kind: 'user', userId: 'u_alice' }, addressId: 'a_alice' },
    { id: 'c_oa', principal: { kind: 'team' }, addressId: 'a_oa' },
    { id: 'c_slack', principal: { kind: 'team' }, addressId: 'a_slack' },
  ],
  dataSources: [
    { kind: 'service', id: 'ds_support', channel: 'email', name: 'support@', credentialRefId: 'c_support', selfAddressIds: ['a_support'] },
    { kind: 'service', id: 'ds_alice', channel: 'email', name: 'Alice のメールボックス', credentialRefId: 'c_alice', selfAddressIds: ['a_alice'] },
    { kind: 'service', id: 'ds_line', channel: 'line', name: 'LINE 公式アカウント', credentialRefId: 'c_oa', selfAddressIds: ['a_oa'] },
    { kind: 'notes', id: 'ds_notes_alice', name: 'Alice のメモ', ownerContactId: 'p_alice' },
    { kind: 'notes', id: 'ds_notes_bob', name: 'Bob のメモ', ownerContactId: 'p_bob' },
    {
      kind: 'service',
      id: 'ds_slack',
      channel: 'slack',
      name: '#general',
      credentialRefId: 'c_slack',
      selfAddressIds: ['a_slack'],
      group: true,
    },
  ],
  lists: [
    { id: 'l_support', dataSourceId: 'ds_support' },
    { id: 'l_alice', dataSourceId: 'ds_alice' },
    { id: 'l_line', dataSourceId: 'ds_line' },
    { id: 'l_notes_alice', dataSourceId: 'ds_notes_alice' },
    { id: 'l_notes_bob', dataSourceId: 'ds_notes_bob' },
    { id: 'l_slack', dataSourceId: 'ds_slack' },
  ],
  listMembers: [
    { listId: 'l_support', contactId: 'p_alice' },
    { listId: 'l_support', contactId: 'p_bob' },
    { listId: 'l_alice', contactId: 'p_alice' },
    { listId: 'l_line', contactId: 'p_bob' },
    { listId: 'l_notes_alice', contactId: 'p_alice' },
    { listId: 'l_notes_bob', contactId: 'p_bob' },
    { listId: 'l_slack', contactId: 'p_eve' },
  ],
  attributeDefs: [{ dataSourceId: 'ds_notes_alice', name: 'status', type: 'enum', options: ['todo', 'done'], description: '作業の進み具合' }],
});

export const dir = new Directory(seed);
export const alice = deriveViewer(dir, 'u_alice');
export const bob = deriveViewer(dir, 'u_bob');
export const eve = deriveViewer(dir, 'u_eve');
export const mallory = deriveViewer(dir, 'u_mallory');

/** 決定的な ID と時刻 */
export function makeCtx(now = '2026-10-16T09:00:00.000Z'): CoreContext & { setNow(n: string): void } {
  let n = 0;
  const ctx = {
    dir,
    now,
    newId: (prefix: string) => `${prefix}_${++n}`,
    setNow(v: string) {
      ctx.now = v;
    },
  };
  return ctx;
}

/** ドラフトを seq・at 付きのイベントにする */
export class EventLog {
  readonly events: DomainEvent[] = [];

  push(drafts: readonly DraftEvent[], at: string): DomainEvent[] {
    const stored = drafts.map((d, i) => ({ ...d, seq: this.events.length + i + 1, at }) as DomainEvent);
    this.events.push(...stored);
    return stored;
  }

  state(): Projections {
    return fold(this.events, emptyProjections());
  }
}

/** support@ に届いたメール（from を support@ にすれば観測された送信） */
export function email(over: Omit<Partial<InboundSignal>, 'from' | 'to'> & { from: string; sourceRef: string; to?: string[] }): InboundSignal {
  const { from, to, ...rest } = over;
  return {
    dataSourceId: 'ds_support',
    channel: 'email',
    body: '本文',
    ...rest,
    from: { channel: 'email', value: from },
    to: (to ?? ['support@ubs.example']).map((value) => ({ channel: 'email' as const, value })),
  };
}

export function line(over: Omit<Partial<InboundSignal>, 'from' | 'to'> & { from: string; sourceRef: string; to?: string }): InboundSignal {
  const { from, to, ...rest } = over;
  return {
    dataSourceId: 'ds_line',
    channel: 'line',
    body: '本文',
    ...rest,
    from: { channel: 'line', value: from },
    to: [{ channel: 'line', value: to ?? '@ubs' }],
  };
}

/** AI の代わりの答え。needs_response だけ指定すれば fixed / new でも使える */
export const answer = (over: Partial<AiIngestDecision> = {}): AiIngestDecision => ({
  thread: 'new',
  thread_id: null,
  title: null,
  needs_response: true,
  reason: 'test',
  confidence: 0.9,
  ...over,
});

/** シェルを通さずにコアだけで Ingest を 1 件回す（サービスと同じ手順） */
export function ingestPure(
  log: EventLog,
  ctx: CoreContext,
  inbound: InboundSignal,
  decide: (req: IngestRequest) => AiIngestDecision = () => {
    throw new Error('AI decision not expected');
  },
  policy = DEFAULT_POLICY,
): { duplicate: boolean; events: DomainEvent[]; signalId?: string; outcome?: IngestOutcome; request?: IngestRequest } {
  const p = log.state();
  const prepared = prepareInbound(p, ctx, inbound);
  if (prepared.kind !== 'signal') return { duplicate: true, events: [], signalId: prepared.signalId };
  const sig = signalEvent(prepared.payload);
  const withSignal = fold([{ ...sig, seq: p.lastSeq + 1, at: ctx.now } as DomainEvent], p);
  const plan = planIngest(withSignal, ctx, prepared.dataSource, prepared.payload, policy);
  const decided =
    plan.kind === 'decided' ? plan : finalizeIngest(ctx, plan.request, decide(plan.request), 'ai');
  const events = log.push([sig, ...decided.events], ctx.now);
  return {
    duplicate: false,
    events,
    signalId: prepared.payload.signalId,
    outcome: decided.outcome,
    request: plan.kind === 'needs_decision' ? plan.request : undefined,
  };
}
