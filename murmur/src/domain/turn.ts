import type { Directory } from './directory';
import type { AddressRef } from './events';
import type { Projections, Thread } from './projections';
import { contactsOf, requestIsOurs, resolveBall } from './sides';
import { canReadDataSource, type Viewer } from './viewer';

// クエリ層の「誰の番か」と結び（0014 の 3）。投影のスナップショットとマスタから計算する純関数で、
// fold には持ち込まない（fold は 1 段）。Murmur は候補を出すだけで、自分ではリンクを張らない。

/**
 * 誰の番か。スレッドのボールに、構造（写しの holders・読者が 1 人のデータソース・宛先）を合わせたもの。
 * - user: 特定のユーザーの番（by: owner = 持ち主、holder = ソースの上でボールを持っている、reader = 読者が 1 人、
 *   addressed = 宛先・メンション。相手の求めの宛先に読者がいるか、こちらから同じリストの読者にボールを渡したとき）
 * - triage: こちら（組織）で、誰の番かが決まらない（仕分け待ち）
 * - contact / none: ボールのまま
 */
export type Turn =
  | { kind: 'user'; userIds: string[]; by: 'owner' | 'holder' | 'reader' | 'addressed' }
  | { kind: 'triage' }
  /** 相手の番。addresses は Contact に解決できなかった保持者（0030。名寄せすると contactIds に移る） */
  | { kind: 'contact'; contactIds: string[]; addresses: AddressRef[] }
  | { kind: 'none' };

export function turnOf(dir: Directory, p: Projections, t: Thread): Turn {
  const ball = resolveBall(dir, p, t);
  if (ball.kind === 'user') return { kind: 'user', userIds: [ball.userId], by: 'owner' };
  const held = holderTurn(dir, t);
  if (held) return held;
  const list = dir.listOfDataSource(t.dataSourceId);
  if (ball.kind === 'contact') {
    // 共有リストの中の頼みごと（0036 の決定 4）: ボールを持つ相手が同じリストの読者なら、その人の番（宛先・メンション）
    const readerOf = new Map((list ? dir.readerContactsOfList(list.id) : []).map((c) => [c.id, c.userId!]));
    const users = ball.contactIds.map((id) => readerOf.get(id)).filter((u): u is string => u !== undefined);
    if (users.length > 0) return { kind: 'user', userIds: [...new Set(users)].sort(), by: 'addressed' };
    return { kind: 'contact', contactIds: ball.contactIds, addresses: ball.addresses };
  }
  if (ball.kind === 'none') return { kind: 'none' };

  const readers = list ? dir.readersOfList(list.id) : [];
  if (readers.length === 1) return { kind: 'user', userIds: [readers[0]!], by: 'reader' };
  // 宛先・CC・メンション: 相手が求めたシグナルの保持者に、読者の Contact のアドレスが入っている（0030）
  const addressed = new Set<string>();
  if (t.request && requestIsOurs(dir, p, t) === false) {
    const held = contactsOf(dir, t.request.holders, p.signals[t.request.signalId]?.at);
    for (const r of list ? dir.readerContactsOfList(list.id) : []) if (held.includes(r.id)) addressed.add(r.userId!);
  }
  if (addressed.size > 0) return { kind: 'user', userIds: [...addressed].sort(), by: 'addressed' };
  return { kind: 'triage' };
}

/**
 * 状態を持つデータソースの上でボールを持っている人（写しの holders。0010 の黒子・0031）。ソースの状態が正なので、
 * 持ち主がいなければシグナルのボールより先に効く。読者のユーザーがいればその人たちの番、いなければその相手。
 * 完了・片付けのスレッドと、だれにも解決できないアカウントだけのときは効かない
 */
function holderTurn(dir: Directory, t: Thread): Turn | null {
  if (t.dismissed || t.closedAtSource || !t.source || t.source.holders.length === 0) return null;
  const ds = dir.dataSource(t.dataSourceId);
  if (ds?.kind !== 'service') return null;
  const list = dir.listOfDataSource(t.dataSourceId);
  const readers = list ? dir.readersOfList(list.id) : [];
  const users = new Set<string>();
  const contacts = new Set<string>();
  const unresolved: AddressRef[] = [];
  for (const value of t.source.holders) {
    const contactId = dir.contactIdOfAddress({ channel: ds.channel, value });
    const contact = contactId ? dir.contact(contactId) : undefined;
    if (!contact) {
      unresolved.push({ channel: ds.channel, value });
      continue;
    }
    if (contact.userId !== undefined && readers.includes(contact.userId)) users.add(contact.userId);
    else contacts.add(contact.id);
  }
  if (users.size > 0) return { kind: 'user', userIds: [...users].sort(), by: 'holder' };
  // だれにも解決できないアカウントだけのときは効かない（シグナルのボールに任せる）。解決できた相手がいれば、残りはアドレスのまま並べる
  if (contacts.size > 0) return { kind: 'contact', contactIds: [...contacts].sort(), addresses: unresolved };
  return null;
}

