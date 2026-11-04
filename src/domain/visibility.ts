import type { Directory } from './directory';
import type { AttributeDef, DataSource } from './entities';
import type { AttributeValue, Author, MirrorFields } from './events';
import { sortLog } from './comm';
import type { Ball, Projections, SignalRecord, SourceState, Thread, ThreadLink, ThreadLogEntry } from './projections';
import { commView, directionOf } from './sides';
import { derivedBall, isMyTurn, linkCandidates, linkedActiveSinceDismissed, turnOf, type DerivedBall, type LinkCandidate, type Turn } from './turn';
import { canReadDataSource, type Viewer } from './viewer';

// クエリ層の可視性。投影のスナップショットと Viewer から「見えるもの」だけを返す純関数。
// - リストの読者には、そのデータソースのスレッドの生の中身が見える。個人のメモは本人だけ
// - 持ち主とリンク（結び先の id）はスレッドの側にあるので、スレッドが見える人に見える。結び先の中身はその先の可視性に従う
// - Contact のない User は 0 件、ゴースト Contact は Viewer になれない

/**
 * - my_turn: Viewer の番（持ち主・読者が 1 人・宛先）で、片付けていないもの
 * - mine: Viewer の個人のメモのスレッド（閉じたものも）
 * - open: 片付けていないもの
 * - overdue: 返事期待の期限を過ぎたもの
 * - triage: 仕分け待ち（こちらで、誰の番かが決まらず、片付けていない）
 * - all: 全部
 *
 * since を渡せば、それより後に動いたものだけ（スレッド自身か、見えるリンク先の updatedAt。メモのスレッドの導出したボールはリンク先で変わるため）
 */
export type ThreadFilter = 'my_turn' | 'mine' | 'open' | 'overdue' | 'triage' | 'all';

export interface ThreadSummary {
  id: string;
  dataSourceId: string;
  title: string;
  /** クエリ時のマスタで解決したボール（0030） */
  ball: Ball;
  counterpartContactIds: string[];
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  unansweredSince: string | null;
  dismissed: boolean;
  dismissReason: string | null;
  activeSinceDismissed: boolean;
  ownerUserId: string | null;
  replyExpectedBy: string | null;
  overdue: boolean;
  closedAtSource: boolean;
  links: ThreadLink[];
  attributes: Record<string, AttributeValue>;
  source: SourceState | null;
  signalCount: number;
  updatedAt: string;
}

/** 一覧と詳細で返すスレッド。投影の要約に、クエリ層で導出したもの（誰の番か・リンク先から導出したボール・結び候補）を足す */
export interface ThreadItem extends ThreadSummary {
  /** 自分か、見える結んだ先のうち一番新しい更新（一覧の並び。0031 の 5） */
  lastActivityAt: string;
  turn: Turn;
  derivedBall: DerivedBall | null;
  /** 閉じたスレッドに結ばれた先で、閉じたあとにシグナルが来た */
  linkedActiveSinceDismissed: boolean;
  linkCandidates: LinkCandidate[];
}

export function summarizeThread(dir: Directory, p: Projections, t: Thread): ThreadSummary {
  const comm = commView(dir, p, t);
  return {
    id: t.id,
    dataSourceId: t.dataSourceId,
    title: t.title,
    ball: comm.ball,
    counterpartContactIds: comm.counterpartContactIds,
    lastInboundAt: comm.lastInboundAt,
    lastOutboundAt: comm.lastOutboundAt,
    unansweredSince: comm.unansweredSince,
    dismissed: t.dismissed,
    dismissReason: t.dismissReason,
    activeSinceDismissed: t.activeSinceDismissed,
    ownerUserId: t.ownerUserId,
    replyExpectedBy: t.replyExpectedBy,
    overdue: t.overdue,
    closedAtSource: t.closedAtSource,
    links: t.links,
    attributes: t.attributes,
    source: t.source,
    signalCount: t.signalIds.length,
    updatedAt: t.updatedAt,
  };
}

/**
 * Viewer に見えるリンク。両端のスレッドを読めるもの（相手のデータソースのリストの読者であること）だけ（0033 の 3）。
 * 見えない辺は、あることも含めて出さない
 */
export function visibleLinks(viewer: Viewer, p: Projections, t: Thread): ThreadLink[] {
  return t.links.filter((l) => {
    const u = p.threads[l.threadId];
    return u !== undefined && canReadDataSource(viewer, u.dataSourceId);
  });
}

