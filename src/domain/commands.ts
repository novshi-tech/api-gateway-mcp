import type { CoreContext } from './context';
import { DomainError } from './errors';
import { draft, type DraftEvent, type ThreadChoice } from './events';
import type { Projections, SignalRecord, Thread } from './projections';
import { canReadDataSource, type Viewer } from './viewer';

// スタンド（＝ユーザー）が呼ぶ操作の判断部分。状態とコマンドを受けてイベントを返すだけの純関数。
// 操作できるのは、スレッドが見えている人（そのデータソースの読者）。

export function visibleThreadOrThrow(p: Projections, viewer: Viewer, threadId: string): Thread {
  const t = p.threads[threadId];
  if (!t || !canReadDataSource(viewer, p.tenantId, t.dataSourceId)) {
    throw new DomainError('not_found', `thread ${threadId} not found`);
  }
  return t;
}

export function visibleSignalOrThrow(p: Projections, viewer: Viewer, signalId: string): SignalRecord {
  const s = p.signals[signalId];
  if (!s || !canReadDataSource(viewer, p.tenantId, s.dataSourceId)) {
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
