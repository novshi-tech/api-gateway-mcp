import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// D1（SQLite）のスキーマ（0021）。1 デプロイ = 1 チームなので、テナントの列は持たない。
// JSON は TEXT に入れ（drizzle が読み書きで変換する）、時刻は ISO 8601 の文字列で持つ。

// ---- イベントストア（正） ----

export const events = sqliteTable(
  'events',
  {
    seq: integer('seq').primaryKey(),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    at: text('at').notNull(),
  },
  (t) => [index('events_type_idx').on(t.type)],
);

// ---- 投影（いつでも消してイベントから作り直せる） ----

/** 1 行だけ（id = 1） */
export const projectionMeta = sqliteTable('projection_meta', {
  id: integer('id').primaryKey(),
  lastSeq: integer('last_seq').notNull(),
  /** 重複排除とアンカー解決の索引 */
  idx: text('idx', { mode: 'json' }).notNull(),
});

/** スレッド（エンティティはスレッドの 1 種類、0014） */
export const threads = sqliteTable(
  'threads',
  {
    id: text('id').primaryKey(),
    dataSourceId: text('data_source_id').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
  },
  (t) => [index('threads_data_source_idx').on(t.dataSourceId)],
);

export const signals = sqliteTable('signals', {
  id: text('id').primaryKey(),
  dataSourceId: text('data_source_id').notNull(),
  threadId: text('thread_id'),
  data: text('data', { mode: 'json' }).notNull(),
});

// ---- マスタ ----

/** プロトタイプのマスタは seed.json の形をそのまま 1 行ずつ置く（kind = users / contacts ...） */
export const master = sqliteTable(
  'master',
  {
    kind: text('kind').notNull(),
    ord: integer('ord').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.ord] })],
);

// ---- ダミー上流 ----

/** ダミーコネクタの受信キュー（データソースごとに pull で返す） */
export const dummyQueue = sqliteTable('dummy_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dataSourceId: text('data_source_id').notNull(),
  message: text('message', { mode: 'json' }).notNull(),
  consumed: integer('consumed', { mode: 'boolean' }).notNull().default(false),
});
