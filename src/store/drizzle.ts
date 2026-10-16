import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import {
  emptyProjections,
  parseEvent,
  Seed,
  type Derivation,
  type DomainEvent,
  type DraftEvent,
  type IgnoreEntry,
  type Projections,
  type SignalRecord,
  type Task,
  type TimelineEntry,
} from '../domain';
import * as schema from './schema';
import { ConcurrencyError, type EventStore, type MasterStore, type ProjectionStore, type Repo } from './types';

// Postgres 実装。本番は Neon（neon-serverless）、テストは pglite で同じコードを通す。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, any>;

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === '23505') return true;
  }
  return false;
}

export class PgEventStore implements EventStore {
  constructor(private readonly db: Db) {}

  async append(tenantId: string, expectedLastSeq: number, drafts: readonly DraftEvent[], at: string): Promise<DomainEvent[]> {
    if (drafts.length === 0) return [];
    const rows = drafts.map((d, i) => ({ tenantId, seq: expectedLastSeq + i + 1, type: d.type, payload: d.payload, at }));
    try {
      await this.db.transaction(async (tx) => {
        const [row] = await tx
          .select({ last: sql<number>`coalesce(max(${schema.events.seq}), 0)` })
          .from(schema.events)
          .where(eq(schema.events.tenantId, tenantId));
        if (Number(row?.last ?? 0) !== expectedLastSeq) throw new ConcurrencyError(tenantId, expectedLastSeq);
        await tx.insert(schema.events).values(rows);
      });
    } catch (err) {
      if (err instanceof ConcurrencyError) throw err;
      if (isUniqueViolation(err)) throw new ConcurrencyError(tenantId, expectedLastSeq);
      throw err;
    }
    return rows.map((r) => parseEvent(r));
  }

  async read(tenantId: string, afterSeq = 0): Promise<DomainEvent[]> {
    const rows = await this.db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.tenantId, tenantId), gt(schema.events.seq, afterSeq)))
      .orderBy(asc(schema.events.seq));
    return rows.map((r) => parseEvent({ ...r, at: new Date(r.at).toISOString() }));
  }
}

export class PgProjectionStore implements ProjectionStore {
  constructor(private readonly db: Db) {}

  async load(tenantId: string): Promise<Projections | null> {
    const [meta] = await this.db.select().from(schema.projectionMeta).where(eq(schema.projectionMeta.tenantId, tenantId));
    if (!meta) return null;
    const p = emptyProjections(tenantId);
    p.lastSeq = meta.lastSeq;
    p.index = meta.idx as Projections['index'];
    const by = <T extends { tenantId: unknown }>(t: T) => eq((t as unknown as typeof schema.tasks).tenantId, tenantId);
    for (const r of await this.db.select().from(schema.tasks).where(by(schema.tasks))) p.tasks[r.id] = r.data as Task;
    for (const r of await this.db.select().from(schema.signals).where(by(schema.signals))) p.signals[r.id] = r.data as SignalRecord;
    for (const r of await this.db.select().from(schema.derivations).where(by(schema.derivations))) {
      p.derivations[r.id] = r.data as Derivation;
    }
    p.links = (await this.db.select().from(schema.taskLinks).where(by(schema.taskLinks))).map((r) => ({
      derivationId: r.derivationId,
      sourceTaskId: r.sourceTaskId,
      targetTaskId: r.targetTaskId,
    }));
    p.timeline = (
      await this.db.select().from(schema.timeline).where(by(schema.timeline)).orderBy(asc(schema.timeline.ord))
    ).map((r) => r.data as TimelineEntry);
    p.ignoreLog = (
      await this.db.select().from(schema.ignoreLog).where(by(schema.ignoreLog)).orderBy(asc(schema.ignoreLog.ord))
    ).map((r) => r.data as IgnoreEntry);
    return p;
  }

  async save(p: Projections): Promise<void> {
    const tenantId = p.tenantId;
    await this.db.transaction(async (tx) => {
      await clearTenant(tx as unknown as Db, tenantId);
      await tx.insert(schema.projectionMeta).values({ tenantId, lastSeq: p.lastSeq, idx: p.index });
      await insertChunked(tx as unknown as Db, schema.tasks, Object.values(p.tasks).map((t) => ({ tenantId, id: t.id, listId: t.listId, status: t.status, data: t })));
      await insertChunked(tx as unknown as Db, schema.signals, Object.values(p.signals).map((s) => ({ tenantId, id: s.signalId, taskId: s.taskId, data: s })));
      await insertChunked(tx as unknown as Db, schema.derivations, Object.values(p.derivations).map((d) => ({ tenantId, id: d.id, status: d.status, data: d })));
      await insertChunked(tx as unknown as Db, schema.taskLinks, p.links.map((l) => ({ tenantId, ...l })));
      await insertChunked(tx as unknown as Db, schema.timeline, p.timeline.map((e, ord) => ({ tenantId, ord, taskId: e.taskId, data: e })));
      await insertChunked(tx as unknown as Db, schema.ignoreLog, p.ignoreLog.map((e, ord) => ({ tenantId, ord, signalId: e.signalId, data: e })));
    });
  }

  async clear(tenantId: string): Promise<void> {
    await this.db.transaction(async (tx) => clearTenant(tx as unknown as Db, tenantId));
  }
}

async function clearTenant(db: Db, tenantId: string): Promise<void> {
  await db.delete(schema.projectionMeta).where(eq(schema.projectionMeta.tenantId, tenantId));
  await db.delete(schema.tasks).where(eq(schema.tasks.tenantId, tenantId));
  await db.delete(schema.signals).where(eq(schema.signals.tenantId, tenantId));
  await db.delete(schema.derivations).where(eq(schema.derivations.tenantId, tenantId));
  await db.delete(schema.taskLinks).where(eq(schema.taskLinks.tenantId, tenantId));
  await db.delete(schema.timeline).where(eq(schema.timeline.tenantId, tenantId));
  await db.delete(schema.ignoreLog).where(eq(schema.ignoreLog.tenantId, tenantId));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertChunked(db: Db, table: any, rows: unknown[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) await db.insert(table).values(rows.slice(i, i + 500));
}

const SEED_KINDS = [
  'tenants',
  'users',
  'parties',
  'addresses',
  'lists',
  'listMembers',
  'attributeDefs',
  'credentialRefs',
  'channelPolicies',
] as const;

export class PgMasterStore implements MasterStore {
  constructor(private readonly db: Db) {}

  async loadSeed(): Promise<Seed> {
    const rows = await this.db.select().from(schema.master).orderBy(asc(schema.master.kind), asc(schema.master.ord));
    const raw: Record<string, unknown[]> = Object.fromEntries(SEED_KINDS.map((k) => [k, []]));
    for (const r of rows) raw[r.kind]?.push(r.data);
    return Seed.parse(raw);
  }

  async replaceSeed(seed: Seed): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.master);
      const rows = SEED_KINDS.flatMap((kind) => (seed[kind] as unknown[]).map((data, ord) => ({ kind, ord, data })));
      await insertChunked(tx as unknown as Db, schema.master, rows);
    });
  }
}

export function pgRepo(db: Db): Repo {
  return { events: new PgEventStore(db), projections: new PgProjectionStore(db), master: new PgMasterStore(db) };
}
