import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

// ---- イベントストア（正） ----

// 1 デプロイ = 1 チームなので、テナントの列は持たない（0021）

export const events = pgTable(
  'events',
  {
    seq: integer('seq').primaryKey(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    at: timestamp('at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (t) => [index('events_type_idx').on(t.type)],
);

// ---- 投影（いつでも消してイベントから作り直せる） ----

/** 1 行だけ（id = 1） */
export const projectionMeta = pgTable('projection_meta', {
  id: integer('id').primaryKey(),
  lastSeq: integer('last_seq').notNull(),
  /** 重複排除とアンカー解決の索引 */
  idx: jsonb('idx').notNull(),
});

/** スレッド（エンティティはスレッドの 1 種類、0014） */
export const threads = pgTable(
  'threads',
  {
    id: text('id').primaryKey(),
    dataSourceId: text('data_source_id').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [index('threads_data_source_idx').on(t.dataSourceId)],
);

export const signals = pgTable('signals', {
  id: text('id').primaryKey(),
  dataSourceId: text('data_source_id').notNull(),
  threadId: text('thread_id'),
  data: jsonb('data').notNull(),
});

// ---- マスタ ----

/** プロトタイプのマスタは seed.json の形をそのまま 1 行ずつ置く（kind = users / parties ...） */
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
  dataSourceId: text('data_source_id').notNull(),
  message: jsonb('message').notNull(),
  consumed: boolean('consumed').notNull().default(false),
});
