import { z } from 'zod';
import type { CoreContext } from './context';
import type { Principal } from './entities';
import { draft, type AddressRef, type Anchors, type DraftEvent, type FileRef, type IngestDecision, type PayloadOf } from './events';
import type { Projections, SignalRecord, Task } from './projections';
import type { Channel } from './entities';

// Ingest の判断部分（純関数）。AI の呼び出しそのものはシェル（src/ingest/）が行う。
//
//   prepareInbound → (観測された送信なら返事期待の推定: シェル) → planDecision
//     → アンカーで決まれば終わり / 決まらなければ DecisionRequest をシェルの Decider へ
//     → finalizeDecision

/** コネクタが正規化した 1 件のメッセージ */
export interface InboundSignal {
  channel: Channel;
  from: AddressRef;
  to: AddressRef[];
  subject?: string;
  body: string;
  anchors?: Anchors;
  attachments?: FileRef[];
  sourceRef: string;
  acquiredAs: Principal;
  /** 観測時刻（コネクタが知っていれば）。シェルの時計より優先しない。参考値 */
  occurredAt?: string;
}

export type SignalPayload = PayloadOf<'SignalReceived'>;

export type Prepared =
  | { kind: 'duplicate'; signalId: string }
  | { kind: 'merged'; derivationId: string }
  | { kind: 'signal'; direction: 'in' | 'out'; payload: SignalPayload };

/**
 * 重複排除と受信／観測された送信の振り分け。
 * - source_ref が既出なら弾く
 * - 自分側のアドレスからの送信で、Message-ID が DerivationSent の sent_ref と一致すれば
 *   ツール経由の送信と同一として統合し、新しいイベントを出さない（H5）
 */
export function prepareInbound(p: Projections, ctx: CoreContext, inbound: InboundSignal): Prepared {
  const existing = p.index.sourceRefs[inbound.sourceRef];
  if (existing) return { kind: 'duplicate', signalId: existing };

  const anchors = inbound.anchors ?? {};
  const direction = ctx.dir.isInternalAddress(p.tenantId, inbound.from, ctx.now) ? 'out' : 'in';
  if (direction === 'out' && anchors.messageId) {
    const derivationId = p.index.sentRefs[anchors.messageId];
    if (derivationId) return { kind: 'merged', derivationId };
  }
  const payload: SignalPayload = {
    signalId: ctx.newId('sig'),
    channel: inbound.channel,
    from: inbound.from,
    to: inbound.to,
    fromPartyId: ctx.dir.partyIdOfAddress(p.tenantId, inbound.from, ctx.now),
    toPartyIds: inbound.to
      .map((a) => ctx.dir.partyIdOfAddress(p.tenantId, a, ctx.now))
      .filter((x): x is string => x !== null),
    subject: inbound.subject,
    body: inbound.body,
    anchors,
    attachments: inbound.attachments ?? [],
    sourceRef: inbound.sourceRef,
    acquiredAs: inbound.acquiredAs,
  };
  return { kind: 'signal', direction, payload };
}

export function signalEvent(
  direction: 'in' | 'out',
  payload: SignalPayload,
  estimate?: { replyExpectedBy: string | null; by: 'ai' | 'human' | 'none' },
): DraftEvent {
  if (direction === 'in') return draft('SignalReceived', payload);
  return draft('SignalObservedSent', {
    ...payload,
    replyExpectedBy: estimate?.replyExpectedBy ?? null,
    replyEstimatedBy: estimate?.by ?? 'none',
  });
}

// ---- アンカー解決 ----

export interface AnchorMatch {
  taskId: string;
  reason: string;
  /** In-Reply-To が派生の sent_ref に一致した場合、その派生 */
  derivationId?: string;
}

/**
 * 構造アンカーで既存タスクに決まるか。決まれば AI は呼ばない。
 * 取得主体ルールで置けないリストのタスクには付けない。
 */
