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

export const tasks = pgTable(
  'tasks',
  {
    tenantId: text('tenant_id').notNull(),
    id: text('id').notNull(),
    listId: text('list_id').notNull(),
    status: text('status').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('tasks_list_idx').on(t.tenantId, t.listId)],
);

export const signals = pgTable(
  'signals',
  {
    tenantId: text('tenant_id').notNull(),
    id: text('id').notNull(),
    taskId: text('task_id'),
    data: jsonb('data').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const derivations = pgTable(
  'derivations',
  {
    tenantId: text('tenant_id').notNull(),
    id: text('id').notNull(),
    status: text('status').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const taskLinks = pgTable(
  'task_links',
  {
    tenantId: text('tenant_id').notNull(),
    derivationId: text('derivation_id').notNull(),
    sourceTaskId: text('source_task_id').notNull(),
    targetTaskId: text('target_task_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.derivationId] })],
);

export const timeline = pgTable(
  'timeline',
  {
    tenantId: text('tenant_id').notNull(),
    ord: integer('ord').notNull(),
    taskId: text('task_id').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.ord] }), index('timeline_task_idx').on(t.tenantId, t.taskId)],
);

export const ignoreLog = pgTable(
  'ignore_log',
  {
    tenantId: text('tenant_id').notNull(),
    ord: integer('ord').notNull(),
    signalId: text('signal_id').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.ord] })],
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

/** ダミーコネクタの受信キューと送信ログ */
export const dummyQueue = pgTable('dummy_queue', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: text('tenant_id').notNull(),
  channel: text('channel').notNull(),
  /** 'inbound' = pull で返す、'sent' = 送信ログ */
  kind: text('kind').notNull(),
  message: jsonb('message').notNull(),
  consumed: boolean('consumed').notNull().default(false),
});
