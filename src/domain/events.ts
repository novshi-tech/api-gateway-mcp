import { z } from 'zod';
import { Channel } from './entities';

// 正は append-only のイベント列。payload は zod で定義し、DB では JSONB に入る。

export const AddressRef = z.object({ channel: Channel, value: z.string() });
export type AddressRef = z.infer<typeof AddressRef>;

/** 構造アンカー。区切り（同じデータソースの中）と、結び候補に使う */
export const Anchors = z.object({
  /** このメッセージ自身の ID（Message-ID、Slack の ts、LINE の message id など） */
  messageId: z.string().optional(),
  /** In-Reply-To */
  inReplyTo: z.string().optional(),
  /** Slack のスレッド親 ts */
  threadTs: z.string().optional(),
  /** LINE の引用返信の元 */
  quotedMessageId: z.string().optional(),
  /**
   * ソースが元から持つ区切りの識別子（Jira の課題キー、PR）。
   * 同じデータソースで一致すればそのスレッド、一致しなければ新しいスレッドに決まる
   */
  threadKey: z.string().optional(),
  /** 本文などで触れている Jira キー（結び候補用。区切りには使わない） */
  jiraKeys: z.array(z.string()).optional(),
  /** "<repo>#<number>"（結び候補用。区切りには使わない） */
  prRefs: z.array(z.string()).optional(),
});
export type Anchors = z.infer<typeof Anchors>;

/** 添付はバイナリを持たず、ファイル参照（パスとハッシュ）だけ */
export const FileRef = z.object({ path: z.string(), sha256: z.string(), name: z.string().optional() });
export type FileRef = z.infer<typeof FileRef>;

export const Direction = z.enum(['inbound', 'outbound']);
export type Direction = z.infer<typeof Direction>;

/**
 * データソースで観測されたシグナル（0014 の 5）。受信も、ツール外で行われた送信も同じ種別で、
 * direction で区別する。direction は from がデータソースの送信元（こちら）かどうかで機械的に決まる。
 */
export const SignalObserved = z.object({
  signalId: z.string(),
  dataSourceId: z.string(),
  direction: Direction,
  channel: Channel,
  from: AddressRef,
  to: z.array(AddressRef),
  /** Ingest 時に Directory で解決した Party（未知のアドレスなら null / 空） */
  fromPartyId: z.string().nullable().default(null),
  toPartyIds: z.array(z.string()).default([]),
  subject: z.string().optional(),
  body: z.string(),
  anchors: Anchors.default({}),
  attachments: z.array(FileRef).default([]),
  /** データソースごとの重複排除キー */
  sourceRef: z.string(),
});

export const ThreadChoice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), threadId: z.string() }),
  z.object({ kind: z.literal('new'), threadId: z.string(), title: z.string() }),
]);
export type ThreadChoice = z.infer<typeof ThreadChoice>;

/**
 * 区切りの根拠
 * - anchor: 構造アンカー（In-Reply-To・thread_ts・引用・ソースの区切り）
 * - awaiting: 同じ相手で、こちらが返事を待っているスレッドが 1 本だけ
 * - no_match: どの規則にも当たらず、候補もない → 新しいスレッド
 * - ai: 直近のスレッドから AI が話題の続きかを判断した
 * - human: 人の訂正（シグナルの移し替え）
 * - self: 個人のメモで本人が置き先を指定した
 */
export const ThreadedBy = z.enum(['anchor', 'awaiting', 'no_match', 'ai', 'human', 'self']);
export type ThreadedBy = z.infer<typeof ThreadedBy>;

/** シグナルをスレッドに入れる。人の訂正（移し替え）も同じイベントで追記する */
export const SignalThreaded = z.object({
  signalId: z.string(),
  thread: ThreadChoice,
  by: ThreadedBy,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  /** 返事や対応を求めているか。観測された送信には判断しない（null） */
  needsResponse: z.boolean().nullable(),
  /** 人の訂正のとき、訂正した User */
  actorUserId: z.string().optional(),
});

/** 片付け（v1 の ignore の後継）。「このスレッドにこれ以上ボールは動かない」の宣言 */
export const ThreadDismissed = z.object({ threadId: z.string(), actorUserId: z.string(), reason: z.string().min(1) });
export const ThreadReopened = z.object({ threadId: z.string(), actorUserId: z.string(), reason: z.string().optional() });

/**
 * 持ち主（0013 の 3）。ボールを特定のユーザーへ明示の操作で動かす。
 * userId が null なら手放す（ボールは「こちら」= 組織に戻る）、別の人なら引き継ぐ
 */
export const ThreadClaimed = z.object({
  threadId: z.string(),
  userId: z.string().nullable(),
  actorUserId: z.string(),
  reason: z.string().optional(),
});

/**
 * 結ばれ方（0014 の 3）
 * - sent: 送信・起票の副作用（record_sent。ステップ 4）
 * - anchor: アンカーの一致（結び候補）から人・スタンドが張った
 * - manual: 候補にないものを人・スタンドが張った
 */
export const LinkRoute = z.enum(['sent', 'anchor', 'manual']);
export type LinkRoute = z.infer<typeof LinkRoute>;

/**
 * スレッド a と b を結ぶ（op: unlink で外す）。無向で、1 つのイベントが両方のスレッドの投影に載る。
 * 追記で、元の判断は消さない
 */
export const ThreadLinked = z.object({
  a: z.string(),
  b: z.string(),
  op: z.enum(['link', 'unlink']).default('link'),
  route: LinkRoute,
  actorUserId: z.string(),
  reason: z.string().optional(),
});

export const AttributeValue = z.union([z.string(), z.number(), z.boolean()]);
export type AttributeValue = z.infer<typeof AttributeValue>;

/** 本人が付ける属性の値（定義は AttributeDef）。value が null なら外す。ソースの写しの属性はこちらでは触らない */
export const ThreadAttributeSet = z.object({
  threadId: z.string(),
  name: z.string(),
  value: AttributeValue.nullable(),
  actorUserId: z.string(),
});

export const EventPayloads = {
  SignalObserved,
  SignalThreaded,
  ThreadDismissed,
  ThreadReopened,
  ThreadClaimed,
  ThreadLinked,
  ThreadAttributeSet,
} as const;

export type EventType = keyof typeof EventPayloads;
export type PayloadOf<T extends EventType> = z.infer<(typeof EventPayloads)[T]>;

/** append 前のイベント（seq と at はストアが付ける） */
export type DraftEvent = { [T in EventType]: { type: T; payload: PayloadOf<T> } }[EventType];

/** 保存済みイベント */
export type DomainEvent = DraftEvent & { tenantId: string; seq: number; at: string };

export const EventTypeSchema = z.enum(Object.keys(EventPayloads) as [EventType, ...EventType[]]);

/** DB などから読んだ生の行をイベントとして検証する */
export function parseEvent(raw: { tenantId: string; seq: number; at: string; type: string; payload: unknown }): DomainEvent {
  const type = EventTypeSchema.parse(raw.type);
  const payload = EventPayloads[type].parse(raw.payload);
  return { tenantId: raw.tenantId, seq: raw.seq, at: raw.at, type, payload } as DomainEvent;
}

export function draft<T extends EventType>(type: T, payload: z.input<(typeof EventPayloads)[T]>): DraftEvent {
  return { type, payload: EventPayloads[type].parse(payload) } as DraftEvent;
}
