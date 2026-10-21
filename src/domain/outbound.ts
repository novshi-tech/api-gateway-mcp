import { visibleThreadOrThrow } from './commands';
import type { CoreContext } from './context';
import { DomainError } from './errors';
import { draft, type AddressRef, type Anchors, type DraftEvent, type ThreadChoice, type ThreadedBy } from './events';
import { defaultTitle, resolveAnchors, type SignalPayload } from './ingest';
import { indexKey, type Projections } from './projections';
import { canReadDataSource, type Viewer } from './viewer';

// 送信の記録（0012）と期限の見回り。本体は外に何も書かない。送信・起票・コメントはスタンドがゲートウェイ経由で行い、
// 送った直後に record_sent で事実だけを記録する。

export interface RecordSentInput {
  dataSourceId: string;
  /** 宛先のアドレス（チャネルはデータソースのもの） */
  to: string[];
  /** 宛先の Party（そのチャネルの有効なアドレスに直す） */
  toPartyIds: string[];
  subject?: string;
  body: string;
  /** メールの Message-ID・Slack の ts・LINE の sentMessages[].id・Jira の課題キーやコメント ID */
  sentRef: string;
  /** 送ったメッセージの構造アンカー（In-Reply-To・thread_ts・課題キーなど） */
  anchors?: Omit<Anchors, 'messageId'>;
  /** 返事をしているスレッド（同じデータソース）。送ったシグナルはそこに入る */
  replyToThreadId?: string;
  /** 送る元になったスレッド（どのデータソースでもよい）。送ったスレッドと経路 sent で結ぶ */
  sourceThreadId?: string;
  /** UTC の ISO 8601（シェルがそろえる） */
  replyExpectedBy?: string;
}

/**
 * record_sent の判断。
 * - 送ったシグナルの置き先: reply_to のスレッド → アンカー（同じデータソースの中）→ 新しいスレッド
 * - 同じ sent_ref の観測された送信が先に届いていれば、そのシグナルに記録を重ねる（H5。reply_to が違えば移す）
 * - 同じ sent_ref の記録が既にあれば何もしない（冪等）
 * - source のスレッドがあれば経路 sent で結ぶ（Murmur が張るリンクの唯一の例外。スタンドの操作の一部）
 */
