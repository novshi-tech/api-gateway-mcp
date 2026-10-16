import type { Directory } from './directory';
import type { AttributeDef } from './entities';
import type { Derivation, IgnoreEntry, Projections, SignalRecord, Task, TimelineEntry } from './projections';
import { sortTimeline } from './comm';
import { isMemberOfList, membership, type Viewer } from './viewer';

// クエリ層の可視性。投影のスナップショットと Viewer から「見えるもの」だけを返す純関数。
// - テナント外は 0 件
// - 同一テナントの別リストには、派生の要約（派生本文）だけ。生ペイロードは見せない

export type TaskFilter = 'open' | 'ball_at_me' | 'overdue' | 'all';

export interface TaskSummary {
  id: string;
  tenantId: string;
  listId: string;
  title: string;
  status: Task['status'];
  ballAt: Task['ballAt'];
  replyExpectedBy: string | null;
  unansweredSince: string | null;
  overdue: boolean;
  attributes: Record<string, unknown>;
  updatedAt: string;
}

export function summarizeTask(t: Task): TaskSummary {
  return {
    id: t.id,
    tenantId: t.tenantId,
    listId: t.listId,
    title: t.title,
    status: t.status,
    ballAt: t.ballAt,
    replyExpectedBy: t.replyExpectedBy,
    unansweredSince: t.unansweredSince,
    overdue: t.overdue,
    attributes: t.attributes,
    updatedAt: t.updatedAt,
  };
}

/** User 横断の自分のタスク一覧。各テナントの Party を束ねて返す */
export function listMyTasks(
  viewer: Viewer,
  projections: readonly Projections[],
  filter: TaskFilter = 'open',
  tenantId?: string,
): TaskSummary[] {
  const out: TaskSummary[] = [];
  for (const p of projections) {
    if (tenantId && p.tenantId !== tenantId) continue;
    const m = membership(viewer, p.tenantId);
    if (!m) continue;
    for (const t of Object.values(p.tasks)) {
      if (!m.listIds.includes(t.listId)) continue;
      if (filter === 'open' && t.status !== 'open') continue;
      if (filter === 'ball_at_me' && !(t.status === 'open' && t.ballAt.kind === 'list' && m.listIds.includes(t.ballAt.listId))) continue;
      if (filter === 'overdue' && !(t.status === 'open' && t.overdue)) continue;
      out.push(summarizeTask(t));
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1));
}

export interface TimelineItem extends TimelineEntry {
  signal?: Pick<SignalRecord, 'signalId' | 'direction' | 'channel' | 'from' | 'to' | 'subject' | 'body' | 'attachments' | 'anchors'>;
  derivation?: DerivationView;
}

export interface DerivationView {
  id: string;
  sourceTaskId: string;
  sourceListId: string;
  targetListId: string;
  targetTaskId: string;
  mode: Derivation['mode'];
  status: Derivation['status'];
  title: string;
  body: string;
  attachments: Derivation['attachments'];
  toPartyIds: string[];
  replyExpected: Derivation['replyExpected'];
}

export function derivationView(d: Derivation): DerivationView {
  return {
    id: d.id,
    sourceTaskId: d.sourceTaskId,
    sourceListId: d.sourceListId,
    targetListId: d.targetListId,
    targetTaskId: d.targetTaskId,
    mode: d.mode,
    status: d.status,
    title: d.title,
    body: d.body,
    attachments: d.attachments,
    toPartyIds: d.toPartyIds,
    replyExpected: d.replyExpected,
  };
}

export type TaskView =
  | {
      access: 'full';
      task: TaskSummary;
      timeline: TimelineItem[];
      attributeDefs: AttributeDef[];
      linkedTasks: { taskId: string; listId: string; derivationId: string }[];
    }
  | {
      access: 'summary';
      task: Pick<TaskSummary, 'id' | 'tenantId' | 'listId' | 'title' | 'status'>;
      /** 自分のリストと結ばれた派生の要約だけ */
      derivations: DerivationView[];
    };

