import type { CoreContext } from './context';
import type { Directory } from './directory';
import type { AttributeDef, DataSource } from './entities';
import { DomainError } from './errors';
import { AttributeValue, draft, type DraftEvent, type ThreadChoice } from './events';
import type { Projections, SignalRecord, Thread } from './projections';
import { linkCandidates } from './turn';
import { canReadDataSource, type Viewer } from './viewer';

// スタンド（＝ユーザー）が呼ぶ操作の判断部分。状態とコマンドを受けてイベントを返すだけの純関数。
// 操作できるのは、スレッドが見えている人（そのデータソースの読者）。

export function visibleThreadOrThrow(p: Projections, viewer: Viewer, threadId: string): Thread {
  const t = p.threads[threadId];
  if (!t || !canReadDataSource(viewer, t.dataSourceId)) {
    throw new DomainError('not_found', `thread ${threadId} not found`);
  }
  return t;
}

export function visibleSignalOrThrow(p: Projections, viewer: Viewer, signalId: string): SignalRecord {
  const s = p.signals[signalId];
  if (!s || !canReadDataSource(viewer, s.dataSourceId)) {
    throw new DomainError('not_found', `signal ${signalId} not found`);
  }
  return s;
}

// ---- 片付けと開き直し ----

export function dismissThread(p: Projections, viewer: Viewer, input: { threadId: string; reason: string }): DraftEvent[] {
  const t = visibleThreadOrThrow(p, viewer, input.threadId);
  if (!input.reason.trim()) throw new DomainError('invalid', 'reason is required');
  if (t.dismissed) return [];
  return [draft('ThreadDismissed', { threadId: t.id, actorUserId: viewer.userId, reason: input.reason })];
}

export function reopenThread(p: Projections, viewer: Viewer, input: { threadId: string; reason?: string }): DraftEvent[] {
  const t = visibleThreadOrThrow(p, viewer, input.threadId);
  if (!t.dismissed) return [];
  return [draft('ThreadReopened', { threadId: t.id, actorUserId: viewer.userId, reason: input.reason })];
}

// ---- 直す操作: シグナルの移し替え ----

export type MoveTarget = { kind: 'existing'; threadId: string } | { kind: 'new'; title: string };

/**
 * シグナルを別のスレッド（同じデータソースの既存のスレッドか、新しいスレッド）へ移す。
 * 「返事や対応を求めているか」も同時に直せる（省略すれば今の値のまま）。元の判断は消さない（追記）。
 */
export function moveSignal(
  p: Projections,
  viewer: Viewer,
  ctx: CoreContext,
  input: { signalId: string; to: MoveTarget; needsResponse?: boolean; reason: string },
): { events: DraftEvent[]; threadId: string } {
  const sig = visibleSignalOrThrow(p, viewer, input.signalId);
  if (!input.reason.trim()) throw new DomainError('invalid', 'reason is required');

  let choice: ThreadChoice;
  if (input.to.kind === 'existing') {
    const t = p.threads[input.to.threadId];
    if (!t || t.dataSourceId !== sig.dataSourceId) {
      throw new DomainError('invalid', `signal ${sig.signalId} cannot move to thread ${input.to.threadId} (different data source)`);
    }
    choice = { kind: 'existing', threadId: t.id };
  } else {
    if (!input.to.title.trim()) throw new DomainError('invalid', 'title is required');
    choice = { kind: 'new', threadId: ctx.newId('thr'), title: input.to.title };
  }
  if (sig.direction === 'outbound' && input.needsResponse !== undefined) {
    throw new DomainError('invalid', 'needs_response is not judged for outbound signals');
  }
  const needsResponse = sig.direction === 'outbound' ? null : (input.needsResponse ?? sig.needsResponse ?? true);
  if (choice.kind === 'existing' && choice.threadId === sig.threadId && needsResponse === sig.needsResponse) {
    return { events: [], threadId: choice.threadId };
  }
  return {
    threadId: choice.threadId,
    events: [
      draft('SignalThreaded', {
        signalId: sig.signalId,
        thread: choice,
        by: 'human',
        confidence: 1,
        reason: input.reason,
        needsResponse,
        actorUserId: viewer.userId,
      }),
    ],
  };
}