export function isMyTurn(turn: Turn, viewer: Viewer): boolean {
  return turn.kind === 'user' && turn.userIds.includes(viewer.userId);
}

/**
 * リンク先のスレッドから導出したボール（主に個人のメモのスレッドから見る。どのスレッドからでも同じ計算）。
 * 見えるリンク先だけを見る。片付けたリンク先は数えない
 * - my_turn: どれかが Viewer の番
 * - waiting: 全部が相手待ち
 * - none: それ以外
 * 見えるリンクがなければ null（見えないリンクは、あることも出さない。0033 の 3）
 */
export type DerivedBall =
  | { kind: 'my_turn'; threadIds: string[] }
  | { kind: 'waiting'; threadIds: string[] }
  | { kind: 'none' };

export function derivedBall(dir: Directory, viewer: Viewer, p: Projections, t: Thread): DerivedBall | null {
  // 見えないリンクは「リンクなし」と同じ（0033 の 3）
  const visible = visibleLinked(viewer, p, t);
  if (visible.length === 0) return null;
  const linked = visible.filter((x) => !x.dismissed);
  if (linked.length === 0) return { kind: 'none' };
  const turns = linked.map((x) => ({ id: x.id, turn: turnOf(dir, p, x) }));
  const mine = turns.filter((x) => isMyTurn(x.turn, viewer)).map((x) => x.id);
  if (mine.length > 0) return { kind: 'my_turn', threadIds: mine };
  if (turns.every((x) => x.turn.kind === 'contact')) return { kind: 'waiting', threadIds: turns.map((x) => x.id) };
  return { kind: 'none' };
}

/**
 * 片付けた（閉じた）スレッドに結ばれた先で、片付けたあとにシグナルが来た（0014 の 4）。
 * Murmur は開き直さない。事実だけ返し、開き直すかはスタンドが判断する
 */
export function linkedActiveSinceDismissed(viewer: Viewer, p: Projections, t: Thread): boolean {
  if (!t.dismissed || !t.dismissedAt) return false;
  const since = t.dismissedAt;
  return visibleLinked(viewer, p, t).some((x) => x.signalIds.some((id) => p.signals[id]!.at > since));
}

function visibleLinked(viewer: Viewer, p: Projections, t: Thread): Thread[] {
  return t.links
    .map((l) => p.threads[l.threadId])
    .filter((x): x is Thread => x !== undefined && canReadDataSource(viewer, x.dataSourceId));
}

// ---- 結び候補 ----

/**
 * スレッドのアンカーのうち、データソースをまたいで同じ件を指すキー（ソースの区切り・Jira キー・PR・メッセージ ID）。
 * メッセージ ID は sent_ref（`msg:` を付ける）。同じメールや DM を 2 人がそれぞれのデータソースで見ていれば一致する
 */
export function crossKeys(p: Projections, t: Thread): string[] {
  const keys = new Set<string>();
  for (const id of t.signalIds) {
    const a = p.signals[id]!.anchors;
    if (a.threadKey) keys.add(a.threadKey);
    if (a.messageId) keys.add(`msg:${a.messageId}`);
    for (const k of a.jiraKeys ?? []) keys.add(k);
    for (const k of a.prRefs ?? []) keys.add(k);
  }
  return [...keys].sort();
}

export interface LinkCandidate {
  threadId: string;
  dataSourceId: string;
  title: string;
  /** 一致したキー */
  keys: string[];
}

/**
 * 結び候補: Viewer に見えるスレッドのうち、アンカーのキーが t と一致して、まだ結ばれていないもの（0014 の未決 3: 見えるものに限る）
 */
export function linkCandidates(viewer: Viewer, p: Projections, t: Thread): LinkCandidate[] {
  const mine = new Set(crossKeys(p, t));
  if (mine.size === 0) return [];
  const linked = new Set(t.links.map((l) => l.threadId));
  const out: LinkCandidate[] = [];
  for (const u of Object.values(p.threads)) {
    if (u.id === t.id || linked.has(u.id) || !canReadDataSource(viewer, u.dataSourceId)) continue;
    const keys = crossKeys(p, u).filter((k) => mine.has(k));
    if (keys.length > 0) out.push({ threadId: u.id, dataSourceId: u.dataSourceId, title: u.title, keys });
  }
  return out.sort((a, b) => (a.threadId < b.threadId ? -1 : a.threadId > b.threadId ? 1 : 0));
}