export function resolveAnchors(p: Projections, payload: SignalPayload, allowedListIds: readonly string[]): AnchorMatch | null {
  const a = payload.anchors;
  const placeable = (taskId: string | null | undefined): taskId is string => {
    const t = taskId ? p.tasks[taskId] : undefined;
    return t !== undefined && allowedListIds.includes(t.listId);
  };
  const decided = Object.values(p.signals).filter((s) => s.taskId !== null && s.signalId !== payload.signalId);
  const latest = (xs: SignalRecord[]) => xs.sort((x, y) => y.seq - x.seq)[0];

  if (a.inReplyTo) {
    const derivationId = p.index.sentRefs[a.inReplyTo];
    const d = derivationId ? p.derivations[derivationId] : undefined;
    if (d && placeable(d.targetTaskId)) {
      return { taskId: d.targetTaskId, derivationId: d.id, reason: `In-Reply-To ${a.inReplyTo} は派生 ${d.id} の送信` };
    }
    const sid = p.index.messageIds[a.inReplyTo];
    const s = sid ? p.signals[sid] : undefined;
    if (s && placeable(s.taskId)) return { taskId: s.taskId, reason: `In-Reply-To ${a.inReplyTo}` };
  }
  if (a.threadTs) {
    const s = latest(
      decided.filter((x) => x.channel === payload.channel && (x.anchors.messageId === a.threadTs || x.anchors.threadTs === a.threadTs)),
    );
    if (s && placeable(s.taskId)) return { taskId: s.taskId, reason: `同じスレッド thread_ts=${a.threadTs}` };
  }
  for (const key of a.jiraKeys ?? []) {
    const s = latest(decided.filter((x) => x.anchors.jiraKeys?.includes(key) && placeable(x.taskId)));
    if (s?.taskId) return { taskId: s.taskId, reason: `Jira キー ${key}` };
  }
  for (const ref of a.prRefs ?? []) {
    const s = latest(decided.filter((x) => x.anchors.prRefs?.includes(ref) && placeable(x.taskId)));
    if (s?.taskId) return { taskId: s.taskId, reason: `PR ${ref}` };
  }
  return null;
}

// ---- AI 判断の入出力 ----

export interface Candidate {
  taskId: string;
  listId: string;
  title: string;
  status: 'open' | 'closed';
  updatedAt: string;
  recent: { at: string; direction: 'in' | 'out'; from: string; excerpt: string }[];
}

export interface DecisionRequest {
  tenantId: string;
  signal: SignalPayload;
  direction: 'in' | 'out';
  allowedLists: { id: string; name: string; description: string }[];
  candidates: Candidate[];
}

export const CANDIDATE_LIMIT = 20;

/** 候補タスク: 取得主体ルールで置けるリストの、open で最近のもの */
export function candidateTasks(p: Projections, allowedListIds: readonly string[], limit = CANDIDATE_LIMIT): Candidate[] {
  return Object.values(p.tasks)
    .filter((t) => t.status === 'open' && allowedListIds.includes(t.listId))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1))
    .slice(0, limit)
    .map((t) => toCandidate(p, t));
}

function toCandidate(p: Projections, t: Task): Candidate {
  const recent = Object.values(p.signals)
    .filter((s) => s.taskId === t.id)
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 3)
    .map((s) => ({ at: s.at, direction: s.direction, from: s.from.value, excerpt: s.body.slice(0, 160) }));
  return { taskId: t.id, listId: t.listId, title: t.title, status: t.status, updatedAt: t.updatedAt, recent };
}

export type Plan =
  | { kind: 'decided'; events: DraftEvent[]; taskId: string | null }
  | { kind: 'needs_decision'; request: DecisionRequest };

