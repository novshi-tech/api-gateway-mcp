import type { AddressRef, Anchors, AttributeValue, Direction, FileRef, LinkRoute, ThreadedBy } from './events';
import type { Channel } from './entities';

/**
 * ボールの所在（0014）。スレッドのイベントだけから決まる（fold は 1 段）。
 * - us: こちら（組織）。持ち主がいない。構造で誰の番かが決まらなければ仕分け待ち（クエリ層の turn.ts）
 * - user: 持ち主（ThreadClaimed で持った人）
 * - party: 相手（こちらが返事を待っている）
 * - none: 誰の番でもない
 */
export type Ball = { kind: 'us' } | { kind: 'user'; userId: string } | { kind: 'party'; partyIds: string[] } | { kind: 'none' };

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
  /** 持ち主（ThreadClaimed）。手放せば null */
  ownerUserId: string | null;
  /** 最後の送信の返事期待（記録した送信だけが持つ）。受信が来れば消える */
  replyExpectedBy: string | null;
  replyExpectedSignalId: string | null;
  /** 返事期待の期限を過ぎた（ReplyOverdue）。受信が来れば解消する */
  overdue: boolean;
  /** ソースの側で完了している（写しの done）。片付けと同じくボールは「なし」 */
  closedAtSource: boolean;
}

/** signal = データソースのシグナル、note = 個人のメモ（ボールを動かさない）、mirrored = 状態の写し */
export type ThreadLogKind = 'signal' | 'note' | 'dismissed' | 'reopened' | 'claimed' | 'linked' | 'unlinked' | 'attribute' | 'mirrored' | 'overdue';

/** スレッドに綴じたもの（シグナル・メモと、人とスタンドの操作）。通信状態の導出とタイムラインの入力 */
export interface ThreadLogEntry {
  seq: number;
  at: string;
  kind: ThreadLogKind;
  signalId?: string;
  direction?: Direction;
  needsResponse?: boolean | null;
  toPartyIds?: string[];
  /** signal（送信の記録）: 返事期待の期限 */
  replyExpectedBy?: string | null;
  reason?: string;
  /** 操作した User（シグナル以外） */
  actorUserId?: string;
  /** claimed: 持ち主（null は手放した） */
  userId?: string | null;
  /** linked / unlinked: 相手のスレッドと経路 */
  otherThreadId?: string;
  route?: LinkRoute;
  /** attribute: 名前と値（null は外した） */
  name?: string;
  value?: AttributeValue | null;
  /** mirrored: 変わった写しの属性 */
  fields?: Record<string, AttributeValue | null>;
}

/** 他のスレッドへの辺（無向）。両端のスレッドに同じものが載る */
export interface ThreadLink {
  threadId: string;
  route: LinkRoute;
  linkedAt: string;
  actorUserId: string;
}

/** エンティティはスレッドの 1 種類（0014）。データソースの写し */
export interface Thread extends CommState {
  id: string;
  dataSourceId: string;
  title: string;
  /** 相手の Party（受信の from と送信の to から） */
  counterpartPartyIds: string[];
  /** 時刻順（メモを含む） */
  signalIds: string[];
  log: ThreadLogEntry[];
  /** 結んだスレッド（threadId 順） */
  links: ThreadLink[];
  /** 属性。外のサービスのスレッドはソースの写し（ThreadMirrored）、個人のメモのスレッドは本人が付ける（ThreadAttributeSet） */
  attributes: Record<string, AttributeValue>;
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
  /** 送信の記録（OutboundRecorded）。観測だけのシグナルは null */
  recorded: { actorUserId: string; at: string; replyExpectedBy: string | null; sourceThreadId: string | null } | null;
  /** 最新の SignalThreaded で置かれたスレッド */
  threadId: string | null;
  threadedBy: ThreadedBy | null;
  needsResponse: boolean | null;
}

export interface Projections {
  lastSeq: number;
  threads: Record<string, Thread>;
  signals: Record<string, SignalRecord>;
  /** 重複排除とアンカー解決の索引。キーは `<dataSourceId>|<値>` */
  index: {
    sourceRefs: Record<string, string>;
    messageIds: Record<string, string>;
  };
}

export function emptyProjections(): Projections {
  return { lastSeq: 0, threads: {}, signals: {}, index: { sourceRefs: {}, messageIds: {} } };
}

export function indexKey(dataSourceId: string, value: string): string {
  return `${dataSourceId}|${value}`;
}
