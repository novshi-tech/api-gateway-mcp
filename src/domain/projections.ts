import type { AddressRef, Anchors, Direction, FileRef, ThreadedBy } from './events';
import type { Channel } from './entities';

/**
 * ボールの所在（0014）。
 * - us: こちら（組織）。持ち主がなく片付けていなければ仕分け待ち
 * - party: 相手（こちらが返事を待っている）
 * - none: 誰の番でもない
 * 特定のユーザー（持ち主・構造で決まる「自分の番」）はステップ 3 で足す
 */
export type Ball = { kind: 'us' } | { kind: 'party'; partyIds: string[] } | { kind: 'none' };

/** 通信状態。シグナルの向き・「返事や対応を求めているか」・片付けだけから機械的に導出される（comm.ts） */
export interface CommState {
  ball: Ball;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  /** こちらの返事を待たせている最初の受信（返事をすれば消える） */
  unansweredSince: string | null;
  dismissed: boolean;
  dismissedAt: string | null;
  dismissReason: string | null;
  /** 片付けたあとにシグナルが来た（Murmur は自動で開き直さない。事実だけ返す） */
  activeSinceDismissed: boolean;
}

export type ThreadLogKind = 'signal' | 'dismissed' | 'reopened';

/** スレッドに綴じたもの（シグナルと片付け）。通信状態の導出の入力 */
export interface ThreadLogEntry {
  seq: number;
  at: string;
  kind: ThreadLogKind;
  signalId?: string;
  direction?: Direction;
  needsResponse?: boolean | null;
  toPartyIds?: string[];
  reason?: string;
}

/** エンティティはスレッドの 1 種類（0014）。データソースの写し */
export interface Thread extends CommState {
  id: string;
  tenantId: string;
  dataSourceId: string;
  title: string;
  /** 相手の Party（受信の from と送信の to から） */
  counterpartPartyIds: string[];
  /** 時刻順 */
  signalIds: string[];
  log: ThreadLogEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface SignalRecord {
  signalId: string;
  dataSourceId: string;
  direction: Direction;
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
  at: string;
  seq: number;
  /** 最新の SignalThreaded で置かれたスレッド */
  threadId: string | null;
  threadedBy: ThreadedBy | null;
  needsResponse: boolean | null;
}

export interface Projections {
  tenantId: string;
  lastSeq: number;
  threads: Record<string, Thread>;
  signals: Record<string, SignalRecord>;
  /** 重複排除とアンカー解決の索引。キーは `<dataSourceId>|<値>` */
  index: {
    sourceRefs: Record<string, string>;
    messageIds: Record<string, string>;
  };
}

export function emptyProjections(tenantId: string): Projections {
  return { tenantId, lastSeq: 0, threads: {}, signals: {}, index: { sourceRefs: {}, messageIds: {} } };
}

export function indexKey(dataSourceId: string, value: string): string {
  return `${dataSourceId}|${value}`;
}