/** アンカーで決まればイベントまで作る。決まらなければ AI 判断の依頼を返す */
export function planDecision(p: Projections, ctx: CoreContext, direction: 'in' | 'out', signal: SignalPayload): Plan {
  const allowed = ctx.dir.allowedListIds(p.tenantId, signal.acquiredAs, signal.channel);
  if (allowed.length === 0) {
    return {
      kind: 'decided',
      taskId: null,
      events: [
        draft('IngestDecided', {
          signalId: signal.signalId,
          decision: { kind: 'ignore' },
          reason: '取得主体ルールで置けるリストがない',
          decidedBy: 'anchor',
          confidence: 1,
        }),
      ],
    };
  }
  const match = resolveAnchors(p, signal, allowed);
  if (match) {
    return {
      kind: 'decided',
      taskId: match.taskId,
      events: [
        draft('IngestDecided', {
          signalId: signal.signalId,
          decision: { kind: 'attach', taskId: match.taskId },
          reason: match.reason,
          decidedBy: 'anchor',
          confidence: 1,
        }),
        ...replyEvents(p, direction, signal, match.taskId, match.derivationId),
      ],
    };
  }
  return {
    kind: 'needs_decision',
    request: {
      tenantId: p.tenantId,
      signal,
      direction,
      allowedLists: allowed.map((id) => {
        const l = ctx.dir.list(id);
        return { id, name: l?.name ?? id, description: l?.description ?? '' };
      }),
      candidates: candidateTasks(p, allowed),
    },
  };
}

/** Claude の構造化出力のスキーマ */
export const AiDecision = z.object({
  decision: z.enum(['attach', 'new', 'ignore']),
  task_id: z.string().nullable(),
  list_id: z.string().nullable(),
  title: z.string().nullable(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});
export type AiDecision = z.infer<typeof AiDecision>;

export interface DecisionPolicy {
  /** この confidence 以上なら AI の ignore を自動で採用する（2026-10-16 決定） */
  ignoreThreshold: number;
}

/**
 * Decider の出力を検証して IngestDecided にする。
 * - 候補にないタスクへの attach、置けないリストへの new は採用しない（new に倒す）
 * - 閾値未満の ignore は拾いすぎに倒して new にする
 */
export function finalizeDecision(
  p: Projections,
  ctx: CoreContext,
  request: DecisionRequest,
  raw: AiDecision,
  decidedBy: 'ai' | 'human',
  policy: DecisionPolicy,
): { events: DraftEvent[]; taskId: string | null } {
  const allowedIds = request.allowedLists.map((l) => l.id);
  const fallbackList = raw.list_id && allowedIds.includes(raw.list_id) ? raw.list_id : allowedIds[0]!;
  const title = raw.title?.trim() || request.signal.subject || request.signal.body.slice(0, 40);
  const asNew = (): IngestDecision => ({ kind: 'new', taskId: ctx.newId('task'), listId: fallbackList, title });

  let decision: IngestDecision;
  let reason = raw.reason;
  if (raw.decision === 'attach') {
    const ok = raw.task_id && request.candidates.some((c) => c.taskId === raw.task_id) && p.tasks[raw.task_id];
    if (ok) decision = { kind: 'attach', taskId: raw.task_id! };
    else {
      decision = asNew();
      reason = `[attach 先 ${raw.task_id ?? '(なし)'} が候補外のため new] ${raw.reason}`;
    }
  } else if (raw.decision === 'ignore') {
    if (raw.confidence >= policy.ignoreThreshold) decision = { kind: 'ignore' };
    else {
      decision = asNew();
      reason = `[ignore の confidence ${raw.confidence} が閾値 ${policy.ignoreThreshold} 未満のため new] ${raw.reason}`;
    }
  } else {
    decision = asNew();
  }

  const taskId = decision.kind === 'ignore' ? null : decision.taskId;
  const events: DraftEvent[] = [
    draft('IngestDecided', {
      signalId: request.signal.signalId,
      decision,
      reason: reason.trim() || '(理由なし)',
      decidedBy,
      confidence: raw.confidence,
    }),
  ];
  if (decision.kind === 'attach') events.push(...replyEvents(p, request.direction, request.signal, decision.taskId));
  return { events, taskId };
}

/**
 * 返事の紐づけ: 受信シグナルが、外部派生の適用先タスクに付き、送り主がその派生の宛先なら DerivationReplied。
 */
export function replyEvents(
  p: Projections,
  direction: 'in' | 'out',
  signal: Pick<SignalPayload, 'signalId' | 'fromPartyId'>,
  taskId: string,
  derivationId?: string,
): DraftEvent[] {
  if (direction !== 'in') return [];
  const open = ['sent', 'overdue'];
  const ds = derivationId
    ? [p.derivations[derivationId]].filter((d) => d !== undefined && open.includes(d.status))
    : Object.values(p.derivations).filter(
        (d) =>
          d.targetTaskId === taskId &&
          d.mode === 'external' &&
          open.includes(d.status) &&
          signal.fromPartyId !== null &&
          d.toPartyIds.includes(signal.fromPartyId),
      );
  return ds.map((d) => draft('DerivationReplied', { derivationId: d!.id, signalId: signal.signalId }));
}

// ---- プロンプト ----

export const INGEST_SYSTEM_PROMPT = `あなたはタスク管理ツールの Ingest 判断係です。
届いたメッセージ（シグナル）を、既存のタスクに付ける (attach)、新しいタスクを作る (new)、無視する (ignore) のどれかに振り分けます。

- attach: 候補タスクのどれかと同じ用件の続きなら、その task_id を選ぶ。
- new: 対応が必要な新しい用件なら、置くリストを list_id で選び、短いタスク名を title に書く。
- ignore: 広告・自動通知・挨拶だけ・対応不要な連絡など、誰も行動しなくてよいものだけ。

迷ったら ignore より new を選ぶ。confidence は判断の確からしさ（0〜1）。reason は後で人が監査できるよう具体的に日本語で書く。
attach 以外では task_id を null、new 以外では list_id と title を null にする。`;

export function buildDecisionPrompt(request: DecisionRequest): string {
  const s = request.signal;
  return JSON.stringify(
    {
      signal: {
        direction: request.direction === 'in' ? 'received' : 'sent_by_us',
        channel: s.channel,
        from: s.from.value,
        to: s.to.map((t) => t.value),
        subject: s.subject ?? null,
        body: s.body,
        attachments: s.attachments.map((a) => a.name ?? a.path),
      },
      lists: request.allowedLists,
      candidates: request.candidates.map((c) => ({
        task_id: c.taskId,
        list_id: c.listId,
        title: c.title,
        recent: c.recent,
      })),
    },
    null,
    2,
  );
}

/** Claude の構造化出力に渡す JSON Schema（AiDecision と同じ形） */
export const AI_DECISION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['attach', 'new', 'ignore'] },
    task_id: { type: ['string', 'null'] },
    list_id: { type: ['string', 'null'] },
    title: { type: ['string', 'null'] },
    reason: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['decision', 'task_id', 'list_id', 'title', 'reason', 'confidence'],
  additionalProperties: false,
} as const;

