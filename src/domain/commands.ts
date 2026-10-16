import type { CoreContext } from './context';
import type { AttributeDef, Principal } from './entities';
import { DomainError } from './errors';
import { draft, type AddressRef, type DraftEvent, type FileRef } from './events';
import type { Derivation, Projections, Task } from './projections';
import { isMemberOfList, membership, type Viewer } from './viewer';

// スタンド（＝ユーザー）が呼ぶ操作の判断部分。状態とコマンドを受けてイベントを返すだけの純関数。

export function visibleTaskOrThrow(p: Projections, viewer: Viewer, taskId: string): Task {
  const task = p.tasks[taskId];
  if (!task || !isMemberOfList(viewer, p.tenantId, task.listId)) {
    throw new DomainError('not_found', `task ${taskId} not found`);
  }
  return task;
}

// ---- 属性 ----

export function setAttribute(
  p: Projections,
  viewer: Viewer,
  ctx: CoreContext,
  input: { taskId: string; name: string; value: unknown },
): DraftEvent[] {
  const task = visibleTaskOrThrow(p, viewer, input.taskId);
  const def = ctx.dir.attributeDefs(task.listId).find((d) => d.name === input.name);
  if (!def) throw new DomainError('invalid', `attribute ${input.name} is not defined on list ${task.listId}`);
  checkAttributeValue(def, input.value, ctx, p.tenantId);
  return [draft('TaskAttributeSet', { taskId: task.id, name: def.name, value: input.value, actorUserId: viewer.userId })];
}

export function checkAttributeValue(def: AttributeDef, value: unknown, ctx: CoreContext, tenantId: string): void {
  if (value === null) return; // null は値の消去
  const fail = () => {
    throw new DomainError('invalid', `attribute ${def.name} expects ${def.type}`);
  };
  switch (def.type) {
    case 'string':
      if (typeof value !== 'string') fail();
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) fail();
      break;
    case 'boolean':
      if (typeof value !== 'boolean') fail();
      break;
    case 'date':
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) fail();
      break;
    case 'enum':
      if (typeof value !== 'string' || !(def.options ?? []).includes(value)) fail();
      break;
    case 'party': {
      const party = typeof value === 'string' ? ctx.dir.party(value) : undefined;
      if (!party || party.tenantId !== tenantId) fail();
      break;
    }
  }
}

// ---- open / closed ----

export function closeTask(p: Projections, viewer: Viewer, input: { taskId: string; reason?: string }): DraftEvent[] {
  const task = visibleTaskOrThrow(p, viewer, input.taskId);
  if (task.status === 'closed') return [];
  return [draft('TaskClosed', { taskId: task.id, actorUserId: viewer.userId, reason: input.reason })];
}

export function reopenTask(p: Projections, viewer: Viewer, input: { taskId: string }): DraftEvent[] {
  const task = visibleTaskOrThrow(p, viewer, input.taskId);
  if (task.status === 'open') return [];
  return [draft('TaskReopened', { taskId: task.id, actorUserId: viewer.userId })];
}

// ---- 派生 ----

export interface ProposeInput {
  taskId: string;
  targetListId: string;
  title?: string;
  body: string;
  attachments?: FileRef[];
  toPartyIds?: string[];
  replyExpected?: { by: string } | null;
  /** 省略時は、このタスクを適用先とする未返事の派生を探して返事として扱う */
  replyToDerivationId?: string;
  proposedBy?: 'ingest' | 'stand' | 'human';
}

// 返事期待を省略した派生（completed）にも返事は来うる
const OUTSTANDING: Derivation['status'][] = ['approved', 'sent', 'overdue', 'completed'];

export function proposeDerivation(
  p: Projections,
  viewer: Viewer,
  ctx: CoreContext,
  input: ProposeInput,
): { events: DraftEvent[]; derivationId: string } {
  const source = visibleTaskOrThrow(p, viewer, input.taskId);
  const target = ctx.dir.list(input.targetListId);
  if (!target || target.tenantId !== p.tenantId) {
    throw new DomainError('invalid', `target list ${input.targetListId} is not in tenant ${p.tenantId}`);
  }
  if (target.id === source.listId) throw new DomainError('invalid', 'target list must differ from the source list');
  if (!input.body.trim()) throw new DomainError('invalid', 'body is required');

  const toPartyIds = input.toPartyIds ?? [];
  for (const id of toPartyIds) {
    const party = ctx.dir.party(id);
    if (!party || party.tenantId !== p.tenantId) throw new DomainError('invalid', `party ${id} is not in tenant`);
  }
  const mode = toPartyIds.length > 0 ? 'external' : 'internal';
  // 外部派生は返事期待が必須、内部派生は省略可（2026-10-16 決定）
  if (mode === 'external' && !input.replyExpected) {
    throw new DomainError('invalid', 'external derivation requires replyExpected');
  }

  const replyTo = findReplyTarget(p, source, input);
  const derivationId = ctx.newId('drv');
  const targetTaskId = replyTo ? replyTo.sourceTaskId : ctx.newId('task');
  return {
    derivationId,
    events: [
      draft('DerivationProposed', {
        derivationId,
        sourceTaskId: source.id,
        targetListId: target.id,
        targetTaskId,
        mode,
        title: input.title ?? source.title,
        body: input.body,
        attachments: input.attachments ?? [],
        toPartyIds,
        replyExpected: input.replyExpected ?? null,
        replyToDerivationId: replyTo?.id,
        proposedBy: input.proposedBy ?? 'stand',
        actorUserId: viewer.userId,
      }),
    ],
  };
}

