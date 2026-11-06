import { sameValue } from './directory';
import type { AddressRef } from './events';
import type { AttentionState, CommState, LogPos, Naming, ThreadLogEntry } from './projections';

/**
 * 通信状態の導出（0030・0038）。スレッドに綴じたもの（シグナルのアドレス・担当する操作・名指しを外す操作・片付け）だけを
 * 時刻順に畳み込む。マスタを読まないので、リスト宛てか・読者かは決めない（クエリ層の turn.ts が決める）。本文や属性・リンク・メモは読まない。
 *
 * 名指し（アドレスと順番だけで決まる）:
 * - シグナルの宛先（送り主は除く）が名指しされる。アドレスごとに最後に名指ししたシグナルを持つ。上書きしない（ほかの人の発言で消えない）
 * - 宛先のないシグナルは broadcasts に残す（グループのチャネルならリスト宛て。クエリ層が決める）
 * - 名指しを外す（acknowledged）: そのシグナルまでの名指しを外す。それより後に名指しされれば、また残る。発言しただけでは外れない
 * - 担当する・引き継ぐ → その人。手放した → なし
 * - 片付けた・ソースの側で完了した → どの見え方にも数えない（名指しは畳んだまま。開き直せば効く）
 *
 * 返事期待: 記録した送信の期限が返事期待になり、その送信の宛先の名指しが全部外れれば消える（遅れて外せば期限超過も解消する）。
 * 期限超過は ReplyOverdue がその送信を指しているときだけ
 */
export function deriveComm(entries: readonly ThreadLogEntry[]): CommState {
  const state: CommState = {
    attention: { named: [], broadcasts: [], listAcks: {} },
    dismissed: false,
    dismissedAt: null,
    dismissReason: null,
    activeSinceDismissed: false,
    ownerUserId: null,
    replyExpectedBy: null,
    replyExpectedSignalId: null,
    overdue: false,
    closedAtSource: false,
  };
  const sorted = sortLog(entries);
  const named = new Map<string, Naming>();
  const positions = new Map<string, LogPos & { to: AddressRef[] }>();
  const acks: { addresses: AddressRef[]; list: boolean; untilSignalId: string; userId: string }[] = [];
  let overdueSignalId: string | null = null;

  for (const e of sorted) {
    switch (e.kind) {
      case 'signal': {
        const from = e.from!;
        const pos: LogPos = { signalId: e.signalId!, at: e.at, seq: e.seq };
        const to = uniqueAddresses((e.to ?? []).filter((r) => !sameAddress(r, from)));
        positions.set(pos.signalId, { ...pos, to });
        if (to.length === 0) state.attention.broadcasts.push({ ...pos, from });
        for (const r of to) {
          const key = addressKey(r);
          named.set(key, { address: named.get(key)?.address ?? { channel: r.channel, value: r.value }, last: pos, from, ackedThrough: null });
        }
        if (e.replyExpectedBy) {
          state.replyExpectedBy = e.replyExpectedBy;
          state.replyExpectedSignalId = pos.signalId;
          overdueSignalId = null;
        }
        if (state.dismissed) state.activeSinceDismissed = true;
        break;
      }
      case 'acknowledged':
        acks.push({ addresses: e.addresses ?? [], list: e.list ?? false, untilSignalId: e.untilSignalId!, userId: e.actorUserId! });
        break;
      case 'claimed':
        state.ownerUserId = e.userId ?? null;
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
        if (e.signalId !== undefined && e.signalId === state.replyExpectedSignalId) overdueSignalId = e.signalId;
        break;
      case 'mirrored':
        if (e.fields?.closed !== undefined) state.closedAtSource = e.fields.closed;
        break;
      case 'note':
      case 'linked':
      case 'unlinked':
      case 'attribute':
        break;
    }
  }

  // 外した位置は最後にまとめて当てる（外す操作はシグナルの位置で効く。ログの中の順番には依らない）
  for (const a of acks) {
    const until = positions.get(a.untilSignalId);
    if (!until) continue; // そのシグナルが移し替えられた
    const at: LogPos = { signalId: until.signalId, at: until.at, seq: until.seq };
    for (const r of a.addresses) {
      const n = named.get(addressKey(r));
      if (n && (!n.ackedThrough || comparePos(at, n.ackedThrough) > 0)) n.ackedThrough = { ...at, userId: a.userId };
    }
    if (a.list) {
      const prev = state.attention.listAcks[a.userId];
      if (!prev || comparePos(at, prev) > 0) state.attention.listAcks[a.userId] = at;
    }
  }
  state.attention.named = [...named.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, n]) => n);

  // 返事期待: その送信の宛先の名指しが 1 つでも残っていれば続く
  if (state.replyExpectedSignalId) {
    const sent = positions.get(state.replyExpectedSignalId);
    const waiting = sent !== undefined && (sent.to.length === 0 || sent.to.some((r) => isPending(named.get(addressKey(r)), sent)));
    if (!waiting) {
      state.replyExpectedBy = null;
      state.replyExpectedSignalId = null;
      overdueSignalId = null;
    }
  }
  state.overdue = overdueSignalId !== null && !(state.dismissed || state.closedAtSource);
  return state;
}

/** その名指しが、位置 since 以降のシグナルの分まで外れていないか（since を省けば最後の名指しで見る） */
export function isPending(n: Naming | undefined, since?: LogPos): boolean {
  if (!n) return false;
  if (since && comparePos(n.last, since) < 0) return false;
  return !n.ackedThrough || comparePos(n.last, n.ackedThrough) > 0;
}

/** ログの位置の比較（時刻、同じなら seq） */
export function comparePos(a: Pick<LogPos, 'at' | 'seq'>, b: Pick<LogPos, 'at' | 'seq'>): number {
  return a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq;
}

/** 名指しのアドレスのキー（大文字小文字の違いは 1 つにまとめる） */
export function addressKey(r: AddressRef): string {
  return `${r.channel}\n${r.value.toLowerCase()}`;
}

export function emptyAttention(): AttentionState {
  return { named: [], broadcasts: [], listAcks: {} };
}

function uniqueAddresses(refs: AddressRef[]): AddressRef[] {
  const out: AddressRef[] = [];
  for (const r of refs) if (!out.some((x) => sameAddress(x, r))) out.push(r);
  return out;
}

export function sameAddress(a: AddressRef, b: AddressRef): boolean {
  return a.channel === b.channel && sameValue(a.value, b.value);
}

export function sortLog<T extends Pick<ThreadLogEntry, 'at' | 'seq'>>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq));
}
