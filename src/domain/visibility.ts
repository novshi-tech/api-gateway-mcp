import type { Directory } from './directory';
import type { AttributeDef, DataSource } from './entities';
import type { Projections, SignalRecord, Thread } from './projections';
import { canReadDataSource, membership, type Viewer } from './viewer';

// クエリ層の可視性。投影のスナップショットと Viewer から「見えるもの」だけを返す純関数。
// - リストの読者には、そのデータソースのスレッドの生の中身が見える。個人のメモは本人だけ
// - テナント外は 0 件、ゴースト Party は Viewer になれない

/** ステップ 2 で実装する分。my_turn・mine はステップ 3、overdue はステップ 4 */
export type ThreadFilter = 'open' | 'triage' | 'all';

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
  signalCount: number;
  updatedAt: string;
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
    signalCount: t.signalIds.length,
    updatedAt: t.updatedAt,
  };
}

/** 仕分け待ち: ボールが「こちら」で、片付けていないスレッド（持ち主はステップ 3 で足す） */
export function isTriage(t: Thread): boolean {
  return t.ball.kind === 'us' && !t.dismissed;
}

/** User 横断の見えるスレッド。各テナントの Party を束ねて返す */
export function listThreads(
  viewer: Viewer,
  projections: readonly Projections[],
  opts: { filter?: ThreadFilter; tenantId?: string; dataSourceId?: string } = {},
): ThreadSummary[] {
  const filter = opts.filter ?? 'open';
  const out: ThreadSummary[] = [];
  for (const p of projections) {
    if (opts.tenantId && p.tenantId !== opts.tenantId) continue;
    const m = membership(viewer, p.tenantId);
    if (!m) continue;
    for (const t of Object.values(p.threads)) {
      if (!m.dataSourceIds.includes(t.dataSourceId)) continue;
      if (opts.dataSourceId && t.dataSourceId !== opts.dataSourceId) continue;
      if (filter === 'open' && t.dismissed) continue;
      if (filter === 'triage' && !isTriage(t)) continue;
      out.push(summarizeThread(t));
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1));
}

export type SignalView = Pick<
  SignalRecord,
  'signalId' | 'direction' | 'channel' | 'from' | 'to' | 'subject' | 'body' | 'attachments' | 'anchors' | 'at' | 'threadedBy' | 'needsResponse'
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
  };
}

export interface ThreadView {
  thread: ThreadSummary;
  dataSource: { id: string; name: string; kind: DataSource['kind']; channel: string };
  /** 時刻順のシグナルと片付け */
  log: { at: string; kind: Thread['log'][number]['kind']; signal?: SignalView; reason?: string }[];
}

export function getThreadView(dir: Directory, viewer: Viewer, p: Projections, threadId: string): ThreadView | null {
  const t = p.threads[threadId];
  if (!t || !canReadDataSource(viewer, p.tenantId, t.dataSourceId)) return null;
  const ds = dir.dataSource(t.dataSourceId);
  return {
    thread: summarizeThread(t),
    dataSource: { id: t.dataSourceId, name: ds?.name ?? t.dataSourceId, kind: ds?.kind ?? 'service', channel: ds?.kind === 'service' ? ds.channel : 'note' },
    log: t.log.map((l) => ({
      at: l.at,
      kind: l.kind,
      signal: l.signalId ? signalView(p.signals[l.signalId]!) : undefined,
      reason: l.reason,
    })),
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
