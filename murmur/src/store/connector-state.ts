import { and, eq, lt } from 'drizzle-orm';
import type { SourceState, SubscriptionRecord } from '../connectors/graph/state';
import type { Db } from './d1';
import * as schema from './schema';

// 取り込みの運用の状態のストア（0024）。メモリ実装と D1 実装。

/** 本人が本体に出した同意。トークンは SecretBox で包んだまま置く */
export interface GatewayGrant {
  userId: string;
  refreshToken: string;
  accessToken: string;
  accessExpiresAt: string;
  version: number;
}

export interface PendingAuthorization {
  state: string;
  userId: string;
  verifier: string;
  /** 本人が選んだゲートウェイの接続（なければ 1 つだけのときに選ぶ） */
  credentialId: string | null;
  createdAt: string;
  /** 何をつなぐ途中か。なければ Outlook（Jira より前の行）。Jira はサイトと範囲の JQL も持ち越す（0034） */
  request?: { kind: 'outlook' } | { kind: 'jira'; cloudId?: string; jql?: string };
}

export interface ConnectorStateStore {
  grant(userId: string): Promise<GatewayGrant | null>;
  /** expectedVersion が今の版と同じときだけ書き、版を 1 つ進める（any は無条件、つなぎ直し）。書けたら true */
  putGrant(grant: Omit<GatewayGrant, 'version'>, expectedVersion: number | 'any'): Promise<boolean>;
  deleteGrant(userId: string): Promise<void>;

  putPending(p: PendingAuthorization): Promise<void>;
  /** 取り出して消す。olderThan より前に作ったものは捨てる */
  takePending(state: string, notBefore: string): Promise<PendingAuthorization | null>;

  source(dataSourceId: string): Promise<SourceState | null>;
  sources(): Promise<SourceState[]>;
  putSource(s: SourceState): Promise<void>;

  subscription(id: string): Promise<SubscriptionRecord | null>;
  subscriptions(dataSourceId: string): Promise<SubscriptionRecord[]>;
  putSubscription(s: SubscriptionRecord): Promise<void>;
  deleteSubscription(id: string): Promise<void>;
}

export class MemoryConnectorState implements ConnectorStateStore {
  readonly grants = new Map<string, GatewayGrant>();
  readonly pending = new Map<string, PendingAuthorization>();
  readonly sourceMap = new Map<string, SourceState>();
  readonly subs = new Map<string, SubscriptionRecord>();

  async grant(userId: string) {
    const g = this.grants.get(userId);
    return g ? structuredClone(g) : null;
  }
  async putGrant(grant: Omit<GatewayGrant, 'version'>, expectedVersion: number | 'any') {
    const current = this.grants.get(grant.userId);
    if (expectedVersion !== 'any' && (current?.version ?? 0) !== expectedVersion) return false;
    this.grants.set(grant.userId, { ...structuredClone(grant), version: (current?.version ?? 0) + 1 });
    return true;
  }
  async deleteGrant(userId: string) {
    this.grants.delete(userId);
  }
  async putPending(p: PendingAuthorization) {
    this.pending.set(p.state, structuredClone(p));
  }
  async takePending(state: string, notBefore: string) {
    const p = this.pending.get(state);
    this.pending.delete(state);
    return p && p.createdAt >= notBefore ? p : null;
  }
  async source(id: string) {
    const s = this.sourceMap.get(id);
    return s ? structuredClone(s) : null;
  }
  async sources() {
    return [...this.sourceMap.values()].map((s) => structuredClone(s));
  }
  async putSource(s: SourceState) {
    this.sourceMap.set(s.dataSourceId, structuredClone(s));
  }
  async subscription(id: string) {
    const s = this.subs.get(id);
    return s ? structuredClone(s) : null;
  }
  async subscriptions(dataSourceId: string) {
    return [...this.subs.values()].filter((s) => s.dataSourceId === dataSourceId).map((s) => structuredClone(s));
  }
  async putSubscription(s: SubscriptionRecord) {
    this.subs.set(s.id, structuredClone(s));
  }
  async deleteSubscription(id: string) {
    this.subs.delete(id);
  }
}