// ---- 個人のメモ（0014 の 2） ----

/** Viewer の個人のメモのデータソース */
export function notesDataSourceOf(dir: Directory, viewer: Viewer): Extract<DataSource, { kind: 'notes' }> | undefined {
  if (viewer.partyId === null) return undefined;
  return dir.seed.dataSources.find(
    (d): d is Extract<DataSource, { kind: 'notes' }> =>
      d.kind === 'notes' && d.ownerPartyId === viewer.partyId && viewer.dataSourceIds.includes(d.id),
  );
}

/**
 * 個人のメモのデータソースへの SignalObserved（from は本人）と、置き先の SignalThreaded（by: self）。
 * threadId を渡せば既存のメモのスレッドに足し、渡さなければ新しいスレッド（「この件」）を作る。
 * 件名は title、なければ本文の最初の行（0014 の未決 2）
 */
export function addNote(
  p: Projections,
  viewer: Viewer,
  ctx: CoreContext,
  input: { threadId?: string; title?: string; body: string },
): { events: DraftEvent[]; threadId: string; signalId: string } {
  if (!input.body.trim()) throw new DomainError('invalid', 'body is required');
  const ds = notesDataSourceOf(ctx.dir, viewer);
  if (!ds) throw new DomainError('not_found', `notes of ${viewer.userId} not found`);

  let choice: ThreadChoice;
  if (input.threadId !== undefined) {
    const t = visibleThreadOrThrow(p, viewer, input.threadId);
    if (t.dataSourceId !== ds.id) throw new DomainError('invalid', `thread ${t.id} is not in your notes`);
    if (input.title !== undefined) throw new DomainError('invalid', 'title is only for a new thread');
    choice = { kind: 'existing', threadId: t.id };
  } else {
    const title = input.title?.trim() || firstLine(input.body);
    choice = { kind: 'new', threadId: ctx.newId('thr'), title };
  }
  const signalId = ctx.newId('sig');
  const self = { channel: 'note' as const, value: ds.ownerPartyId };
  return {
    threadId: choice.threadId,
    signalId,
    events: [
      draft('SignalObserved', {
        signalId,
        dataSourceId: ds.id,
        direction: 'outbound',
        channel: 'note',
        from: self,
        to: [],
        fromPartyId: ds.ownerPartyId,
        toPartyIds: [],
        body: input.body,
        sourceRef: `note:${signalId}`,
      }),
      draft('SignalThreaded', {
        signalId,
        thread: choice,
        by: 'self',
        confidence: 1,
        reason: choice.kind === 'new' ? '本人が新しい件として書いた' : '本人が置き先を指定した',
        needsResponse: null,
        actorUserId: viewer.userId,
      }),
    ],
  };
}