// ---- 観測された送信の返事期待の推定 ----

export const ReplyEstimate = z.object({
  expects_reply: z.boolean(),
  reply_expected_by: z.string().nullable(),
  reason: z.string(),
});
export type ReplyEstimate = z.infer<typeof ReplyEstimate>;

export const REPLY_ESTIMATE_SYSTEM_PROMPT = `あなたはタスク管理ツールの補助です。
自分たちが送ったメッセージについて、相手からの返事を期待しているか、期待しているならいつまでか（ISO 8601）を推定します。
本文に期限が書かれていればそれを使い、なければ用件の緊急度から妥当な期限を決めてください。返事が不要な連絡なら expects_reply を false にします。`;

export const REPLY_ESTIMATE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    expects_reply: { type: 'boolean' },
    reply_expected_by: { type: ['string', 'null'] },
    reason: { type: 'string' },
  },
  required: ['expects_reply', 'reply_expected_by', 'reason'],
  additionalProperties: false,
} as const;

export function buildReplyEstimatePrompt(signal: SignalPayload, sentAt: string): string {
  return JSON.stringify(
    { sent_at: sentAt, channel: signal.channel, to: signal.to.map((t) => t.value), subject: signal.subject ?? null, body: signal.body },
    null,
    2,
  );
}

export function normalizeEstimate(raw: ReplyEstimate, sentAt: string): string | null {
  if (!raw.expects_reply || !raw.reply_expected_by) return null;
  const t = Date.parse(raw.reply_expected_by);
  if (Number.isNaN(t)) return null;
  const iso = new Date(t).toISOString();
  return iso > sentAt ? iso : null;
}