export function recordSent(
  p: Projections,
  viewer: Viewer,
  ctx: CoreContext,
  input: RecordSentInput,
): { events: DraftEvent[]; threadId: string; signalId: string } {
  const ds = ctx.dir.dataSource(input.dataSourceId);
  if (!ds || ds.tenantId !== p.tenantId || !canReadDataSource(viewer, p.tenantId, ds.id)) {
    throw new DomainError('not_found', `data source ${input.dataSourceId} not found`);
  }
  if (ds.kind !== 'service') throw new DomainError('invalid', 'record_sent is for a service data source (use add_note for notes)');
  if (!input.body.trim()) throw new DomainError('invalid', 'body is required');
  if (!input.sentRef.trim()) throw new DomainError('invalid', 'sent_ref is required');

  const to: AddressRef[] = input.to.map((value) => ({ channel: ds.channel, value }));
  for (const partyId of input.toPartyIds) {
    const party = ctx.dir.party(partyId);
    const address = party?.tenantId === p.tenantId ? ctx.dir.addressesOfParty(partyId, ds.channel, ctx.now)[0] : undefined;
    if (!address) throw new DomainError('invalid', `party ${partyId} has no ${ds.channel} address`);
    if (!to.some((a) => a.value === address.value)) to.push({ channel: ds.channel, value: address.value });
  }
  if (to.length === 0) throw new DomainError('invalid', 'to or to_party_ids is required');
  const toPartyIds = [...new Set(to.map((a) => ctx.dir.partyIdOfAddress(p.tenantId, a, ctx.now)).filter((x): x is string => x !== null))];
  const fromAddress = ctx.dir.address(ds.selfAddressIds[0]!)!;
  const from: AddressRef = { channel: ds.channel, value: fromAddress.value };

  const replyTo = input.replyToThreadId !== undefined ? visibleThreadOrThrow(p, viewer, input.replyToThreadId) : undefined;
  if (replyTo && replyTo.dataSourceId !== ds.id) throw new DomainError('invalid', `reply_to thread ${replyTo.id} is in another data source`);
  const source = input.sourceThreadId !== undefined ? visibleThreadOrThrow(p, viewer, input.sourceThreadId) : undefined;

  const existing = p.signals[p.index.messageIds[indexKey(ds.id, input.sentRef)] ?? ''];
  if (existing?.recorded) return { events: [], threadId: existing.threadId!, signalId: existing.signalId };
  if (existing && existing.direction !== 'outbound') {
    throw new DomainError('conflict', `sent_ref ${input.sentRef} is already a received message`);
  }

  const events: DraftEvent[] = [];
  const signalId = existing?.signalId ?? ctx.newId('sig');
  const anchors = { ...(input.anchors ?? {}) };
  events.push(
    draft('OutboundRecorded', {
      signalId,
      merged: existing !== undefined,
      dataSourceId: ds.id,
      channel: ds.channel,
      from,
      to,
      fromPartyId: fromAddress.partyId,
      toPartyIds,
      subject: input.subject,
      body: input.body,
      anchors,
      sentRef: input.sentRef,
      sourceThreadId: source?.id ?? null,
      replyExpectedBy: input.replyExpectedBy ?? null,
      actorUserId: viewer.userId,
    }),
  );

  let threadId: string;
  if (existing) {
    // 観測が先に届いていた。置き先は Ingest の判断のまま、reply_to が違えば本人の指定に移す
    threadId = existing.threadId!;
    if (replyTo && replyTo.id !== threadId) {
      events.push(threaded(signalId, { kind: 'existing', threadId: replyTo.id }, 'self', '送った本人が返事をしているスレッド'));
      threadId = replyTo.id;
    }
  } else {
    let choice: ThreadChoice;
    let by: ThreadedBy;
    let reason: string;
    const sig = { signalId, dataSourceId: ds.id, anchors: { ...anchors, messageId: input.sentRef } } as SignalPayload;
    const anchored = replyTo ? null : resolveAnchors(p, sig);
    if (replyTo) {
      choice = { kind: 'existing', threadId: replyTo.id };
      by = 'self';
      reason = '送った本人が返事をしているスレッド';
    } else if (anchored?.kind === 'existing') {
      choice = { kind: 'existing', threadId: anchored.threadId };
      by = 'anchor';
      reason = anchored.reason;
    } else {
      choice = { kind: 'new', threadId: ctx.newId('thr'), title: defaultTitle(input) };
      by = anchored ? 'anchor' : 'self';
      reason = anchored?.kind === 'new' ? anchored.reason : '送った本人の新しい送信';
    }
    events.push(threaded(signalId, choice, by, reason));
    threadId = choice.threadId;
  }

  if (source && source.id !== threadId && !source.links.some((l) => l.threadId === threadId)) {
    events.push(
      draft('ThreadLinked', { a: source.id, b: threadId, op: 'link', route: 'sent', actorUserId: viewer.userId, reason: `送信 ${input.sentRef}` }),
    );
  }
  return { events, threadId, signalId };

  function threaded(id: string, choice: ThreadChoice, by: ThreadedBy, reason: string): DraftEvent {
    return draft('SignalThreaded', { signalId: id, thread: choice, by, confidence: 1, reason, needsResponse: null, actorUserId: viewer.userId });
  }
}

/** 期限の見回り（Cron）。返事期待の期限を過ぎ、まだ超過になっていないスレッドに ReplyOverdue を出す。冪等 */
export function planOverdue(p: Projections, now: string): DraftEvent[] {
  return Object.values(p.threads)
    .filter((t) => !t.dismissed && !t.overdue && t.replyExpectedBy !== null && t.replyExpectedSignalId !== null && t.replyExpectedBy < now)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((t) => draft('ReplyOverdue', { threadId: t.id, signalId: t.replyExpectedSignalId!, replyExpectedBy: t.replyExpectedBy! }));
}