function firstLine(body: string): string {
  const line = body.trim().split('\n')[0]!.trim();
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

// ---- 持ち主（ThreadClaimed） ----

/**
 * 持つ・手放す（userId: null）・引き継ぐ。持てるのはそのデータソースの読者（User を持つ Party）だけ。
 * 個人のメモのスレッドは持ち主を持たない（本人のもの。ボールはリンク先から導出する）
 */
export function claimThread(
  p: Projections,
  viewer: Viewer,
  dir: Directory,
  input: { threadId: string; userId: string | null; reason?: string },
): DraftEvent[] {
  const t = visibleThreadOrThrow(p, viewer, input.threadId);
  const ds = dir.dataSource(t.dataSourceId);
  if (ds?.kind === 'notes') throw new DomainError('invalid', 'a notes thread has no owner');
  if (input.userId !== null) {
    const list = dir.listOfDataSource(t.dataSourceId);
    const readers = list ? dir.readersOfList(list.id) : [];
    if (!readers.some((r) => r.userId === input.userId)) {
      throw new DomainError('invalid', `user ${input.userId} is not a reader of data source ${t.dataSourceId}`);
    }
  }
  if (t.ownerUserId === input.userId) return [];
  return [draft('ThreadClaimed', { threadId: t.id, userId: input.userId, actorUserId: viewer.userId, reason: input.reason })];
}

// ---- リンク（ThreadLinked） ----

/**
 * スレッドを結ぶ。両端とも見えている必要がある。経路は、結び候補（アンカーの一致）から張れば anchor、
 * そうでなければ manual（sent は record_sent の副作用だけ）。結び済みなら何もしない
 */
export function linkThreads(
  p: Projections,
  viewer: Viewer,
  input: { threadId: string; otherThreadId: string; reason?: string },
): DraftEvent[] {
  const a = visibleThreadOrThrow(p, viewer, input.threadId);
  const b = visibleThreadOrThrow(p, viewer, input.otherThreadId);
  if (a.id === b.id) throw new DomainError('invalid', 'cannot link a thread to itself');
  if (a.links.some((l) => l.threadId === b.id)) return [];
  const route = linkCandidates(viewer, p, a).some((c) => c.threadId === b.id) ? 'anchor' : 'manual';
  return [draft('ThreadLinked', { a: a.id, b: b.id, op: 'link', route, actorUserId: viewer.userId, reason: input.reason })];
}

/** リンクを外す。外す側のスレッドが見えていればよい（相手の中身が見えなくても、辺は見えている） */
export function unlinkThreads(
  p: Projections,
  viewer: Viewer,
  input: { threadId: string; otherThreadId: string; reason?: string },
): DraftEvent[] {
  const a = visibleThreadOrThrow(p, viewer, input.threadId);
  const link = a.links.find((l) => l.threadId === input.otherThreadId);
  if (!link) return [];
  return [draft('ThreadLinked', { a: a.id, b: link.threadId, op: 'unlink', route: link.route, actorUserId: viewer.userId, reason: input.reason })];
}

// ---- 本人が付ける属性（ThreadAttributeSet） ----

/**
 * 定義（AttributeDef）はスレッドのデータソースに付く。型を確かめる。value が null なら外す。
 * 外のサービスのスレッドの属性はソースの写し（ThreadMirrored）なので、Murmur の側では書き換えない（0010・0014）
 */
export function setAttribute(
  p: Projections,
  viewer: Viewer,
  dir: Directory,
  input: { threadId: string; name: string; value: unknown },
): DraftEvent[] {
  const t = visibleThreadOrThrow(p, viewer, input.threadId);
  const ds = dir.dataSource(t.dataSourceId);
  if (ds?.kind === 'service') {
    throw new DomainError('invalid', `attributes of thread ${t.id} are mirrored from ${ds.name}; change them at the source`);
  }
  const def = dir.attributeDefs(t.dataSourceId).find((d) => d.name === input.name);
  if (!def) throw new DomainError('invalid', `attribute ${input.name} is not defined for data source ${t.dataSourceId}`);
  const value = input.value === null ? null : checkAttribute(dir, def, input.value);
  if ((t.attributes[def.name] ?? null) === value) return [];
  return [draft('ThreadAttributeSet', { threadId: t.id, name: def.name, value, actorUserId: viewer.userId })];
}

export function checkAttribute(dir: Directory, def: AttributeDef, raw: unknown): AttributeValue {
  const bad = (why: string) => new DomainError('invalid', `attribute ${def.name} (${def.type}): ${why}`);
  const parsed = AttributeValue.safeParse(raw);
  if (!parsed.success) throw bad('value must be a string, number or boolean');
  const v = parsed.data;
  switch (def.type) {
    case 'string':
      if (typeof v !== 'string') throw bad('not a string');
      return v;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) throw bad('not a number');
      return v;
    case 'boolean':
      if (typeof v !== 'boolean') throw bad('not a boolean');
      return v;
    case 'date':
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/.test(v)) throw bad('not a date (YYYY-MM-DD)');
      return v;
    case 'enum':
      if (typeof v !== 'string' || !(def.options ?? []).includes(v)) throw bad(`not one of ${(def.options ?? []).join(', ')}`);
      return v;
    case 'party': {
      if (typeof v !== 'string' || !dir.party(v)) throw bad('unknown party');
      return v;
    }
  }
}
