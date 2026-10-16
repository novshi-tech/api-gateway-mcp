import { deriveComm } from './comm';
import type { DomainEvent, PayloadOf } from './events';
import {
  emptyProjections,
  type Derivation,
  type Projections,
  type SignalRecord,
  type Task,
  type TimelineEntry,
} from './projections';

/**
 * 畳み込み。IO を持たない純関数で、入力の state は変更しない。
 * `fold(events)` でいつでも投影をイベントから作り直せる（H1）。
 */
export function fold(events: readonly DomainEvent[], base?: Projections): Projections {
  const first = events[0];
  const state: Projections = base
    ? structuredClone(base)
    : emptyProjections(first?.tenantId ?? '');
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
    case 'SignalReceived':
    case 'SignalObservedSent':
      return onSignal(s, e);
    case 'IngestDecided':
      return onIngestDecided(s, e, e.payload);
    case 'TaskAttributeSet': {
      const task = mustTask(s, e.payload.taskId);
      task.attributes[e.payload.name] = e.payload.value;
      task.updatedAt = e.at;
      s.timeline.push({
        taskId: task.id,
        seq: e.seq,
        at: e.at,
        kind: 'attribute_set',
        attribute: { name: e.payload.name, value: e.payload.value },
      });
      return;
    }
    case 'DerivationProposed': {
      const p = e.payload;
      const source = mustTask(s, p.sourceTaskId);
      s.derivations[p.derivationId] = {
        id: p.derivationId,
        tenantId: e.tenantId,
        sourceTaskId: p.sourceTaskId,
        sourceListId: source.listId,
        targetListId: p.targetListId,
        targetTaskId: p.targetTaskId,
        mode: p.mode,
        title: p.title,
        body: p.body,
        attachments: p.attachments,
        toPartyIds: p.toPartyIds,
        replyExpected: p.replyExpected,
        replyToDerivationId: p.replyToDerivationId ?? null,
        status: 'proposed',
        proposedBy: p.proposedBy,
        fromAddress: null,
        toAddresses: [],
        sentRef: null,
        proposedAt: e.at,
        approvedAt: null,
        approvedBy: null,
        deliveredAt: null,
        repliedAt: null,
        overdueAt: null,
        rejectedReason: null,
      };
      return;
    }
    case 'DerivationApproved': {
      const d = mustDerivation(s, e.payload.derivationId);
      d.status = 'approved';
      d.approvedAt = e.at;
      d.approvedBy = e.payload.actorUserId;
      d.fromAddress = e.payload.fromAddress ?? null;
      d.toAddresses = e.payload.toAddresses;
      ensureTargetTask(s, d, e.at);
      if (d.mode === 'internal') deliver(s, d, e.seq, e.at);
      return;
    }
    case 'DerivationRejected': {
      const d = mustDerivation(s, e.payload.derivationId);
      d.status = 'rejected';
      d.rejectedReason = e.payload.reason;
      return;
    }
    case 'DerivationSent': {
      const d = mustDerivation(s, e.payload.derivationId);
      d.sentRef = e.payload.sentRef;
      s.index.sentRefs[e.payload.sentRef] = d.id;
      deliver(s, d, e.seq, e.at);
      return;
    }
    case 'DerivationReplied': {
      const d = mustDerivation(s, e.payload.derivationId);
      d.status = 'replied';
      d.repliedAt = e.at;
      pushEntry(s, { taskId: d.sourceTaskId, seq: e.seq, at: e.at, kind: 'derivation_replied', derivationId: d.id });
      return;
    }
    case 'ReplyOverdue': {
      const d = mustDerivation(s, e.payload.derivationId);
      d.status = 'overdue';
      d.overdueAt = e.at;
      pushEntry(s, { taskId: d.sourceTaskId, seq: e.seq, at: e.at, kind: 'reply_overdue', derivationId: d.id });
      return;
    }
    case 'TaskClosed':
    case 'TaskReopened': {
      const task = mustTask(s, e.payload.taskId);
      task.status = e.type === 'TaskClosed' ? 'closed' : 'open';
      task.updatedAt = e.at;
      s.timeline.push({ taskId: task.id, seq: e.seq, at: e.at, kind: e.type === 'TaskClosed' ? 'closed' : 'reopened' });
      return;
    }
  }
}

function onSignal(s: Projections, e: Extract<DomainEvent, { type: 'SignalReceived' | 'SignalObservedSent' }>): void {
  const p = e.payload;
  const record: SignalRecord = {
    signalId: p.signalId,
    direction: e.type === 'SignalReceived' ? 'in' : 'out',
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
    acquiredAs: p.acquiredAs,
    replyExpectedBy: e.type === 'SignalObservedSent' ? e.payload.replyExpectedBy : null,
    at: e.at,
    seq: e.seq,
    taskId: null,
    decision: 'pending',
  };
  s.signals[p.signalId] = record;
  s.index.sourceRefs[p.sourceRef] = p.signalId;
  if (p.anchors.messageId) s.index.messageIds[p.anchors.messageId] = p.signalId;
}

