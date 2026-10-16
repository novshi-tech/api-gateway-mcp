import type { CommState, TimelineEntry } from './projections';

/**
 * 通信状態の導出。タスクのタイムラインのうち事前定義の項目（受信・送信・派生・返事・期限超過）
 * だけを時刻順に畳み込む。カスタム属性（作業状態）は一切読まない。
 *
 * ボールの所在:
 * - 受信、または内部派生の適用を受けた → 自リスト
 * - 外部へ送った（観測された送信・外部派生の送信） → 宛先 Party
 * - 派生を出した → 派生先リスト
 * - 出した派生に返事が来た → 自リスト
 */
export function deriveComm(listId: string, entries: readonly TimelineEntry[]): CommState {
  const state: CommState = {
    ballAt: { kind: 'list', listId },
    lastInboundAt: null,
    lastOutboundAt: null,
    replyExpectedBy: null,
    unansweredSince: null,
    overdue: false,
  };
  for (const e of sortTimeline(entries)) {
    switch (e.kind) {
      case 'inbound':
      case 'derivation_in':
        if (e.kind === 'derivation_in' && e.toPartyIds && e.toPartyIds.length > 0) {
          // 外部派生の適用先タスク: こちらから外部へ送った扱い
          markOutbound(state, e, { kind: 'party', partyIds: e.toPartyIds });
        } else {
          state.ballAt = { kind: 'list', listId };
          state.lastInboundAt = e.at;
          state.unansweredSince ??= e.at;
          state.replyExpectedBy = null;
          state.overdue = false;
        }
        break;
      case 'outbound':
        markOutbound(state, e, { kind: 'party', partyIds: e.toPartyIds ?? [] });
        break;
      case 'derivation_out':
        markOutbound(state, e, { kind: 'list', listId: e.targetListId ?? listId });
        break;
      case 'derivation_replied':
        state.ballAt = { kind: 'list', listId };
        state.lastInboundAt = e.at;
        state.unansweredSince ??= e.at;
        state.replyExpectedBy = null;
        state.overdue = false;
        break;
      case 'reply_overdue':
        state.overdue = true;
        break;
      default:
        // attribute_set / closed / reopened は通信状態に影響しない
        break;
    }
  }
  return state;
}

function markOutbound(state: CommState, e: TimelineEntry, ballAt: CommState['ballAt']): void {
  state.ballAt = ballAt;
  state.lastOutboundAt = e.at;
  state.unansweredSince = null;
  state.replyExpectedBy = e.replyExpectedBy ?? null;
  state.overdue = false;
}

export function sortTimeline<T extends Pick<TimelineEntry, 'at' | 'seq'>>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq));
}
