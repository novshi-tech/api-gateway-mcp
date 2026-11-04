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

/**
 * マスタは seed.json の形をそのまま 1 行ずつ置く（kind = users / contacts ...）。
 * key は kind の中で一意（rowKey）。ord は並び順で、足した行は末尾（0030 の 5。その場で書き換える）
 */
export const master = sqliteTable(
  'master',
  {
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    ord: integer('ord').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.key] })],
);

/** マスタの変更の記録（0030 の 5）。誰がいつ何を変えたか。before が null なら足した、after が null なら消した */
export const masterChanges = sqliteTable('master_changes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: text('at').notNull(),
  actorUserId: text('actor_user_id'),
  reason: text('reason'),
  kind: text('kind').notNull(),
  key: text('key').notNull(),
  before: text('before', { mode: 'json' }),
  after: text('after', { mode: 'json' }),
});

// ---- ダミー上流 ----

/** ダミーコネクタの受信キュー（データソースごとに pull で返す） */
export const dummyQueue = sqliteTable('dummy_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dataSourceId: text('data_source_id').notNull(),
  message: text('message', { mode: 'json' }).notNull(),
  consumed: integer('consumed', { mode: 'boolean' }).notNull().default(false),
});

// ---- 取り込みの運用の状態（0024）。台帳ではないのでイベントにしない。リプレイの対象外 ----

/** 本人が本体に出した同意（ゲートウェイの OAuth のトークン。暗号化して置く）。version で入れ替わりを直列にする */
export const gatewayGrants = sqliteTable('gateway_grants', {
  userId: text('user_id').primaryKey(),
  version: integer('version').notNull(),
  data: text('data', { mode: 'json' }).notNull(),
});

/** 認可の途中（state → 本人と PKCE の verifier）。コールバックで取り出して消す */
export const oauthPending = sqliteTable('oauth_pending', {
  state: text('state').primaryKey(),
  createdAt: text('created_at').notNull(),
  data: text('data', { mode: 'json' }).notNull(),
});

/** 実行時に作ったデータソースの取り込みの状態（delta の cursor・健康状態） */
export const connectorSources = sqliteTable('connector_sources', {
  dataSourceId: text('data_source_id').primaryKey(),
  userId: text('user_id').notNull(),
  data: text('data', { mode: 'json' }).notNull(),
});

/** Graph のサブスクリプションの台帳（通知の照合に使う） */
export const graphSubscriptions = sqliteTable(
  'graph_subscriptions',
  {
    id: text('id').primaryKey(),
    dataSourceId: text('data_source_id').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
  },
  (t) => [index('graph_subscriptions_data_source_idx').on(t.dataSourceId)],
);
