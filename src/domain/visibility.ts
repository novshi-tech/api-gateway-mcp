import type { Directory } from './directory';
import type { AttributeDef, DataSource } from './entities';
import type { AttributeValue } from './events';
import { sortLog } from './comm';
import type { Projections, SignalRecord, Thread, ThreadLink, ThreadLogEntry } from './projections';
import { derivedBall, isMyTurn, linkCandidates, linkedActiveSinceDismissed, turnOf, type DerivedBall, type LinkCandidate, type Turn } from './turn';
import { canReadDataSource, membership, type Viewer } from './viewer';

// クエリ層の可視性。投影のスナップショットと Viewer から「見えるもの」だけを返す純関数。
// - リストの読者には、そのデータソースのスレッドの生の中身が見える。個人のメモは本人だけ
// - 持ち主とリンク（結び先の id）はスレッドの側にあるので、スレッドが見える人に見える。結び先の中身はその先の可視性に従う
// - テナント外は 0 件、ゴースト Party は Viewer になれない

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
  tenantId: string;
  dataSourceId: string;
  title: string;
  ball: Thread['ball'];
  counterpartPartyIds: string[];
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  unansweredSince: string | null;
  dismissed: boolean;
  dismissReason: string | null;
  activeSinceDismissed: boolean;
  ownerUserId: string | null;
  replyExpectedBy: string | null;
  overdue: boolean;
  links: ThreadLink[];
  attributes: Record<string, AttributeValue>;
  signalCount: number;
  updatedAt: string;
}

/** 一覧と詳細で返すスレッド。投影の要約に、クエリ層で導出したもの（誰の番か・リンク先から導出したボール・結び候補）を足す */
export interface ThreadItem extends ThreadSummary {
  turn: Turn;
  derivedBall: DerivedBall | null;
  /** 閉じたスレッドに結ばれた先で、閉じたあとにシグナルが来た */
  linkedActiveSinceDismissed: boolean;
  linkCandidates: LinkCandidate[];
}

export function summarizeThread(t: Thread): ThreadSummary {
  return {
    id: t.id,
    tenantId: t.tenantId,
    dataSourceId: t.dataSourceId,
    title: t.title,
    ball: t.ball,
    counterpartPartyIds: t.counterpartPartyIds,
    lastInboundAt: t.lastInboundAt,
    lastOutboundAt: t.lastOutboundAt,
    unansweredSince: t.unansweredSince,
    dismissed: t.dismissed,
    dismissReason: t.dismissReason,
    activeSinceDismissed: t.activeSinceDismissed,
    ownerUserId: t.ownerUserId,
    replyExpectedBy: t.replyExpectedBy,
    overdue: t.overdue,
    links: t.links,
    attributes: t.attributes,
    signalCount: t.signalIds.length,
    updatedAt: t.updatedAt,
  };
}

