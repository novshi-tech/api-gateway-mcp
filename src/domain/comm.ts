import { sameValue } from './directory';
import type { AddressRef } from './events';
import type { CommState, FoldedBall, Request, ThreadLogEntry } from './projections';

/**
 * 通信状態の導出（0030）。スレッドに綴じたもの（シグナルのアドレス・「返事や対応を求めているか」・持ち主・片付け）だけを
 * 時刻順に畳み込む。マスタを読まないので、どちら側のボールかは決めない（クエリ層の sides.ts が決める）。本文や属性・リンク・メモは読まない。
 *
 * ボールの移り方（アドレスが同じかどうかだけで決まる）:
 * - 返事や対応を求めるシグナル（needsResponse が false でない。null は「求めている」） → 保持者はその宛先、求めた人は送り主。
 *   宛先がなければ（グループのチャネル）「チャネルの中で送り主以外」
 * - 求めないシグナル → 送り主が求めた人でなければ応えたとみなしてボールを空にする。求めた人（追伸・お礼）なら変えない
 * - 持った・引き継いだ → その人。手放した → こちら
 * - 片付けた → 開き直すまで「なし」。その間もシグナルは綴じ、開き直したら綴じた分から決まる
 * - ソースの側で完了した（写しの done） → 片付けと同じく「なし」。完了が外れたら綴じた分から決まる
 *
 * 返事期待: 記録した送信の期限が返事期待になり、その送り主以外からシグナルが来れば消える（遅れて返事が来れば期限超過も解消する）。
 * 期限超過は ReplyOverdue がその送信を指しているときだけ
 */
export function deriveComm(entries: readonly ThreadLogEntry[]): CommState {
  let ball: FoldedBall = { kind: 'none' };
  const state: CommState = {
    ball,
    request: null,
    dismissed: false,
    dismissedAt: null,
    dismissReason: null,
    activeSinceDismissed: false,
    ownerUserId: null,
    replyExpectedBy: null,
    replyExpectedSignalId: null,
    replyExpectedFrom: null,
    overdue: false,
    closedAtSource: false,
  };
  for (const e of sortLog(entries)) {
    switch (e.kind) {
      case 'signal': {
        const from = e.from!;
        const to = e.to ?? [];
        if (state.replyExpectedFrom && !sameAddress(state.replyExpectedFrom, from)) clearReplyExpected(state);
        if (e.replyExpectedBy) {
          state.replyExpectedBy = e.replyExpectedBy;
          state.replyExpectedSignalId = e.signalId ?? null;
          state.replyExpectedFrom = from;
          state.overdue = false;
        }
        if (e.needsResponse === false) {
          if (state.request && !sameAddress(state.request.requestedBy, from)) {
            state.request = null;
            if (ball.kind === 'request') ball = { kind: 'none' };
          }
        } else {
          const prev = state.request;
          const request: Request = {
            holders: to,
            except: to.length === 0 ? from : null,
            requestedBy: from,
            since: prev && sameAddress(prev.requestedBy, from) ? prev.since : e.at,
            signalId: e.signalId!,
          };
          state.request = request;
          ball = { kind: 'request', request };
        }
        if (state.dismissed) state.activeSinceDismissed = true;
        break;
      }
      case 'claimed':
        state.ownerUserId = e.userId ?? null;
        ball = { kind: 'claimed', userId: state.ownerUserId };
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
      case 'mirrored':
        if (e.fields && typeof e.fields.done === 'boolean') state.closedAtSource = e.fields.done;
        else if (e.fields && e.fields.done === null) state.closedAtSource = false;
        break;
      case 'note':
      case 'linked':
      case 'unlinked':
      case 'attribute':
        break;
    }
  }
  const closed = state.dismissed || state.closedAtSource;
  state.ball = closed ? { kind: 'none' } : ball;
  if (closed) state.overdue = false;
  return state;
}

function clearReplyExpected(state: CommState): void {
  state.replyExpectedBy = null;
  state.replyExpectedSignalId = null;
  state.replyExpectedFrom = null;
  state.overdue = false;
}

export function sameAddress(a: AddressRef, b: AddressRef): boolean {
  return a.channel === b.channel && sameValue(a.value, b.value);
}

export function sortLog<T extends Pick<ThreadLogEntry, 'at' | 'seq'>>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq));
}
