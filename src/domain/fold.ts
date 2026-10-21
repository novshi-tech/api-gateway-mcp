import { deriveComm, sortLog } from './comm';
import type { DomainEvent, PayloadOf } from './events';
import { emptyProjections, indexKey, type Projections, type SignalRecord, type Thread } from './projections';

/**
 * 畳み込み。IO を持たない純関数で、入力の state は変更しない。
 * `fold(events)` でいつでも投影をイベントから作り直せる（H1）。
 * fold は 1 段（0014）: スレッドの投影はそのスレッドのイベントとリンクのイベントだけから決まり、
 * リンク先の状態は読まない（リンク先と合わせるのはクエリ層）。
 */
export function fold(events: readonly DomainEvent[], base?: Projections): Projections {
  const first = events[0];
  const state: Projections = base ? structuredClone(base) : emptyProjections(first?.tenantId ?? '');
  for (const e of events) apply(state, e);
  return state;
}

export class FoldError extends Error {}

function apply(s: Projections, e: DomainEvent): void {
  if (s.tenantId === '') s.tenantId = e.tenantId;
  if (e.tenantId !== s.tenantId) throw new FoldError(`tenant mismatch: ${e.tenantId} != ${s.tenantId}`);
  if (e.seq <= s.lastSeq) throw new FoldError(`non-monotonic seq ${e.seq} after ${s.lastSeq}`);
  s.lastSeq = e.seq;

  switch (e.type) {
    case 'SignalObserved':
      return onSignal(s, e);
    case 'SignalThreaded':
      return onThreaded(s, e, e.payload);
    case 'ThreadDismissed':
    case 'ThreadReopened': {
      const t = mustThread(s, e.payload.threadId);
      t.log.push({
        seq: e.seq,
        at: e.at,
        kind: e.type === 'ThreadDismissed' ? 'dismissed' : 'reopened',
        reason: e.payload.reason,
        actorUserId: e.payload.actorUserId,
      });
      recompute(s, t, e.at);
      return;
    }
    case 'ThreadClaimed': {
      const t = mustThread(s, e.payload.threadId);
      t.log.push({ seq: e.seq, at: e.at, kind: 'claimed', userId: e.payload.userId, actorUserId: e.payload.actorUserId, reason: e.payload.reason });
      recompute(s, t, e.at);
      return;
    }
    case 'ThreadLinked':
      return onLinked(s, e, e.payload);
    case 'ThreadAttributeSet': {
      const p = e.payload;
      const t = mustThread(s, p.threadId);
      if (p.value === null) delete t.attributes[p.name];
      else t.attributes[p.name] = p.value;
      t.log.push({ seq: e.seq, at: e.at, kind: 'attribute', name: p.name, value: p.value, actorUserId: p.actorUserId });
      recompute(s, t, e.at);
      return;
    }
  }
}

/** 無向の辺を両端に載せる（外すときは両端から外す） */
function onLinked(s: Projections, e: DomainEvent, p: PayloadOf<'ThreadLinked'>): void {
  if (p.a === p.b) throw new FoldError(`thread ${p.a} cannot link to itself`);
  const ends: [Thread, string][] = [
    [mustThread(s, p.a), p.b],
    [mustThread(s, p.b), p.a],
  ];
  for (const [t, other] of ends) {
    t.links = t.links.filter((l) => l.threadId !== other);
    if (p.op === 'link') {
      t.links.push({ threadId: other, route: p.route, linkedAt: e.at, actorUserId: p.actorUserId });
      t.links.sort((x, y) => (x.threadId < y.threadId ? -1 : x.threadId > y.threadId ? 1 : 0));
    }
    t.log.push({
      seq: e.seq,
      at: e.at,
      kind: p.op === 'link' ? 'linked' : 'unlinked',
      otherThreadId: other,
      route: p.route,
      actorUserId: p.actorUserId,
      reason: p.reason,
    });
    recompute(s, t, e.at);
  }
}

