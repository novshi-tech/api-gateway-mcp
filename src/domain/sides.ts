import { sameAddress } from './comm';
import type { Directory } from './directory';
import type { AddressRef, DataSource } from './entities';
import type { Direction } from './events';
import type { Ball, Projections, SignalRecord, Thread } from './projections';

// クエリ層の「どちら側か」（0030）。イベントと fold はアドレスだけを持ち、こちらからか・どの Contact かは、
// ここでそのときのマスタから決める。名寄せを後から直せば、過去のスレッドの見え方も直る。

/**
 * そのデータソースで「こちら」のアドレスか（at 時点）。
 * - 窓口のアドレス（selfAddresses）
 * - 読者の Contact に付いているアドレス（メンバーが自分のアカウントで書く Jira・Slack、個人の箱）
 * - 個人のメモは、メモのチャネルなら全部こちら
 */
export function isOurs(dir: Directory, ds: DataSource | undefined, ref: AddressRef, at?: string): boolean {
  if (!ds) return false;
  if (ds.kind === 'notes') return ref.channel === 'note';
  if (ds.selfAddresses.some((a) => sameAddress(a, ref))) return true;
  const contactId = dir.contactIdOfAddress(ref, at);
  if (contactId === null) return false;
  const list = dir.listOfDataSource(ds.id);
  return list !== undefined && dir.readerContactsOfList(list.id).some((r) => r.id === contactId);
}

/** シグナルの向き（シグナルの時刻のマスタで決める） */
export function directionOf(dir: Directory, s: Pick<SignalRecord, 'dataSourceId' | 'from' | 'at'>): Direction {
  return isOurs(dir, dir.dataSource(s.dataSourceId), s.from, s.at) ? 'outbound' : 'inbound';
}

/** アドレスの Contact（at 時点。解決できないものは落とす。重複なしで並べる） */
export function contactsOf(dir: Directory, refs: readonly AddressRef[], at?: string): string[] {
  return resolveAddresses(dir, refs, at).contactIds;
}

/**
 * アドレスを Contact に解決する（at 時点）。解決できなかったものはアドレスのまま返す（0030。名寄せすると contactIds に移る）。
 * どちらも重複なしで並べる（アドレスは大文字小文字の違いを 1 つにまとめ、最初に出てきた表記を残す）
 */
export function resolveAddresses(
  dir: Directory,
  refs: readonly AddressRef[],
  at?: string,
  /** 解決できなくてもアドレスとして返さないもの（窓口のアドレスなど、こちらのアドレス） */
  skip: (r: AddressRef) => boolean = () => false,
): { contactIds: string[]; addresses: AddressRef[] } {
  const ids = new Set<string>();
  const addresses: AddressRef[] = [];
  for (const r of refs) {
    const id = dir.contactIdOfAddress(r, at);
    if (id !== null) ids.add(id);
    else if (!skip(r) && !addresses.some((a) => sameAddress(a, r))) addresses.push({ channel: r.channel, value: r.value });
  }
  return { contactIds: [...ids].sort(), addresses: sortAddresses(addresses) };
}

function sortAddresses(refs: AddressRef[]): AddressRef[] {
  const key = (r: AddressRef) => `${r.channel}\n${r.value.toLowerCase()}`;
  return [...refs].sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));
}

/** スレッドの最後に求めたシグナルが、こちらからのものか */
export function requestIsOurs(dir: Directory, p: Projections, t: Thread): boolean | null {
  const r = t.request;
  if (!r) return null;
  const at = p.signals[r.signalId]?.at;
  return isOurs(dir, dir.dataSource(t.dataSourceId), r.requestedBy, at);
}

/**
 * fold が畳んだボールを、どちら側かに解決する。
 * - 持った・手放した → その人・こちら
 * - こちらが求めた → 相手（保持者の Contact）
 * - 相手が求めた → 持ち主がいればその人、いなければこちら
 */
export function resolveBall(dir: Directory, p: Projections, t: Thread): Ball {
  const b = t.ball;
  if (b.kind === 'none') return { kind: 'none' };
  if (b.kind === 'claimed') return b.userId ? { kind: 'user', userId: b.userId } : { kind: 'us' };
  if (requestIsOurs(dir, p, t)) {
    const at = p.signals[b.request.signalId]?.at;
    const ds = dir.dataSource(t.dataSourceId);
    return { kind: 'contact', ...resolveAddresses(dir, b.request.holders, at, (r) => isOurs(dir, ds, r, at)) };
  }
  return t.ownerUserId ? { kind: 'user', userId: t.ownerUserId } : { kind: 'us' };
}

export interface CommView {
  ball: Ball;
  /** 相手の Contact（相手からのシグナルの送り主と、こちらからのシグナルの宛先） */
  counterpartContactIds: string[];
  /** 相手のうち、Contact に解決できなかったアドレス（0030。名寄せすると counterpartContactIds に移る） */
  counterpartAddresses: AddressRef[];
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  /** こちらの返事を待たせている最初の時刻（相手が求め続けているあいだ） */
  unansweredSince: string | null;
}

/** スレッドの通信状態をクエリ時のマスタで見る */
export function commView(dir: Directory, p: Projections, t: Thread): CommView {
  const ds = dir.dataSource(t.dataSourceId);
  let lastInboundAt: string | null = null;
  let lastOutboundAt: string | null = null;
  const counterparts = new Set<string>();
  const unresolved: AddressRef[] = [];
  const add = (refs: readonly AddressRef[], at: string) => {
    const r = resolveAddresses(dir, refs, at, (x) => isOurs(dir, ds, x, at));
    for (const id of r.contactIds) counterparts.add(id);
    for (const a of r.addresses) if (!unresolved.some((x) => sameAddress(x, a))) unresolved.push(a);
  };
  for (const e of t.log) {
    if (e.kind !== 'signal' || !e.from) continue;
    if (isOurs(dir, ds, e.from, e.at)) {
      lastOutboundAt = e.at;
      add(e.to ?? [], e.at);
    } else {
      lastInboundAt = e.at;
      add([e.from], e.at);
    }
  }
  const ours = requestIsOurs(dir, p, t);
  return {
    ball: resolveBall(dir, p, t),
    counterpartContactIds: [...counterparts].sort(),
    counterpartAddresses: sortAddresses(unresolved),
    lastInboundAt,
    lastOutboundAt,
    unansweredSince: ours === false ? t.request!.since : null,
  };
}
