import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import {
  emptyProjections,
  parseEvent,
  Seed,
  type DomainEvent,
  type DraftEvent,
  type Projections,
  type SignalRecord,
  type Thread,
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
    for (const r of await this.db.select().from(schema.threads).where(eq(schema.threads.tenantId, tenantId))) {
      p.threads[r.id] = r.data as Thread;
    }
    for (const r of await this.db.select().from(schema.signals).where(eq(schema.signals.tenantId, tenantId))) {
      p.signals[r.id] = r.data as SignalRecord;
    }
    return p;
  }

  async save(p: Projections): Promise<void> {
    const tenantId = p.tenantId;
    await this.db.transaction(async (tx) => {
      await clearTenant(tx as unknown as Db, tenantId);
      await tx.insert(schema.projectionMeta).values({ tenantId, lastSeq: p.lastSeq, idx: p.index });
      await insertChunked(
        tx as unknown as Db,
        schema.threads,
        Object.values(p.threads).map((t) => ({ tenantId, id: t.id, dataSourceId: t.dataSourceId, data: t })),
      );
      await insertChunked(
        tx as unknown as Db,
        schema.signals,
        Object.values(p.signals).map((s) => ({ tenantId, id: s.signalId, dataSourceId: s.dataSourceId, threadId: s.threadId, data: s })),
      );
    });
  }

  async clear(tenantId: string): Promise<void> {
    await this.db.transaction(async (tx) => clearTenant(tx as unknown as Db, tenantId));
  }
}

async function clearTenant(db: Db, tenantId: string): Promise<void> {
  await db.delete(schema.projectionMeta).where(eq(schema.projectionMeta.tenantId, tenantId));
  await db.delete(schema.threads).where(eq(schema.threads.tenantId, tenantId));
  await db.delete(schema.signals).where(eq(schema.signals.tenantId, tenantId));
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
  'credentialRefs',
  'dataSources',
  'lists',
  'listMembers',
  'attributeDefs',
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
