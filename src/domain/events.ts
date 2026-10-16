import { z } from 'zod';
import { Channel, Principal } from './entities';

// 正は append-only のイベント列。payload は zod で定義し、DB では JSONB に入る。

export const AddressRef = z.object({ channel: Channel, value: z.string() });
export type AddressRef = z.infer<typeof AddressRef>;

/** 構造アンカー。Ingest のアンカー解決に使う */
export const Anchors = z.object({
  /** このメッセージ自身の ID（Message-ID、Slack の ts、LINE の message id など） */
  messageId: z.string().optional(),
  /** In-Reply-To */
  inReplyTo: z.string().optional(),
  /** Slack のスレッド親 ts */
  threadTs: z.string().optional(),
  jiraKeys: z.array(z.string()).optional(),
  /** "<repo>#<number>" */
  prRefs: z.array(z.string()).optional(),
});
export type Anchors = z.infer<typeof Anchors>;

/** 添付はバイナリを持たず、ファイル参照（パスとハッシュ）だけ */
export const FileRef = z.object({ path: z.string(), sha256: z.string(), name: z.string().optional() });
export type FileRef = z.infer<typeof FileRef>;

export const BallAt = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('list'), listId: z.string() }),
  z.object({ kind: z.literal('party'), partyIds: z.array(z.string()) }),
]);
export type BallAt = z.infer<typeof BallAt>;

const signalBase = {
  signalId: z.string(),
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
  /** コネクタ側の重複排除キー */
  sourceRef: z.string(),
  acquiredAs: Principal,
};

export const SignalReceived = z.object(signalBase);
export const SignalObservedSent = z.object({
  ...signalBase,
  /** 返事期待の推定値（Claude が推定、人が訂正） */
  replyExpectedBy: z.string().nullable().default(null),
  replyEstimatedBy: z.enum(['ai', 'human', 'none']).default('none'),
});

export const IngestDecision = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('attach'), taskId: z.string() }),
  z.object({ kind: z.literal('new'), taskId: z.string(), listId: z.string(), title: z.string() }),
  z.object({ kind: z.literal('ignore') }),
]);
export type IngestDecision = z.infer<typeof IngestDecision>;

export const IngestDecided = z.object({
  signalId: z.string(),
  decision: IngestDecision,
  reason: z.string().min(1),
  decidedBy: z.enum(['anchor', 'ai', 'human']),
  confidence: z.number().min(0).max(1),
  /** 人の訂正のとき、訂正した User */
  actorUserId: z.string().optional(),
});

export const TaskAttributeSet = z.object({
  taskId: z.string(),
  name: z.string(),
  value: z.unknown(),
  actorUserId: z.string().optional(),
});

export const ReplyExpected = z.object({ by: z.string() });

export const DerivationProposed = z.object({
  derivationId: z.string(),
  sourceTaskId: z.string(),
  targetListId: z.string(),
  /** 適用先のタスク。返事の派生なら既存（元の派生のソース）、そうでなければ新規 ID */
  targetTaskId: z.string(),
  /** external = 外部の Party に送る（sent を経る）。internal = 同一テナント内のリスト間 */
  mode: z.enum(['internal', 'external']),
  title: z.string(),
  body: z.string(),
  attachments: z.array(FileRef).default([]),
  toPartyIds: z.array(z.string()).default([]),
  /** 内部派生では省略可（2026-10-16 決定） */
  replyExpected: ReplyExpected.nullable().default(null),
  /** この派生が別の派生への返事なら、その ID */
  replyToDerivationId: z.string().optional(),
  proposedBy: z.enum(['ingest', 'stand', 'human']),
  actorUserId: z.string().optional(),
});

export const DerivationApproved = z.object({
  derivationId: z.string(),
  actorUserId: z.string(),
  /** 外部派生の送信元 Address（= 使う資格情報）。承認時に選ぶ */
  fromAddress: AddressRef.optional(),
  /** 宛先 Party の Address を承認時に解決して凍結したもの */
  toAddresses: z.array(AddressRef).default([]),
});

export const DerivationRejected = z.object({
  derivationId: z.string(),
  actorUserId: z.string(),
  reason: z.string(),
});

export const DerivationSent = z.object({
  derivationId: z.string(),
  /** Message-ID など。観測された送信との重複排除キー */
  sentRef: z.string(),
});

export const DerivationReplied = z.object({
  derivationId: z.string(),
  /** 返事になった受信シグナル、または返事の派生 */
  signalId: z.string().optional(),
  replyDerivationId: z.string().optional(),
});

export const ReplyOverdue = z.object({ derivationId: z.string() });

export const TaskClosed = z.object({ taskId: z.string(), actorUserId: z.string().optional(), reason: z.string().optional() });
export const TaskReopened = z.object({ taskId: z.string(), actorUserId: z.string().optional() });

export const EventPayloads = {
  SignalReceived,
  SignalObservedSent,
  IngestDecided,
  TaskAttributeSet,
  DerivationProposed,
  DerivationApproved,
  DerivationRejected,
  DerivationSent,
  DerivationReplied,
  ReplyOverdue,
  TaskClosed,
  TaskReopened,
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