export function threadItem(dir: Directory, viewer: Viewer, p: Projections, t: Thread): ThreadItem {
  return {
    ...summarizeThread(dir, p, t),
    links: visibleLinks(viewer, p, t),
    lastActivityAt: lastActivityAt(viewer, p, t),
    turn: turnOf(dir, p, t),
    derivedBall: derivedBall(dir, viewer, p, t),
    linkedActiveSinceDismissed: linkedActiveSinceDismissed(viewer, p, t),
    linkCandidates: linkCandidates(viewer, p, t),
  };
}

/** 仕分け待ち: こちら（組織）で、持ち主も構造で決まる人もなく、片付けていないスレッド */
export function isTriage(dir: Directory, p: Projections, t: Thread): boolean {
  return !t.dismissed && turnOf(dir, p, t).kind === 'triage';
}

/** Viewer に見えるスレッド（読者になっているデータソースのもの） */
export function listThreads(
  dir: Directory,
  viewer: Viewer,
  p: Projections,
  opts: { filter?: ThreadFilter; dataSourceId?: string; since?: string } = {},
): ThreadItem[] {
  const filter = opts.filter ?? 'open';
  const out: ThreadItem[] = [];
  for (const t of Object.values(p.threads)) {
    if (!canReadDataSource(viewer, t.dataSourceId)) continue;
    if (opts.dataSourceId && t.dataSourceId !== opts.dataSourceId) continue;
    if (filter === 'open' && (t.dismissed || t.closedAtSource)) continue;
    if (filter === 'triage' && !isTriage(dir, p, t)) continue;
    if (filter === 'overdue' && !t.overdue) continue;
    if (filter === 'my_turn' && (t.dismissed || !isMyTurn(turnOf(dir, p, t), viewer))) continue;
    if (filter === 'mine') {
      const ds = dir.dataSource(t.dataSourceId);
      if (ds?.kind !== 'notes' || ds.ownerUserId !== viewer.userId) continue;
    }
    if (opts.since !== undefined && !movedSince(viewer, p, t, opts.since)) continue;
    out.push(threadItem(dir, viewer, p, t));
  }
  return out.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : a.id < b.id ? -1 : 1));
}

/**
 * 自分か、見える結んだ先のうち一番新しい更新（0031 の 5）。結んだ PR にレビューが返れば、メモにだれも書く前でもタスクが上に来る。
 * fold は 1 段のまま（0014）、クエリ層で合わせる
 */
export function lastActivityAt(viewer: Viewer, p: Projections, t: Thread): string {
  let at = t.updatedAt;
  for (const l of t.links) {
    const u = p.threads[l.threadId];
    if (u && canReadDataSource(viewer, u.dataSourceId) && u.updatedAt > at) at = u.updatedAt;
  }
  return at;
}

function movedSince(viewer: Viewer, p: Projections, t: Thread, since: string): boolean {
  return lastActivityAt(viewer, p, t) > since;
}

export type SignalView = { direction: 'inbound' | 'outbound'; author?: Author } & Pick<
  SignalRecord,
  'signalId' | 'channel' | 'from' | 'to' | 'subject' | 'body' | 'attachments' | 'anchors' | 'at' | 'threadedBy' | 'needsResponse' | 'recorded'
>;

function signalView(dir: Directory, s: SignalRecord): SignalView {
  return {
    signalId: s.signalId,
    direction: directionOf(dir, s),
    channel: s.channel,
    from: s.from,
    to: s.to,
    subject: s.subject,
    body: s.body,
    attachments: s.attachments,
    anchors: s.anchors,
    at: s.at,
    threadedBy: s.threadedBy,
    needsResponse: s.needsResponse,
    recorded: s.recorded,
    // 書き手の印より前のメモは本人が書いたもの
    ...(s.channel === 'note' ? { author: s.author ?? { kind: 'user' as const } } : {}),
  };
}

export interface TimelineEntry {
  at: string;
  /** どのスレッドに綴じたものか（このスレッドか、結んだ先のスレッド） */
  threadId: string;
  kind: ThreadLogEntry['kind'];
  signal?: SignalView;
  reason?: string;
  actorUserId?: string;
  userId?: string | null;
  otherThreadId?: string;
  route?: ThreadLogEntry['route'];
  name?: string;
  value?: AttributeValue | null;
  fields?: MirrorFields;
  replyExpectedBy?: string | null;
}

/** 結んだ先。両端を読めるものだけ返す（0033 の 3）。visible は互換のために残し、いつも true */
export interface LinkView extends ThreadLink {
  visible: true;
  title: string;
  dataSourceId: string;
  turn: Turn;
  dismissed: boolean;
}