export class D1ConnectorState implements ConnectorStateStore {
  constructor(private readonly db: Db) {}

  async grant(userId: string) {
    const [row] = await this.db.select().from(schema.gatewayGrants).where(eq(schema.gatewayGrants.userId, userId));
    return row ? { ...(row.data as Omit<GatewayGrant, 'version'>), version: row.version } : null;
  }

  async putGrant(grant: Omit<GatewayGrant, 'version'>, expectedVersion: number | 'any') {
    const { userId, refreshToken, accessToken, accessExpiresAt } = grant;
    const data = { userId, refreshToken, accessToken, accessExpiresAt };
    if (expectedVersion === 'any') {
      const current = await this.grant(userId);
      await this.db
        .insert(schema.gatewayGrants)
        .values({ userId, version: (current?.version ?? 0) + 1, data })
        .onConflictDoUpdate({ target: schema.gatewayGrants.userId, set: { version: (current?.version ?? 0) + 1, data } });
      return true;
    }
    if (expectedVersion === 0) {
      const r = await this.db.insert(schema.gatewayGrants).values({ userId, version: 1, data }).onConflictDoNothing();
      return r.meta.changes === 1;
    }
    const r = await this.db
      .update(schema.gatewayGrants)
      .set({ version: expectedVersion + 1, data })
      .where(and(eq(schema.gatewayGrants.userId, userId), eq(schema.gatewayGrants.version, expectedVersion)));
    return r.meta.changes === 1;
  }

  async deleteGrant(userId: string) {
    await this.db.delete(schema.gatewayGrants).where(eq(schema.gatewayGrants.userId, userId));
  }

  async putPending(p: PendingAuthorization) {
    await this.db.insert(schema.oauthPending).values({ state: p.state, createdAt: p.createdAt, data: p });
  }

  async takePending(state: string, notBefore: string) {
    // 古いものはついでに掃除する
    await this.db.delete(schema.oauthPending).where(lt(schema.oauthPending.createdAt, notBefore));
    const [row] = await this.db.delete(schema.oauthPending).where(eq(schema.oauthPending.state, state)).returning();
    return row ? (row.data as PendingAuthorization) : null;
  }

  async source(id: string) {
    const [row] = await this.db.select().from(schema.connectorSources).where(eq(schema.connectorSources.dataSourceId, id));
    return row ? (row.data as SourceState) : null;
  }

  async sources() {
    const rows = await this.db.select().from(schema.connectorSources);
    return rows.map((r) => r.data as SourceState);
  }

  async putSource(s: SourceState) {
    await this.db
      .insert(schema.connectorSources)
      .values({ dataSourceId: s.dataSourceId, userId: s.userId, data: s })
      .onConflictDoUpdate({ target: schema.connectorSources.dataSourceId, set: { userId: s.userId, data: s } });
  }

  async subscription(id: string) {
    const [row] = await this.db.select().from(schema.graphSubscriptions).where(eq(schema.graphSubscriptions.id, id));
    return row ? (row.data as SubscriptionRecord) : null;
  }

  async subscriptions(dataSourceId: string) {
    const rows = await this.db.select().from(schema.graphSubscriptions).where(eq(schema.graphSubscriptions.dataSourceId, dataSourceId));
    return rows.map((r) => r.data as SubscriptionRecord);
  }

  async putSubscription(s: SubscriptionRecord) {
    await this.db
      .insert(schema.graphSubscriptions)
      .values({ id: s.id, dataSourceId: s.dataSourceId, data: s })
      .onConflictDoUpdate({ target: schema.graphSubscriptions.id, set: { dataSourceId: s.dataSourceId, data: s } });
  }

  async deleteSubscription(id: string) {
    await this.db.delete(schema.graphSubscriptions).where(eq(schema.graphSubscriptions.id, id));
  }
}