export function getTaskView(dir: Directory, viewer: Viewer, p: Projections, taskId: string): TaskView | null {
  const t = p.tasks[taskId];
  const m = membership(viewer, p.tenantId);
  if (!t || !m) return null;

  if (m.listIds.includes(t.listId)) {
    const timeline = sortTimeline(p.timeline.filter((e) => e.taskId === t.id)).map((e): TimelineItem => {
      const item: TimelineItem = { ...e };
      if (e.signalId) {
        const s = p.signals[e.signalId];
        if (s) {
          item.signal = {
            signalId: s.signalId,
            direction: s.direction,
            channel: s.channel,
            from: s.from,
            to: s.to,
            subject: s.subject,
            body: s.body,
            attachments: s.attachments,
            anchors: s.anchors,
          };
        }
      }
      if (e.derivationId) {
        const d = p.derivations[e.derivationId];
        if (d) item.derivation = derivationView(d);
      }
      return item;
    });
    const linkedTasks = p.links
      .filter((l) => l.sourceTaskId === t.id || l.targetTaskId === t.id)
      .map((l) => {
        const other = l.sourceTaskId === t.id ? l.targetTaskId : l.sourceTaskId;
        return { taskId: other, listId: p.tasks[other]?.listId ?? '', derivationId: l.derivationId };
      });
    return { access: 'full', task: summarizeTask(t), timeline, attributeDefs: dir.attributeDefs(t.listId), linkedTasks };
  }

  // 別リストのタスク: 自分のリストのタスクと派生で結ばれていれば要約だけ見せる
  const derivations = Object.values(p.derivations).filter((d) => {
    if (d.status === 'proposed' || d.status === 'rejected') return false;
    const touches = d.sourceTaskId === t.id || d.targetTaskId === t.id;
    const otherList = d.sourceTaskId === t.id ? p.tasks[d.targetTaskId]?.listId : p.tasks[d.sourceTaskId]?.listId;
    return touches && otherList !== undefined && m.listIds.includes(otherList);
  });
  if (derivations.length === 0) return null;
  return {
    access: 'summary',
    task: { id: t.id, tenantId: t.tenantId, listId: t.listId, title: t.title, status: t.status },
    derivations: derivations.map(derivationView),
  };
}

/** Viewer が生ペイロードを読めるシグナル（自分のリストのタスクに置かれたものだけ） */
export function visibleSignals(viewer: Viewer, p: Projections): SignalRecord[] {
  const m = membership(viewer, p.tenantId);
  if (!m) return [];
  return Object.values(p.signals).filter((s) => {
    const t = s.taskId ? p.tasks[s.taskId] : undefined;
    return t !== undefined && m.listIds.includes(t.listId);
  });
}

/** 無視の監査ログ。そのシグナルを置けたリストのメンバーか、取得主体本人に見える */
export function explainIgnore(dir: Directory, viewer: Viewer, p: Projections, since?: string): IgnoreEntry[] {
  const m = membership(viewer, p.tenantId);
  if (!m) return [];
  return p.ignoreLog.filter((e) => {
    if (since && e.at < since) return false;
    const s = p.signals[e.signalId];
    if (!s) return false;
    if (s.acquiredAs.kind === 'user' && s.acquiredAs.userId === viewer.userId) return true;
    return dir.allowedListIds(p.tenantId, s.acquiredAs, s.channel).some((id) => m.listIds.includes(id));
  });
}

export interface ListView {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  members: { partyId: string; name: string; kind: string; ghost: boolean }[];
  attributeDefs: AttributeDef[];
  channels: { channel: string; via: 'organization' }[];
}

export function getListView(dir: Directory, viewer: Viewer, listId: string): ListView | null {
  const list = dir.list(listId);
  if (!list || !isMemberOfList(viewer, list.tenantId, listId)) return null;
  return {
    id: list.id,
    tenantId: list.tenantId,
    name: list.name,
    description: list.description,
    members: dir.membersOfList(listId).map((p) => ({ partyId: p.id, name: p.name, kind: p.kind, ghost: p.userId === undefined })),
    attributeDefs: dir.attributeDefs(listId),
    channels: dir.seed.channelPolicies
      .filter((c) => c.tenantId === list.tenantId && c.allowedListIds.includes(listId))
      .map((c) => ({ channel: c.channel, via: 'organization' as const })),
  };
}
