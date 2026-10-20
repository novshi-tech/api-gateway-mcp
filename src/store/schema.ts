import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

// ---- イベントストア（正） ----

export const events = pgTable(
  'events',
  {
    tenantId: text('tenant_id').notNull(),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    at: timestamp('at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.seq] }), index('events_type_idx').on(t.tenantId, t.type)],
);

// ---- 投影（いつでも消してイベントから作り直せる） ----

export const projectionMeta = pgTable('projection_meta', {
  tenantId: text('tenant_id').primaryKey(),
  lastSeq: integer('last_seq').notNull(),
  /** 重複排除とアンカー解決の索引 */
  idx: jsonb('idx').notNull(),
});

/** スレッド（エンティティはスレッドの 1 種類、0014） */
export const threads = pgTable(
  'threads',
  {
    tenantId: text('tenant_id').notNull(),
    id: text('id').notNull(),
    dataSourceId: text('data_source_id').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('threads_data_source_idx').on(t.tenantId, t.dataSourceId)],
);

export const signals = pgTable(
  'signals',
  {
    tenantId: text('tenant_id').notNull(),
    id: text('id').notNull(),
    dataSourceId: text('data_source_id').notNull(),
    threadId: text('thread_id'),
    data: jsonb('data').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

// ---- マスタ ----

/** プロトタイプのマスタは seed.json の形をそのまま 1 行ずつ置く（kind = tenants / users / parties ...） */
export const master = pgTable(
  'master',
  {
    kind: text('kind').notNull(),
    ord: integer('ord').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.ord] })],
);


// ---- ダミー上流 ----

/** ダミーコネクタの受信キュー（データソースごとに pull で返す） */
export const dummyQueue = pgTable('dummy_queue', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: text('tenant_id').notNull(),
  dataSourceId: text('data_source_id').notNull(),
  message: jsonb('message').notNull(),
  consumed: boolean('consumed').notNull().default(false),
});