function findReplyTarget(p: Projections, source: Task, input: ProposeInput): Derivation | undefined {
  if (input.replyToDerivationId) {
    const d = p.derivations[input.replyToDerivationId];
    if (!d || d.targetTaskId !== source.id || d.sourceListId !== input.targetListId) {
      throw new DomainError('invalid', `derivation ${input.replyToDerivationId} cannot be replied from this task`);
    }
    return d;
  }
  return Object.values(p.derivations)
    .filter((d) => d.targetTaskId === source.id && d.sourceListId === input.targetListId && OUTSTANDING.includes(d.status))
    .sort((a, b) => ((a.deliveredAt ?? '') < (b.deliveredAt ?? '') ? 1 : -1))[0];
}

export function listProposalsFor(p: Projections, viewer: Viewer, listId?: string): Derivation[] {
  return Object.values(p.derivations).filter(
    (d) =>
      d.status === 'proposed' &&
      isMemberOfList(viewer, p.tenantId, d.sourceListId) &&
      (listId === undefined || d.sourceListId === listId || d.targetListId === listId),
  );
}

function proposalOrThrow(p: Projections, viewer: Viewer, derivationId: string): Derivation {
  const d = p.derivations[derivationId];
  if (!d || !isMemberOfList(viewer, p.tenantId, d.sourceListId)) {
    throw new DomainError('not_found', `derivation ${derivationId} not found`);
  }
  if (d.status !== 'proposed') throw new DomainError('conflict', `derivation ${derivationId} is ${d.status}`);
  return d;
}

export interface SendPlan {
  derivationId: string;
  principal: Principal;
  from: AddressRef;
  to: AddressRef[];
  subject: string;
  body: string;
  attachments: FileRef[];
  /** 返事の紐づけ用。送信元タスクに受信したメッセージがあれば、その messageId */
  inReplyTo?: string;
}

/**
 * 承認。人の承認が唯一のゲート。宛先 Party の Address をここで解決して凍結し、
 * 送信元 Address（= 使う資格情報）もここで選ぶ。内部派生はここで適用される。
 * 外部派生なら、シェルがコネクタで送るための SendPlan も返す。
 */
export function approveDerivation(
  p: Projections,
  viewer: Viewer,
  ctx: CoreContext,
  input: { derivationId: string; fromAddress?: AddressRef },
): { events: DraftEvent[]; send: SendPlan | null } {
  const d = proposalOrThrow(p, viewer, input.derivationId);

  if (d.mode === 'internal') {
    // 返事の派生なら、元の派生の replied を先に置く（適用先のボールは適用で決まるように）
    const events = repliedFirst(d);
    events.push(draft('DerivationApproved', { derivationId: d.id, actorUserId: viewer.userId, toAddresses: [] }));
    return { events, send: null };
  }

  const { from, principal } = chooseSender(p, viewer, ctx, d, input.fromAddress);
  const toAddresses = d.toPartyIds.map((partyId) => {
    const addr = ctx.dir.addressesOfParty(partyId, from.channel, ctx.now)[0];
    if (!addr) throw new DomainError('invalid', `party ${partyId} has no ${from.channel} address`);
    return { channel: addr.channel, value: addr.value };
  });
  const lastInbound = Object.values(p.signals)
    .filter((s) => s.taskId === d.targetTaskId && s.direction === 'in' && s.channel === from.channel && s.anchors.messageId)
    .sort((a, b) => b.seq - a.seq)[0];
  return {
    events: [
      draft('DerivationApproved', {
        derivationId: d.id,
        actorUserId: viewer.userId,
        fromAddress: from,
        toAddresses,
      }),
    ],
    send: {
      derivationId: d.id,
      principal,
      from,
      to: toAddresses,
      subject: d.title,
      body: d.body,
      attachments: d.attachments,
      inReplyTo: lastInbound?.anchors.messageId,
    },
  };
}