function onIngestDecided(s: Projections, e: DomainEvent, p: PayloadOf<'IngestDecided'>): void {
  const sig = s.signals[p.signalId];
  if (!sig) throw new FoldError(`unknown signal ${p.signalId}`);

  // 訂正: 以前の置き場所から外す（元の判断イベントは残る）
  if (sig.taskId) {
    const prev = sig.taskId;
    s.timeline = s.timeline.filter((t) => !(t.taskId === prev && t.signalId === sig.signalId));
    recompute(s, prev, e.at);
  }
  if (sig.decision === 'ignore') {
    for (const entry of s.ignoreLog) {
      if (entry.signalId === sig.signalId && entry.overriddenAtSeq === null) entry.overriddenAtSeq = e.seq;
    }
  }

  const d = p.decision;
  if (d.kind === 'ignore') {
    sig.taskId = null;
    sig.decision = 'ignore';
    s.ignoreLog.push({
      signalId: sig.signalId,
      seq: e.seq,
      at: e.at,
      channel: sig.channel,
      from: sig.from,
      subject: sig.subject,
      bodyExcerpt: sig.body.slice(0, 200),
      reason: p.reason,
      confidence: p.confidence,
      decidedBy: p.decidedBy,
      overriddenAtSeq: null,
    });
    return;
  }

  if (d.kind === 'new' && !s.tasks[d.taskId]) {
    s.tasks[d.taskId] = newTask(s.tenantId, d.taskId, d.listId, d.title, sig.at);
  }
  const taskId = d.taskId;
  mustTask(s, taskId);
  sig.taskId = taskId;
  sig.decision = d.kind;
  s.timeline.push({
    taskId,
    seq: sig.seq,
    at: sig.at,
    kind: sig.direction === 'in' ? 'inbound' : 'outbound',
    signalId: sig.signalId,
    toPartyIds: sig.direction === 'out' ? sig.toPartyIds : undefined,
    replyExpectedBy: sig.direction === 'out' ? sig.replyExpectedBy : undefined,
  });
  recompute(s, taskId, e.at);
}

function ensureTargetTask(s: Projections, d: Derivation, at: string): void {
  if (!s.tasks[d.targetTaskId]) {
    s.tasks[d.targetTaskId] = newTask(s.tenantId, d.targetTaskId, d.targetListId, d.title, at);
  }
  if (!s.links.some((l) => l.derivationId === d.id)) {
    s.links.push({ derivationId: d.id, sourceTaskId: d.sourceTaskId, targetTaskId: d.targetTaskId });
  }
}

/** 派生の適用（内部は承認時、外部は送信時）。ボールは派生先へ移る */
function deliver(s: Projections, d: Derivation, seq: number, at: string): void {
  d.deliveredAt = at;
  d.status = d.replyExpected ? (d.mode === 'internal' ? 'approved' : 'sent') : 'completed';
  const replyBy = d.replyExpected?.by ?? null;
  pushEntry(s, {
    taskId: d.sourceTaskId,
    seq,
    at,
    kind: 'derivation_out',
    derivationId: d.id,
    targetListId: d.targetListId,
    replyExpectedBy: replyBy,
  });
  pushEntry(s, {
    taskId: d.targetTaskId,
    seq,
    at,
    kind: 'derivation_in',
    derivationId: d.id,
    toPartyIds: d.mode === 'external' ? d.toPartyIds : undefined,
    replyExpectedBy: d.mode === 'external' ? replyBy : undefined,
  });
}

function pushEntry(s: Projections, entry: TimelineEntry): void {
  s.timeline.push(entry);
  recompute(s, entry.taskId, entry.at);
}

function recompute(s: Projections, taskId: string, at: string): void {
  const task = mustTask(s, taskId);
  const comm = deriveComm(
    task.listId,
    s.timeline.filter((t) => t.taskId === taskId),
  );
  Object.assign(task, comm);
  if (at > task.updatedAt) task.updatedAt = at;
}

function newTask(tenantId: string, id: string, listId: string, title: string, at: string): Task {
  return {
    id,
    tenantId,
    listId,
    title,
    status: 'open',
    attributes: {},
    createdAt: at,
    updatedAt: at,
    ...deriveComm(listId, []),
  };
}

function mustTask(s: Projections, id: string): Task {
  const t = s.tasks[id];
  if (!t) throw new FoldError(`unknown task ${id}`);
  return t;
}

function mustDerivation(s: Projections, id: string): Derivation {
  const d = s.derivations[id];
  if (!d) throw new FoldError(`unknown derivation ${id}`);
  return d;
}
