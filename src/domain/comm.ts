import type { CommState, ThreadLogEntry } from './projections';

/**
 * 通信状態の導出。スレッドに綴じたもの（シグナルの向き・「返事や対応を求めているか」・持ち主・片付け）だけを
 * 時刻順に畳み込む。本文や属性・リンク・メモは読まない。
 *
 * ボールの所在:
 * - 送った（観測された送信） → 宛先の Party
 * - 返事や対応を求める受信 → こちら。持ち主がいればその人
 * - 求めていない受信（お礼・スタンプ・了解・通知） → 相手を待っていたなら「なし」、そうでなければ変わらない
 * - 持った・引き継いだ → その人。手放した → こちら（組織）
 * - 片付けた → 開き直すまで「なし」。その間もシグナルは綴じ、開き直したら綴じた分から決まる
 *
 * 返事期待: 記録した送信の期限が最後の送信の返事期待になり、受信が来れば消える（遅れて返事が来れば期限超過も解消する）。
 * 期限超過は ReplyOverdue がその送信を指しているときだけ
 */
export function deriveComm(entries: readonly ThreadLogEntry[]): CommState {
  let ball: CommState['ball'] = { kind: 'none' };
  const state: CommState = {
    ball,
    lastInboundAt: null,
    lastOutboundAt: null,
    unansweredSince: null,
    dismissed: false,
    dismissedAt: null,
    dismissReason: null,
    activeSinceDismissed: false,
    ownerUserId: null,
    replyExpectedBy: null,
    replyExpectedSignalId: null,
    overdue: false,
  };
  const ours = (): CommState['ball'] => (state.ownerUserId ? { kind: 'user', userId: state.ownerUserId } : { kind: 'us' });
  for (const e of sortLog(entries)) {
    switch (e.kind) {
      case 'signal':
        if (e.direction === 'outbound') {
          ball = { kind: 'party', partyIds: e.toPartyIds ?? [] };
          state.lastOutboundAt = e.at;
          state.unansweredSince = null;
          state.replyExpectedBy = e.replyExpectedBy ?? null;
          state.replyExpectedSignalId = state.replyExpectedBy ? (e.signalId ?? null) : null;
          state.overdue = false;
        } else {
          state.lastInboundAt = e.at;
          state.replyExpectedBy = null;
          state.replyExpectedSignalId = null;
          state.overdue = false;
          if (e.needsResponse === false) {
            if (ball.kind === 'party') ball = { kind: 'none' };
          } else {
            ball = ours();
            state.unansweredSince ??= e.at;
          }
        }
        if (state.dismissed) state.activeSinceDismissed = true;
        break;
      case 'claimed':
        state.ownerUserId = e.userId ?? null;
        ball = ours();
        break;
      case 'dismissed':
        state.dismissed = true;
        state.dismissedAt = e.at;
        state.dismissReason = e.reason ?? null;
        state.activeSinceDismissed = false;
        break;
      case 'reopened':
        state.dismissed = false;
        state.dismissedAt = null;
        state.dismissReason = null;
        state.activeSinceDismissed = false;
        break;
      case 'overdue':
        if (e.signalId !== undefined && e.signalId === state.replyExpectedSignalId) state.overdue = true;
        break;
      case 'note':
      case 'linked':
      case 'unlinked':
      case 'attribute':
        break;
    }
  }
  state.ball = state.dismissed ? { kind: 'none' } : ball;
  if (state.dismissed) state.overdue = false;
  return state;
}

export function sortLog<T extends Pick<ThreadLogEntry, 'at' | 'seq'>>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq));
}