/** 送信元 Address の選択: Viewer 本人か、そのテナントの Organization の資格情報に限る */
function chooseSender(
  p: Projections,
  viewer: Viewer,
  ctx: CoreContext,
  d: Derivation,
  requested?: AddressRef,
): { from: AddressRef; principal: Principal } {
  const usable = ctx.dir.seed.credentialRefs.filter(
    (c) =>
      c.tenantId === p.tenantId &&
      ((c.principal.kind === 'user' && c.principal.userId === viewer.userId) ||
        (c.principal.kind === 'organization' && c.principal.tenantId === p.tenantId)),
  );
  const candidates = usable
    .map((c) => ({ cred: c, addr: ctx.dir.seed.addresses.find((a) => a.id === c.addressId) }))
    .filter((x): x is { cred: (typeof usable)[number]; addr: NonNullable<typeof x.addr> } => x.addr !== undefined);

  const pick = requested
    ? candidates.find((x) => x.addr.channel === requested.channel && x.addr.value.toLowerCase() === requested.value.toLowerCase())
    : candidates.find((x) => d.toPartyIds.every((pid) => ctx.dir.addressesOfParty(pid, x.addr.channel, ctx.now).length > 0));
  if (!pick) {
    throw new DomainError(
      requested ? 'forbidden' : 'invalid',
      requested ? `from address ${requested.value} is not usable by this viewer` : 'no usable sender address',
    );
  }
  return { from: { channel: pick.addr.channel, value: pick.addr.value }, principal: pick.cred.principal };
}

/** 送信完了の記録。返事の派生なら元の派生を replied にする */
export function recordSent(p: Projections, derivationId: string, sentRef: string): DraftEvent[] {
  const d = p.derivations[derivationId];
  if (!d) throw new DomainError('not_found', `derivation ${derivationId} not found`);
  if (d.status !== 'approved' || d.mode !== 'external') {
    throw new DomainError('conflict', `derivation ${derivationId} cannot be sent from ${d.status}`);
  }
  const events = repliedFirst(d);
  events.push(draft('DerivationSent', { derivationId, sentRef }));
  return events;
}

function repliedFirst(d: Derivation): DraftEvent[] {
  return d.replyToDerivationId
    ? [draft('DerivationReplied', { derivationId: d.replyToDerivationId, replyDerivationId: d.id })]
    : [];
}

export function rejectDerivation(
  p: Projections,
  viewer: Viewer,
  input: { derivationId: string; reason: string },
): DraftEvent[] {
  const d = proposalOrThrow(p, viewer, input.derivationId);
  return [draft('DerivationRejected', { derivationId: d.id, actorUserId: viewer.userId, reason: input.reason })];
}

// ---- 期限の見回り ----

/**
 * 返事期待の期限を過ぎた未返事の派生に ReplyOverdue を出す。
 * 状態が overdue に変わるので、何度呼んでも同じ派生には 1 回しか出ない（冪等）。
 */
export function scanOverdue(p: Projections, now: string): DraftEvent[] {
  return Object.values(p.derivations)
    .filter(
      (d) =>
        (d.status === 'sent' || (d.status === 'approved' && d.mode === 'internal' && d.deliveredAt !== null)) &&
        d.replyExpected !== null &&
        d.replyExpected.by <= now,
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((d) => draft('ReplyOverdue', { derivationId: d.id }));
}

// ---- Ingest の訂正 ----

export type CorrectionDecision =
  | { kind: 'attach'; taskId: string }
  | { kind: 'new'; listId: string; title: string }
  | { kind: 'ignore' };

export function correctIngest(
  p: Projections,
  viewer: Viewer,
  ctx: CoreContext,
  input: { signalId: string; decision: CorrectionDecision; reason: string },
): DraftEvent[] {
  const sig = p.signals[input.signalId];
  const m = membership(viewer, p.tenantId);
  if (!sig || !m) throw new DomainError('not_found', `signal ${input.signalId} not found`);
  const allowed = ctx.dir.allowedListIds(p.tenantId, sig.acquiredAs, sig.channel);
  const current = sig.taskId ? p.tasks[sig.taskId] : undefined;
  const canSee = current
    ? m.listIds.includes(current.listId)
    : allowed.some((id) => m.listIds.includes(id));
  if (!canSee) throw new DomainError('not_found', `signal ${input.signalId} not found`);

  const placeable = (listId: string) => allowed.includes(listId) && m.listIds.includes(listId);
  const d = input.decision;
  let decision;
  if (d.kind === 'attach') {
    const task = p.tasks[d.taskId];
    if (!task || !placeable(task.listId)) throw new DomainError('invalid', `cannot attach to task ${d.taskId}`);
    decision = { kind: 'attach' as const, taskId: task.id };
  } else if (d.kind === 'new') {
    if (!placeable(d.listId)) throw new DomainError('invalid', `cannot place signal on list ${d.listId}`);
    decision = { kind: 'new' as const, listId: d.listId, title: d.title, taskId: ctx.newId('task') };
  } else {
    decision = { kind: 'ignore' as const };
  }
  return [
    draft('IngestDecided', {
      signalId: sig.signalId,
      decision,
      reason: input.reason,
      decidedBy: 'human',
      confidence: 1,
      actorUserId: viewer.userId,
    }),
  ];
}
