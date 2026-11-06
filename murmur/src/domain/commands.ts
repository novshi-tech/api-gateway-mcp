import type { CoreContext } from './context';
import type { Directory } from './directory';
import type { AttributeDef, DataSource } from './entities';
import { DomainError } from './errors';
import { AttributeValue, draft, type AddressRef, type Author, type DraftEvent, type ThreadChoice } from './events';
import type { Projections, SignalRecord, Thread } from './projections';
import { addressKey, comparePos, isPending, sameAddress } from './comm';
import { isListAddress, isStatefulSource, linkCandidates, listKindOf, readerOfAddress } from './turn';
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
 * シグナルを別のスレッド（同じデータソースの既存のスレッドか、新しいスレッド）へ移す。元の判断は消さない（追記）。
 * 「返事や対応を求めているか」は 0038 でやめた（名指しは宛先で決まる）
 */
export function moveSignal(
  p: Projections,
  viewer: Viewer,
  ctx: CoreContext,
  input: { signalId: string; to: MoveTarget; reason: string },
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
  if (choice.kind === 'existing' && choice.threadId === sig.threadId) {
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
        actorUserId: viewer.userId,
      }),
    ],
  };
}

// ---- 個人のメモ（0014 の 2） ----

/** Viewer の個人のメモのデータソース */
export function notesDataSourceOf(dir: Directory, viewer: Viewer): Extract<DataSource, { kind: 'notes' }> | undefined {
  return dir.seed.dataSources.find(
    (d): d is Extract<DataSource, { kind: 'notes' }> =>
      d.kind === 'notes' && d.ownerUserId === viewer.userId && viewer.dataSourceIds.includes(d.id),
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
  input: { threadId?: string; title?: string; body: string; author?: Author },
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
  const self = { channel: 'note' as const, value: ds.ownerUserId };
  return {
    threadId: choice.threadId,
    signalId,
    events: [
      draft('SignalObserved', {
        signalId,
        dataSourceId: ds.id,
        channel: 'note',
        from: self,
        to: [],
        body: input.body,
        sourceRef: `note:${signalId}`,
        author: input.author ?? { kind: 'user' },
      }),
      draft('SignalThreaded', {
        signalId,
        thread: choice,
        by: 'self',
        confidence: 1,
        reason: choice.kind === 'new' ? '本人が新しい件として書いた' : '本人が置き先を指定した',
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
 * 担当する・手放す（userId: null）・引き継ぐ（0038 の決定 1）。担当できるのはそのデータソースの読者だけ。
 * 状態を持つソース（Jira・PR）の担当はソースの担当者なので断る（担当はソースで移す）。
 * 個人リスト（個人のメモ・個人の箱）は本人が暗黙の担当なので断る
 */
export function claimThread(
  p: Projections,
  viewer: Viewer,
  dir: Directory,
  input: { threadId: string; userId: string | null; reason?: string },
): DraftEvent[] {
  const t = visibleThreadOrThrow(p, viewer, input.threadId);
  const ds = dir.dataSource(t.dataSourceId);
  if (ds?.kind === 'notes') throw new DomainError('invalid', 'a notes thread has no assignee');
  if (isStatefulSource(ds)) throw new DomainError('invalid', `the assignee of thread ${t.id} is mirrored from ${ds?.name ?? t.dataSourceId}; change it at the source`);
  if (listKindOf(dir, t.dataSourceId) === 'personal') throw new DomainError('invalid', `thread ${t.id} is in a personal list; its reader is the assignee`);
  if (input.userId !== null) {
    const list = dir.listOfDataSource(t.dataSourceId);
    const readers = list ? dir.readersOfList(list.id) : [];
    if (!readers.includes(input.userId)) {
      throw new DomainError('invalid', `user ${input.userId} is not a reader of data source ${t.dataSourceId}`);
    }
  }
  if (t.ownerUserId === input.userId) return [];
  return [draft('ThreadClaimed', { threadId: t.id, userId: input.userId, actorUserId: viewer.userId, reason: input.reason })];
}

// ---- 名指しを外す（AttentionAcknowledged。0038 の決定 3・4） ----

/**
 * 名指しを外す。untilSignalId（省けばスレッドの最新のシグナル）までの名指しを外す。
 * - addresses を省けば、自分への名指し（自分のアドレスと、リスト宛て）を外す
 * - addresses を渡せば、そのアドレスの名指しを外す。自分のアドレスか、このリストの読者でないアドレスだけ。
 *   リスト宛てのアドレス（窓口）は、自分についてのリスト宛てとして外す
 * 外すものがなければ何もしない
 */
export function acknowledgeAttention(
  p: Projections,
  viewer: Viewer,
  dir: Directory,
  input: { threadId: string; untilSignalId?: string; addresses?: AddressRef[]; reason?: string },
): DraftEvent[] {
  const t = visibleThreadOrThrow(p, viewer, input.threadId);
  const ds = dir.dataSource(t.dataSourceId);
  const signals = t.log.filter((l) => l.kind === 'signal');
  const until = input.untilSignalId ? signals.find((l) => l.signalId === input.untilSignalId) : signals[signals.length - 1];
  if (input.untilSignalId && !until) throw new DomainError('invalid', `signal ${input.untilSignalId} is not in thread ${t.id}`);
  if (!until) return [];
  const upTo = (pos: { at: string; seq: number }) => comparePos(pos, until) <= 0;

  const addresses: AddressRef[] = [];
  let list = false;
  const pendingNamed = t.attention.named.filter((n) => isPending(n) && upTo(n.last));
  if (input.addresses === undefined) {
    for (const n of pendingNamed) {
      if (isListAddress(ds, n.address)) list = true;
      else if (readerOfAddress(dir, t.dataSourceId, n.address, n.last.at) === viewer.userId) addresses.push(n.address);
    }
    if (ds?.kind === 'service' && ds.group && t.attention.broadcasts.some((b) => upTo(b))) list = true;
  } else {
    for (const r of input.addresses) {
      if (isListAddress(ds, r)) {
        list = true;
        continue;
      }
      const n = t.attention.named.find((x) => addressKey(x.address) === addressKey(r));
      if (!n) throw new DomainError('invalid', `${r.channel}:${r.value} is not named in thread ${t.id}`);
      const owner = readerOfAddress(dir, t.dataSourceId, r, n.last.at);
      if (owner !== null && owner !== viewer.userId) {
        throw new DomainError('forbidden', `${r.channel}:${r.value} belongs to reader ${owner}; only that reader can acknowledge it`);
      }
      if (isPending(n) && upTo(n.last) && !addresses.some((a) => sameAddress(a, r))) addresses.push(n.address);
    }
  }
  if (list) {
    const acked = t.attention.listAcks[viewer.userId];
    if (acked && comparePos(acked, until) >= 0) list = false;
  }
  if (addresses.length === 0 && !list) return [];
  return [
    draft('AttentionAcknowledged', {
      threadId: t.id,
      untilSignalId: until.signalId!,
      addresses,
      list,
      actorUserId: viewer.userId,
      reason: input.reason,
    }),
  ];
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

/** リンクを外す。両端とも読める必要がある（見えない辺は結んでいないのと同じ扱い。0033 の 3） */
export function unlinkThreads(
  p: Projections,
  viewer: Viewer,
  input: { threadId: string; otherThreadId: string; reason?: string },
): DraftEvent[] {
  const a = visibleThreadOrThrow(p, viewer, input.threadId);
  const link = a.links.find((l) => l.threadId === input.otherThreadId);
  const other = link ? p.threads[link.threadId] : undefined;
  if (!link || !other || !canReadDataSource(viewer, other.dataSourceId)) return [];
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
    case 'contact': {
      if (typeof v !== 'string' || !dir.contact(v)) throw bad('unknown contact');
      return v;
    }
  }
}