function onSignal(s: Projections, e: Extract<DomainEvent, { type: 'SignalObserved' }>): void {
  const p = e.payload;
  const record: SignalRecord = {
    signalId: p.signalId,
    dataSourceId: p.dataSourceId,
    direction: p.direction,
    channel: p.channel,
    from: p.from,
    to: p.to,
    fromPartyId: p.fromPartyId,
    toPartyIds: p.toPartyIds,
    subject: p.subject,
    body: p.body,
    anchors: p.anchors,
    attachments: p.attachments,
    sourceRef: p.sourceRef,
    at: e.at,
    seq: e.seq,
    threadId: null,
    threadedBy: null,
    needsResponse: null,
  };
  s.signals[p.signalId] = record;
  s.index.sourceRefs[indexKey(p.dataSourceId, p.sourceRef)] = p.signalId;
  if (p.anchors.messageId) s.index.messageIds[indexKey(p.dataSourceId, p.anchors.messageId)] = p.signalId;
}

function onThreaded(s: Projections, e: DomainEvent, p: PayloadOf<'SignalThreaded'>): void {
  const sig = s.signals[p.signalId];
  if (!sig) throw new FoldError(`unknown signal ${p.signalId}`);

  // 移し替え: 以前のスレッドから外す（元の判断イベントは残る）
  if (sig.threadId) {
    const prev = mustThread(s, sig.threadId);
    prev.signalIds = prev.signalIds.filter((id) => id !== sig.signalId);
    prev.log = prev.log.filter((l) => l.signalId !== sig.signalId);
    recompute(s, prev, e.at);
  }

  const choice = p.thread;
  if (choice.kind === 'new') {
    if (s.threads[choice.threadId]) throw new FoldError(`thread ${choice.threadId} already exists`);
    s.threads[choice.threadId] = newThread(s.tenantId, choice.threadId, sig.dataSourceId, choice.title, sig.at);
  }
  const t = mustThread(s, choice.threadId);
  if (t.dataSourceId !== sig.dataSourceId) {
    throw new FoldError(`signal ${sig.signalId} (${sig.dataSourceId}) cannot go into thread ${t.id} (${t.dataSourceId})`);
  }
  sig.threadId = t.id;
  sig.threadedBy = p.by;
  sig.needsResponse = sig.direction === 'outbound' ? null : p.needsResponse;
  t.log.push({
    seq: sig.seq,
    at: sig.at,
    kind: sig.channel === 'note' ? 'note' : 'signal',
    signalId: sig.signalId,
    direction: sig.direction,
    needsResponse: sig.needsResponse,
    toPartyIds: sig.direction === 'outbound' ? sig.toPartyIds : undefined,
  });
  recompute(s, t, e.at);
}

function recompute(s: Projections, t: Thread, at: string): void {
  t.log = sortLog(t.log);
  t.signalIds = t.log.filter((l) => l.kind === 'signal' || l.kind === 'note').map((l) => l.signalId!);
  Object.assign(t, deriveComm(t.log));
  const parties = new Set<string>();
  for (const id of t.signalIds) {
    const sig = s.signals[id]!;
    if (sig.direction === 'inbound' && sig.fromPartyId) parties.add(sig.fromPartyId);
    if (sig.direction === 'outbound') for (const p of sig.toPartyIds) parties.add(p);
  }
  t.counterpartPartyIds = [...parties].sort();
  if (at > t.updatedAt) t.updatedAt = at;
}

function newThread(tenantId: string, id: string, dataSourceId: string, title: string, at: string): Thread {
  return {
    id,
    tenantId,
    dataSourceId,
    title,
    counterpartPartyIds: [],
    signalIds: [],
    log: [],
    links: [],
    attributes: {},
    createdAt: at,
    updatedAt: at,
    ...deriveComm([]),
  };
}

function mustThread(s: Projections, id: string): Thread {
  const t = s.threads[id];
  if (!t) throw new FoldError(`unknown thread ${id}`);
  return t;
}
