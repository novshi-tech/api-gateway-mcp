import type { AddressRef, Anchors, BallAt, FileRef } from './events';
import type { Channel, Principal } from './entities';

export type TaskStatus = 'open' | 'closed';

/** 通信状態。事前定義属性だけから機械的に導出される（comm.ts） */
export interface CommState {
  ballAt: BallAt;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  replyExpectedBy: string | null;
  unansweredSince: string | null;
  overdue: boolean;
}

export interface Task extends CommState {
  id: string;
  tenantId: string;
  listId: string;
  title: string;
  status: TaskStatus;
  /** 作業状態は全部カスタム属性 */
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SignalRecord {
  signalId: string;
  direction: 'in' | 'out';
  channel: Channel;
  from: AddressRef;
  to: AddressRef[];
  fromPartyId: string | null;
  toPartyIds: string[];
  subject?: string;
  body: string;
  anchors: Anchors;
  attachments: FileRef[];
  sourceRef: string;
  acquiredAs: Principal;
  replyExpectedBy: string | null;
  at: string;
  seq: number;
  /** 最新の Ingest 判断で置かれたタスク。ignore なら null */
  taskId: string | null;
  decision: 'pending' | 'attach' | 'new' | 'ignore';
}

export type DerivationStatus = 'proposed' | 'rejected' | 'approved' | 'sent' | 'overdue' | 'replied' | 'completed';

export interface Derivation {
  id: string;
  tenantId: string;
  sourceTaskId: string;
  sourceListId: string;
  targetListId: string;
  targetTaskId: string;
  mode: 'internal' | 'external';
  title: string;
  body: string;
  attachments: FileRef[];
  toPartyIds: string[];
  replyExpected: { by: string } | null;
  replyToDerivationId: string | null;
  status: DerivationStatus;
  proposedBy: 'ingest' | 'stand' | 'human';
  fromAddress: AddressRef | null;
  toAddresses: AddressRef[];
  sentRef: string | null;
  proposedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  /** 内部派生は approved で適用された時刻、外部派生は送信時刻 */
  deliveredAt: string | null;
  repliedAt: string | null;
  overdueAt: string | null;
  rejectedReason: string | null;
}

export type TimelineKind =
  | 'inbound'
  | 'outbound'
  | 'derivation_out'
  | 'derivation_in'
  | 'derivation_replied'
  | 'reply_overdue'
  | 'attribute_set'
  | 'closed'
  | 'reopened';

export interface TimelineEntry {
  taskId: string;
  seq: number;
  at: string;
  kind: TimelineKind;
  signalId?: string;
  derivationId?: string;
  /** 通信状態の導出に使う事前定義の値 */
  toPartyIds?: string[];
  targetListId?: string;
  replyExpectedBy?: string | null;
  attribute?: { name: string; value: unknown };
}

export interface TaskLink {
  derivationId: string;
  sourceTaskId: string;
  targetTaskId: string;
}

export interface IgnoreEntry {
  signalId: string;
  seq: number;
  at: string;
  channel: Channel;
  from: AddressRef;
  subject?: string;
  bodyExcerpt: string;
  reason: string;
  confidence: number;
  decidedBy: 'anchor' | 'ai' | 'human';
  /** 後から人が訂正した場合の訂正イベントの seq */
  overriddenAtSeq: number | null;
}

export interface Projections {
  tenantId: string;
  lastSeq: number;
  tasks: Record<string, Task>;
  signals: Record<string, SignalRecord>;
  derivations: Record<string, Derivation>;
  links: TaskLink[];
  timeline: TimelineEntry[];
  ignoreLog: IgnoreEntry[];
  /** 重複排除とアンカー解決の索引 */
  index: {
    sourceRefs: Record<string, string>;
    messageIds: Record<string, string>;
    sentRefs: Record<string, string>;
  };
}

export function emptyProjections(tenantId: string): Projections {
  return {
    tenantId,
    lastSeq: 0,
    tasks: {},
    signals: {},
    derivations: {},
    links: [],
    timeline: [],
    ignoreLog: [],
    index: { sourceRefs: {}, messageIds: {}, sentRefs: {} },
  };
}