export function threadItem(dir: Directory, viewer: Viewer, p: Projections, t: Thread): ThreadItem {
  return {
    ...summarizeThread(t),
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

/** User 横断の見えるスレッド。各テナントの Party を束ねて返す */
export function listThreads(
  dir: Directory,
  viewer: Viewer,
  projections: readonly Projections[],
  opts: { filter?: ThreadFilter; tenantId?: string; dataSourceId?: string; since?: string } = {},
): ThreadItem[] {
  const filter = opts.filter ?? 'open';
  const out: ThreadItem[] = [];
  for (const p of projections) {
    if (opts.tenantId && p.tenantId !== opts.tenantId) continue;
    const m = membership(viewer, p.tenantId);
    if (!m) continue;
    for (const t of Object.values(p.threads)) {
      if (!m.dataSourceIds.includes(t.dataSourceId)) continue;
      if (opts.dataSourceId && t.dataSourceId !== opts.dataSourceId) continue;
      if (filter === 'open' && t.dismissed) continue;
      if (filter === 'triage' && !isTriage(dir, p, t)) continue;
      if (filter === 'overdue' && !t.overdue) continue;
      if (filter === 'my_turn' && (t.dismissed || !isMyTurn(turnOf(dir, p, t), viewer))) continue;
      if (filter === 'mine') {
        const ds = dir.dataSource(t.dataSourceId);
        if (ds?.kind !== 'notes' || ds.ownerPartyId !== m.partyId) continue;
      }
      if (opts.since !== undefined && !movedSince(viewer, p, t, opts.since)) continue;
      out.push(threadItem(dir, viewer, p, t));
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1));
}

function movedSince(viewer: Viewer, p: Projections, t: Thread, since: string): boolean {
  if (t.updatedAt > since) return true;
  return t.links.some((l) => {
    const u = p.threads[l.threadId];
    return !!u && canReadDataSource(viewer, p.tenantId, u.dataSourceId) && u.updatedAt > since;
  });
}

export type SignalView = Pick<
  SignalRecord,
  'signalId' | 'direction' | 'channel' | 'from' | 'to' | 'subject' | 'body' | 'attachments' | 'anchors' | 'at' | 'threadedBy' | 'needsResponse' | 'recorded'
>;

function signalView(s: SignalRecord): SignalView {
  return {
    signalId: s.signalId,
    direction: s.direction,
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
  replyExpectedBy?: string | null;
}

/** 結んだ先の見え方。見えない先は id と経路だけ（中身はその先の可視性に従う） */
export interface LinkView extends ThreadLink {
  visible: boolean;
  title?: string;
  dataSourceId?: string;
  turn?: Turn;
  dismissed?: boolean;
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
  if (!t || !canReadDataSource(viewer, p.tenantId, t.dataSourceId)) return null;
  const ds = dir.dataSource(t.dataSourceId);
  const linked: LinkView[] = t.links.map((l) => {
    const u = p.threads[l.threadId];
    if (!u || !canReadDataSource(viewer, p.tenantId, u.dataSourceId)) return { ...l, visible: false };
    return { ...l, visible: true, title: u.title, dataSourceId: u.dataSourceId, turn: turnOf(dir, p, u), dismissed: u.dismissed };
  });
  const entries: (ThreadLogEntry & { threadId: string })[] = t.log.map((l) => ({ ...l, threadId: t.id }));
  for (const l of linked) {
    if (!l.visible) continue;
    for (const e of p.threads[l.threadId]!.log) if (e.kind === 'signal' || e.kind === 'note') entries.push({ ...e, threadId: l.threadId });
  }
  const timeline = sortLog(entries)
    .filter((e) => opts.since === undefined || e.at > opts.since)
    .map((e) => {
      const entry: TimelineEntry = { at: e.at, threadId: e.threadId, kind: e.kind };
      if (e.signalId) entry.signal = signalView(p.signals[e.signalId]!);
      if (e.reason !== undefined) entry.reason = e.reason;
      if (e.actorUserId !== undefined) entry.actorUserId = e.actorUserId;
      if (e.userId !== undefined) entry.userId = e.userId;
      if (e.otherThreadId !== undefined) entry.otherThreadId = e.otherThreadId;
      if (e.route !== undefined) entry.route = e.route;
      if (e.name !== undefined) entry.name = e.name;
      if (e.value !== undefined) entry.value = e.value;
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
  return Object.values(p.signals).filter((s) => canReadDataSource(viewer, p.tenantId, s.dataSourceId));
}

export interface ListView {
  id: string;
  tenantId: string;
  dataSource: { id: string; kind: DataSource['kind']; name: string; description: string; channel: string };
  readers: { partyId: string; name: string }[];
  attributeDefs: AttributeDef[];
}

/** 見えるリストの一覧（list_lists）。テナント横断 */
export function listLists(dir: Directory, viewer: Viewer, opts: { tenantId?: string } = {}): ListView[] {
  return viewer.memberships
    .filter((m) => !opts.tenantId || m.tenantId === opts.tenantId)
    .flatMap((m) => m.listIds.map((id) => getListView(dir, viewer, id)))
    .filter((v): v is ListView => v !== null);
}

export function getListView(dir: Directory, viewer: Viewer, listId: string): ListView | null {
  const list = dir.list(listId);
  const ds = list ? dir.dataSource(list.dataSourceId) : undefined;
  if (!list || !ds || !canReadDataSource(viewer, list.tenantId, ds.id)) return null;
  return {
    id: list.id,
    tenantId: list.tenantId,
    dataSource: { id: ds.id, kind: ds.kind, name: ds.name, description: ds.description, channel: ds.kind === 'service' ? ds.channel : 'note' },
    readers: dir.readersOfList(list.id).map((p) => ({ partyId: p.id, name: p.name })),
    attributeDefs: dir.attributeDefs(ds.id),
  };
}
