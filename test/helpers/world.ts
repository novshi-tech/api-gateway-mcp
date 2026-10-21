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
 * テナント ubs:
 *   ds_support   support@（組織の資格情報、読者は Alice と Bob）
 *   ds_alice     Alice の個人のメールボックス（読者は Alice だけ）
 *   ds_line      LINE 公式アカウント（組織、読者は Bob だけ）
 *   ds_notes_*   個人のメモ
 * テナント nvt: 別テナント（Eve と、もう 1 人の Alice）
 */
export const seed = Seed.parse({
  tenants: [
    { id: 'ubs', name: 'UBS' },
    { id: 'nvt', name: 'ノブシテック' },
  ],
  users: [
    { id: 'u_alice', name: 'Alice' },
    { id: 'u_bob', name: 'Bob' },
    { id: 'u_eve', name: 'Eve' },
  ],
  parties: [
    { id: 'p_ubs', tenantId: 'ubs', name: 'UBS', kind: 'organization', internal: true },
    { id: 'p_alice', tenantId: 'ubs', name: 'Alice', kind: 'person', userId: 'u_alice', internal: true },
    { id: 'p_bob', tenantId: 'ubs', name: 'Bob', kind: 'person', userId: 'u_bob', internal: true },
    { id: 'p_carol', tenantId: 'ubs', name: 'Carol（顧客）', kind: 'person' },
    { id: 'p_dave', tenantId: 'ubs', name: 'Dave 工務店', kind: 'organization' },
    { id: 'p_nvt', tenantId: 'nvt', name: 'ノブシテック', kind: 'organization', internal: true },
    { id: 'p_eve', tenantId: 'nvt', name: 'Eve', kind: 'person', userId: 'u_eve', internal: true },
    { id: 'p_alice_nvt', tenantId: 'nvt', name: 'Alice', kind: 'person', userId: 'u_alice', internal: true },
  ],
  addresses: [
    { id: 'a_support', tenantId: 'ubs', channel: 'email', value: 'support@ubs.example', partyId: 'p_ubs' },
    { id: 'a_alice', tenantId: 'ubs', channel: 'email', value: 'alice@ubs.example', partyId: 'p_alice' },
    { id: 'a_carol', tenantId: 'ubs', channel: 'email', value: 'carol@example.com', partyId: 'p_carol' },
    { id: 'a_dave', tenantId: 'ubs', channel: 'email', value: 'info@dave.example', partyId: 'p_dave' },
    {
      id: 'a_dave_old',
      tenantId: 'ubs',
      channel: 'email',
      value: 'old@dave.example',
      partyId: 'p_dave',
      validTo: '2026-01-01T00:00:00.000Z',
    },
    { id: 'a_oa', tenantId: 'ubs', channel: 'line', value: '@ubs', partyId: 'p_ubs' },
    { id: 'a_carol_line', tenantId: 'ubs', channel: 'line', value: 'U_carol', partyId: 'p_carol' },
    { id: 'a_nvt_slack', tenantId: 'nvt', channel: 'slack', value: 'T_NVT/C_GENERAL', partyId: 'p_nvt' },
    { id: 'a_eve', tenantId: 'nvt', channel: 'slack', value: 'T_NVT/U_EVE', partyId: 'p_eve' },
  ],
  credentialRefs: [
    { id: 'c_support', tenantId: 'ubs', principal: { kind: 'organization', tenantId: 'ubs' }, addressId: 'a_support' },
    { id: 'c_alice', tenantId: 'ubs', principal: { kind: 'user', userId: 'u_alice' }, addressId: 'a_alice' },
    { id: 'c_oa', tenantId: 'ubs', principal: { kind: 'organization', tenantId: 'ubs' }, addressId: 'a_oa' },
    { id: 'c_nvt_slack', tenantId: 'nvt', principal: { kind: 'organization', tenantId: 'nvt' }, addressId: 'a_nvt_slack' },
  ],
  dataSources: [
    { kind: 'service', id: 'ds_support', tenantId: 'ubs', channel: 'email', name: 'support@', credentialRefId: 'c_support', selfAddressIds: ['a_support'] },
    { kind: 'service', id: 'ds_alice', tenantId: 'ubs', channel: 'email', name: 'Alice のメールボックス', credentialRefId: 'c_alice', selfAddressIds: ['a_alice'] },
    { kind: 'service', id: 'ds_line', tenantId: 'ubs', channel: 'line', name: 'LINE 公式アカウント', credentialRefId: 'c_oa', selfAddressIds: ['a_oa'] },
    { kind: 'notes', id: 'ds_notes_alice', tenantId: 'ubs', name: 'Alice のメモ', ownerPartyId: 'p_alice' },
    { kind: 'notes', id: 'ds_notes_bob', tenantId: 'ubs', name: 'Bob のメモ', ownerPartyId: 'p_bob' },
    {
      kind: 'service',
      id: 'ds_slack',
      tenantId: 'nvt',
      channel: 'slack',
      name: '#general',
      credentialRefId: 'c_nvt_slack',
      selfAddressIds: ['a_nvt_slack'],
      group: true,
    },
  ],
  lists: [
    { id: 'l_support', tenantId: 'ubs', dataSourceId: 'ds_support' },
    { id: 'l_alice', tenantId: 'ubs', dataSourceId: 'ds_alice' },
    { id: 'l_line', tenantId: 'ubs', dataSourceId: 'ds_line' },
    { id: 'l_notes_alice', tenantId: 'ubs', dataSourceId: 'ds_notes_alice' },
    { id: 'l_notes_bob', tenantId: 'ubs', dataSourceId: 'ds_notes_bob' },
    { id: 'l_slack', tenantId: 'nvt', dataSourceId: 'ds_slack' },
  ],
  listMembers: [
    { listId: 'l_support', partyId: 'p_alice' },
    { listId: 'l_support', partyId: 'p_bob' },
    { listId: 'l_alice', partyId: 'p_alice' },
    { listId: 'l_line', partyId: 'p_bob' },
    { listId: 'l_notes_alice', partyId: 'p_alice' },
    { listId: 'l_notes_bob', partyId: 'p_bob' },
    { listId: 'l_slack', partyId: 'p_eve' },
  ],
  attributeDefs: [{ dataSourceId: 'ds_notes_alice', name: 'status', type: 'enum', options: ['todo', 'done'], description: '作業の進み具合' }],
});

export const dir = new Directory(seed);
export const alice = deriveViewer(dir, 'u_alice');
export const bob = deriveViewer(dir, 'u_bob');
export const eve = deriveViewer(dir, 'u_eve');

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
  constructor(readonly tenantId = 'ubs') {}

  push(drafts: readonly DraftEvent[], at: string): DomainEvent[] {
    const stored = drafts.map(
      (d, i) => ({ ...d, tenantId: this.tenantId, seq: this.events.length + i + 1, at }) as DomainEvent,
    );
    this.events.push(...stored);
    return stored;
  }

  state(): Projections {
    return fold(this.events, emptyProjections(this.tenantId));
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
  if (prepared.kind === 'duplicate') return { duplicate: true, events: [], signalId: prepared.signalId };
  const sig = signalEvent(prepared.payload);
  const withSignal = fold([{ ...sig, tenantId: log.tenantId, seq: p.lastSeq + 1, at: ctx.now } as DomainEvent], p);
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
