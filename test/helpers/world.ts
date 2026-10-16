import {
  Directory,
  Seed,
  deriveViewer,
  emptyProjections,
  fold,
  type CoreContext,
  type DomainEvent,
  type DraftEvent,
  type InboundSignal,
  type Projections,
} from '../../src/domain';

/**
 * コアのユニットテスト用の小さな世界。
 * テナント ubs: 顧客向け(l_cust)・内部(l_int)・協力会社向け(l_partner) の 3 リスト
 * テナント nvt: 別テナント
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
    { id: 'a_eve', tenantId: 'nvt', channel: 'slack', value: 'U_EVE', partyId: 'p_eve' },
  ],
  lists: [
    { id: 'l_cust', tenantId: 'ubs', name: '顧客窓口', description: '顧客からの問い合わせ' },
    { id: 'l_int', tenantId: 'ubs', name: '工事部', description: '社内の手配' },
    { id: 'l_partner', tenantId: 'ubs', name: '協力会社', description: '協力会社とのやりとり' },
    { id: 'l_dev', tenantId: 'nvt', name: '開発', description: '' },
  ],
  listMembers: [
    { listId: 'l_cust', partyId: 'p_alice' },
    { listId: 'l_cust', partyId: 'p_carol' },
    { listId: 'l_int', partyId: 'p_alice' },
    { listId: 'l_partner', partyId: 'p_bob' },
    { listId: 'l_partner', partyId: 'p_dave' },
    { listId: 'l_dev', partyId: 'p_eve' },
  ],
  attributeDefs: [
    { listId: 'l_int', name: 'status', type: 'enum', options: ['todo', 'doing', 'done'], description: '作業の進み具合' },
    { listId: 'l_int', name: 'assignee', type: 'party', description: '担当者' },
    { listId: 'l_int', name: 'amount', type: 'number', description: '見積金額（円）' },
    { listId: 'l_int', name: 'due', type: 'date', description: '期限' },
    { listId: 'l_int', name: 'urgent', type: 'boolean', description: '緊急か' },
    { listId: 'l_int', name: 'memo', type: 'string', description: 'メモ' },
  ],
  credentialRefs: [
    { id: 'c_support', tenantId: 'ubs', principal: { kind: 'organization', tenantId: 'ubs' }, addressId: 'a_support' },
    { id: 'c_alice', tenantId: 'ubs', principal: { kind: 'user', userId: 'u_alice' }, addressId: 'a_alice' },
  ],
  channelPolicies: [{ tenantId: 'ubs', channel: 'email', allowedListIds: ['l_cust', 'l_partner'] }],
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

export const orgEmail = { kind: 'organization' as const, tenantId: 'ubs' };

export function email(over: Omit<Partial<InboundSignal>, 'from'> & { from: string; sourceRef: string }): InboundSignal {
  return {
    channel: 'email',
    to: [{ channel: 'email', value: 'support@ubs.example' }],
    body: '本文',
    acquiredAs: orgEmail,
    ...over,
    from: { channel: 'email', value: over.from },
  } as InboundSignal;
}

import {
  finalizeDecision,
  planDecision,
  prepareInbound,
  signalEvent,
  type AiDecision,
  type DecisionRequest,
} from '../../src/domain';

/** シェルを通さずにコアだけで Ingest を 1 件回す（サービスと同じ手順） */
export function ingestPure(
  log: EventLog,
  ctx: CoreContext,
  inbound: InboundSignal,
  decide: (req: DecisionRequest) => AiDecision = () => {
    throw new Error('AI decision not expected');
  },
  estimate?: { replyExpectedBy: string | null; by: 'ai' | 'human' | 'none' },
) {
  const p = log.state();
  const prepared = prepareInbound(p, ctx, inbound);
  if (prepared.kind !== 'signal') return { prepared, events: [] as DomainEvent[] };
  const sig = signalEvent(prepared.direction, prepared.payload, estimate);
  const withSignal = fold([{ ...sig, tenantId: log.tenantId, seq: p.lastSeq + 1, at: ctx.now } as DomainEvent], p);
  const plan = planDecision(withSignal, ctx, prepared.direction, prepared.payload);
  const decided =
    plan.kind === 'decided'
      ? plan.events
      : finalizeDecision(withSignal, ctx, plan.request, decide(plan.request), 'ai', { ignoreThreshold: 0.8 }).events;
  const events = log.push([sig, ...decided], ctx.now);
  return { prepared, events, signalId: prepared.payload.signalId };
}
