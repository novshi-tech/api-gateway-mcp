import type { AddressRef, Anchors, AttributeValue, Author, FileRef, LinkRoute, MirrorFields, ThreadedBy } from './events';
import type { Channel } from './entities';

/**
 * 返事や対応を求めたシグナル（0030）。fold はアドレスだけで畳み、どちら側の求めかはクエリ層が決める（sides.ts）
 * - holders: ボールを持っているアドレス（求めたシグナルの宛先）
 * - except: 宛先のないシグナル（グループのチャネル）。「チャネルの中で except 以外」がボールを持つ
 * - requestedBy: 求めたシグナルの送り主
 * - since: 同じ送り主が求め続けている最初の時刻
 */
export interface Request {
  holders: AddressRef[];
  except: AddressRef | null;
  requestedBy: AddressRef;
  since: string;
  signalId: string;
}

/**
 * fold が持つボール（0030）。スレッドのイベントだけから決まる（fold は 1 段、マスタを読まない）
 * - request: 求めたシグナルの保持者がボールを持つ（どちら側かはクエリ層）
 * - claimed: 持った・引き継いだ（userId）、手放した（null = こちら）
 * - none: 誰の番でもない
 */
export type FoldedBall = { kind: 'request'; request: Request } | { kind: 'claimed'; userId: string | null } | { kind: 'none' };

/**
 * クエリ層で解決したボールの所在（API と一覧の形。sides.ts の resolveBall）
 * - us: こちら（チーム）。持ち主がいない。構造で誰の番かが決まらなければ仕分け待ち（turn.ts）
 * - user: 持ち主
 * - contact: 相手（こちらが返事を待っている）
 * - none: 誰の番でもない
 */
export type Ball = { kind: 'us' } | { kind: 'user'; userId: string } | { kind: 'contact'; contactIds: string[] } | { kind: 'none' };

/** 通信状態。綴じたシグナルのアドレス・「返事や対応を求めているか」・持ち主・片付けだけから導出される（comm.ts） */
export interface CommState {
  ball: FoldedBall;
  /** 最後に求めたシグナル（片付け・持ち主の操作のあとも残る。応えた・閉じたら null） */
  request: Request | null;
  dismissed: boolean;
  dismissedAt: string | null;
  dismissReason: string | null;
  /** 片付けたあとにシグナルが来た（Murmur は自動で開き直さない。事実だけ返す） */
  activeSinceDismissed: boolean;
  /** 持ち主（ThreadClaimed）。手放せば null */
  ownerUserId: string | null;
  /** 返事期待（記録した送信だけが持つ）。その送り主以外からシグナルが来れば消える */
  replyExpectedBy: string | null;
  replyExpectedSignalId: string | null;
  replyExpectedFrom: AddressRef | null;
  /** 返事期待の期限を過ぎた（ReplyOverdue）。返事期待が消えれば解消する */
  overdue: boolean;
  /** ソースの側で完了している（写しの closed）。片付けと同じくボールは「なし」 */
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
  /** signal / note: 送り主と宛先 */
  from?: AddressRef;
  to?: AddressRef[];
  needsResponse?: boolean | null;
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
  /** mirrored: 変わった写しの項目 */
  fields?: MirrorFields;
}

/** 写しのうち、スレッドの他の項目に入らないもの（0031 の 6） */
export interface SourceState {
  /** ソースの上でボールを持っているアカウント（アドレスの値） */
  holders: string[];
  statusLabel: string | null;
  due: string | null;
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
  /** 時刻順（メモを含む） */
  signalIds: string[];
  log: ThreadLogEntry[];
  /** 結んだスレッド（threadId 順） */
  links: ThreadLink[];
  /** 本人が付ける属性（ThreadAttributeSet）。個人のメモのスレッドだけ（0031） */
  attributes: Record<string, AttributeValue>;
  /** ソースの状態の写し（ThreadMirrored）。写しを受けたことがなければ null。完了は closedAtSource、件名は title に入る */
  source: SourceState | null;
  /** 写しのソースの区切り（課題キー）。写しでできたスレッドを課題キーで引くため */
  sourceKey?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SignalRecord {
  signalId: string;
  dataSourceId: string;
  channel: Channel;
  from: AddressRef;
  to: AddressRef[];
  subject?: string;
  body: string;
  anchors: Anchors;
  attachments: FileRef[];
  sourceRef: string;
  /** 書き手（個人のメモだけ。0031 の 3） */
  author?: Author;
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

/** fold で base から変わったもの。スレッドとシグナルは消えないので、保存は変わった行の upsert で足りる */
export interface ProjectionChanges {
  threadIds: string[];
  signalIds: string[];
  /** 索引（sourceRefs・messageIds）が変わった */
  index: boolean;
}

export function emptyProjections(): Projections {
  return { lastSeq: 0, threads: {}, signals: {}, index: { sourceRefs: {}, messageIds: {} } };
}

export function indexKey(dataSourceId: string, value: string): string {
  return `${dataSourceId}|${value}`;
}