export interface ThreadView {
  thread: ThreadItem;
  dataSource: { id: string; name: string; kind: DataSource['kind']; channel: string };
  linked: LinkView[];
  /**
   * 時刻順のタイムライン: このスレッドに綴じたもの（シグナル・メモ・操作）と、結んだ先のうち見えるスレッドのシグナル。
   * since を渡せば、それより後のものだけ
   */
  timeline: TimelineEntry[];
}

export function getThreadView(
  dir: Directory,
  viewer: Viewer,
  p: Projections,
  threadId: string,
  opts: { since?: string } = {},
): ThreadView | null {
  const t = p.threads[threadId];
  if (!t || !canReadDataSource(viewer, t.dataSourceId)) return null;
  const ds = dir.dataSource(t.dataSourceId);
  const linked: LinkView[] = visibleLinks(viewer, p, t).map((l) => {
    const u = p.threads[l.threadId]!;
    return { ...l, visible: true, title: u.title, dataSourceId: u.dataSourceId, turn: turnOf(dir, p, u), dismissed: u.dismissed };
  });
  // 見えないスレッドとの「結んだ・外した」は出さない（0033 の 3）
  const readable = (id: string) => {
    const u = p.threads[id];
    return u !== undefined && canReadDataSource(viewer, u.dataSourceId);
  };
  const entries: (ThreadLogEntry & { threadId: string })[] = t.log
    .filter((l) => (l.kind !== 'linked' && l.kind !== 'unlinked') || l.otherThreadId === undefined || readable(l.otherThreadId))
    .map((l) => ({ ...l, threadId: t.id }));
  for (const l of linked) {
    for (const e of p.threads[l.threadId]!.log) if (e.kind === 'signal' || e.kind === 'note') entries.push({ ...e, threadId: l.threadId });
  }
  const timeline = sortLog(entries)
    .filter((e) => opts.since === undefined || e.at > opts.since)
    .map((e) => {
      const entry: TimelineEntry = { at: e.at, threadId: e.threadId, kind: e.kind };
      if (e.signalId) entry.signal = signalView(dir, p.signals[e.signalId]!);
      if (e.reason !== undefined) entry.reason = e.reason;
      if (e.actorUserId !== undefined) entry.actorUserId = e.actorUserId;
      if (e.userId !== undefined) entry.userId = e.userId;
      if (e.otherThreadId !== undefined) entry.otherThreadId = e.otherThreadId;
      if (e.route !== undefined) entry.route = e.route;
      if (e.name !== undefined) entry.name = e.name;
      if (e.value !== undefined) entry.value = e.value;
      if (e.fields !== undefined) entry.fields = e.fields;
      if (e.kind === 'overdue' && e.replyExpectedBy !== undefined) entry.replyExpectedBy = e.replyExpectedBy;
      return entry;
    });
  return {
    thread: threadItem(dir, viewer, p, t),
    dataSource: { id: t.dataSourceId, name: ds?.name ?? t.dataSourceId, kind: ds?.kind ?? 'service', channel: ds?.kind === 'service' ? ds.channel : 'note' },
    linked,
    timeline,
  };
}

/** Viewer が生ペイロードを読めるシグナル（読者になっているデータソースのものだけ） */
export function visibleSignals(viewer: Viewer, p: Projections): SignalRecord[] {
  return Object.values(p.signals).filter((s) => canReadDataSource(viewer, s.dataSourceId));
}

export interface ListView {
  id: string;
  dataSource: { id: string; kind: DataSource['kind']; name: string; description: string; channel: string };
  /** 読者（User）と、その Contact（あれば） */
  readers: { userId: string; name: string; contactId: string | null }[];
  attributeDefs: AttributeDef[];
}

/** 見えるリストの一覧（list_lists） */
export function listLists(dir: Directory, viewer: Viewer): ListView[] {
  return viewer.listIds.map((id) => getListView(dir, viewer, id)).filter((v): v is ListView => v !== null);
}

export function getListView(dir: Directory, viewer: Viewer, listId: string): ListView | null {
  const list = dir.list(listId);
  const ds = list ? dir.dataSource(list.dataSourceId) : undefined;
  if (!list || !ds || !canReadDataSource(viewer, ds.id)) return null;
  return {
    id: list.id,
    dataSource: { id: ds.id, kind: ds.kind, name: ds.name, description: ds.description, channel: ds.kind === 'service' ? ds.channel : 'note' },
    readers: dir.readersOfList(list.id).map((u) => {
      const c = dir.contactOfUser(u);
      return { userId: u, name: c?.name ?? dir.user(u)?.name ?? u, contactId: c?.id ?? null };
    }),
    attributeDefs: dir.attributeDefs(ds.id),
  };
}
