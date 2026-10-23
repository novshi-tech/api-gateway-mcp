import { asc, eq, gt, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import {
  emptyProjections,
  parseEvent,
  Seed,
  type DomainEvent,
  type DraftEvent,
  type ProjectionChanges,
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

  async append(expectedLastSeq: number, drafts: readonly DraftEvent[], at: string): Promise<DomainEvent[]> {
    if (drafts.length === 0) return [];
    const rows = drafts.map((d, i) => ({ seq: expectedLastSeq + i + 1, type: d.type, payload: d.payload, at }));
    // 書く前に検証する（不正な payload を残さない）
    const stored = rows.map((r) => parseEvent(r));
    try {
      await this.db.transaction(async (tx) => {
        const [row] = await tx.select({ last: sql<number>`coalesce(max(${schema.events.seq}), 0)` }).from(schema.events);
        if (Number(row?.last ?? 0) !== expectedLastSeq) throw new ConcurrencyError(expectedLastSeq);
        await tx.insert(schema.events).values(rows);
      });
    } catch (err) {
      if (err instanceof ConcurrencyError) throw err;
      if (isUniqueViolation(err)) throw new ConcurrencyError(expectedLastSeq);
      throw err;
    }
    return stored;
  }

  async read(afterSeq = 0): Promise<DomainEvent[]> {
    const rows = await this.db.select().from(schema.events).where(gt(schema.events.seq, afterSeq)).orderBy(asc(schema.events.seq));
    return rows.map((r) => parseEvent({ ...r, at: new Date(r.at).toISOString() }));
  }
}

export class PgProjectionStore implements ProjectionStore {
  constructor(private readonly db: Db) {}

  async load(): Promise<Projections | null> {
    const [meta] = await this.db.select().from(schema.projectionMeta).where(eq(schema.projectionMeta.id, META_ID));
    if (!meta) return null;
    const p = emptyProjections();
    p.lastSeq = meta.lastSeq;
    p.index = meta.idx as Projections['index'];
    for (const r of await this.db.select().from(schema.threads)) p.threads[r.id] = r.data as Thread;
    for (const r of await this.db.select().from(schema.signals)) p.signals[r.id] = r.data as SignalRecord;
    return p;
  }

  async save(p: Projections, changes?: ProjectionChanges): Promise<void> {
    if (changes) return this.saveChanges(p, changes);
    await this.db.transaction(async (tx) => {
      await clearAll(tx as unknown as Db);
      await tx.insert(schema.projectionMeta).values({ id: META_ID, lastSeq: p.lastSeq, idx: p.index });
      await insertChunked(
        tx as unknown as Db,
        schema.threads,
        Object.values(p.threads).map((t) => ({ id: t.id, dataSourceId: t.dataSourceId, data: t })),
      );
      await insertChunked(
        tx as unknown as Db,
        schema.signals,
        Object.values(p.signals).map((s) => ({ id: s.signalId, dataSourceId: s.dataSourceId, threadId: s.threadId, data: s })),
      );
    });
  }

  /** 変わったスレッドとシグナルだけを upsert する（スレッドもシグナルも消えないので、消す行はない） */
  private async saveChanges(p: Projections, changes: ProjectionChanges): Promise<void> {
    await this.db.transaction(async (tx) => {
      const meta = { id: META_ID, lastSeq: p.lastSeq, idx: p.index };
      await tx
        .insert(schema.projectionMeta)
        .values(meta)
        .onConflictDoUpdate({
          target: schema.projectionMeta.id,
          set: changes.index ? { lastSeq: meta.lastSeq, idx: meta.idx } : { lastSeq: meta.lastSeq },
        });
      for (let i = 0; i < changes.threadIds.length; i += 500) {
        const rows = changes.threadIds.slice(i, i + 500).map((id) => ({ id, dataSourceId: p.threads[id]!.dataSourceId, data: p.threads[id]! }));
        await tx
          .insert(schema.threads)
          .values(rows)
          .onConflictDoUpdate({ target: schema.threads.id, set: { dataSourceId: sql`excluded.data_source_id`, data: sql`excluded.data` } });
      }
      for (let i = 0; i < changes.signalIds.length; i += 500) {
        const rows = changes.signalIds.slice(i, i + 500).map((id) => {
          const sig = p.signals[id]!;
          return { id, dataSourceId: sig.dataSourceId, threadId: sig.threadId, data: sig };
        });
        await tx.insert(schema.signals).values(rows).onConflictDoUpdate({
          target: schema.signals.id,
          set: { dataSourceId: sql`excluded.data_source_id`, threadId: sql`excluded.thread_id`, data: sql`excluded.data` },
        });
      }
    });
  }

  async clear(): Promise<void> {
    await this.db.transaction(async (tx) => clearAll(tx as unknown as Db));
  }
}

const META_ID = 1;

async function clearAll(db: Db): Promise<void> {
  await db.delete(schema.projectionMeta);
  await db.delete(schema.threads);
  await db.delete(schema.signals);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertChunked(db: Db, table: any, rows: unknown[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) await db.insert(table).values(rows.slice(i, i + 500));
}

const SEED_KINDS = [
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
