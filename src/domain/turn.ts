import type { Directory } from './directory';
import type { Projections, Thread } from './projections';
import { canReadDataSource, type Viewer } from './viewer';

// クエリ層の「誰の番か」と結び（0014 の 3）。投影のスナップショットとマスタから計算する純関数で、
// fold には持ち込まない（fold は 1 段）。Murmur は候補を出すだけで、自分ではリンクを張らない。

/**
 * 誰の番か。スレッドのボールに、構造（担当者の写し・読者が 1 人のデータソース・宛先）を合わせたもの。
 * - user: 特定のユーザーの番（by: owner = 持ち主、assignee = ソースの担当者、reader = 読者が 1 人、addressed = 宛先・メンション）
 * - triage: こちら（組織）で、誰の番かが決まらない（仕分け待ち）
 * - contact / none: ボールのまま
 */
export type Turn =
  | { kind: 'user'; userIds: string[]; by: 'owner' | 'assignee' | 'reader' | 'addressed' }
  | { kind: 'triage' }
  | { kind: 'contact'; contactIds: string[] }
  | { kind: 'none' };

export function turnOf(dir: Directory, p: Projections, t: Thread): Turn {
  const ball = t.ball;
  if (ball.kind === 'user') return { kind: 'user', userIds: [ball.userId], by: 'owner' };
  const assignee = assigneeTurn(dir, t);
  if (assignee) return assignee;
  if (ball.kind === 'contact') return { kind: 'contact', contactIds: ball.contactIds };
  if (ball.kind === 'none') return { kind: 'none' };

  const list = dir.listOfDataSource(t.dataSourceId);
  const readers = (list ? dir.readersOfList(list.id) : []).filter((r) => r.userId);
  if (readers.length === 1) return { kind: 'user', userIds: [readers[0]!.userId!], by: 'reader' };
  // 宛先・CC・メンション: 受信の to に、読者の Contact が入っている
  const addressed = new Set<string>();
  for (const id of t.signalIds) {
    const s = p.signals[id]!;
    if (s.direction !== 'inbound') continue;
    for (const r of readers) if (s.toContactIds.includes(r.id)) addressed.add(r.userId!);
  }
  if (addressed.size > 0) return { kind: 'user', userIds: [...addressed].sort(), by: 'addressed' };
  return { kind: 'triage' };
}

/**
 * 状態を持つデータソースの担当者（写しの assignee。0010 の黒子）。ソースの状態が正なので、持ち主がいなければ
 * シグナルのボールより先に効く。担当者が読者のユーザーならその人の番、そうでなければその相手。完了・片付けのスレッドには効かない
 */
function assigneeTurn(dir: Directory, t: Thread): Turn | null {
  if (t.dismissed || t.closedAtSource) return null;
  const v = t.attributes.assignee;
  if (typeof v !== 'string' || !dir.attributeDefs(t.dataSourceId).some((d) => d.name === 'assignee' && d.type === 'contact')) return null;
  const contact = dir.contact(v);
  if (!contact) return null;
  const list = dir.listOfDataSource(t.dataSourceId);
  const reader = contact.userId !== undefined && list !== undefined && dir.readersOfList(list.id).some((r) => r.id === contact.id);
  return reader ? { kind: 'user', userIds: [contact.userId!], by: 'assignee' } : { kind: 'contact', contactIds: [contact.id] };
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
 * リンクがなければ null
 */
export type DerivedBall =
  | { kind: 'my_turn'; threadIds: string[] }
  | { kind: 'waiting'; threadIds: string[] }
  | { kind: 'none' };

export function derivedBall(dir: Directory, viewer: Viewer, p: Projections, t: Thread): DerivedBall | null {
  const linked = visibleLinked(viewer, p, t).filter((x) => !x.dismissed);
  if (linked.length === 0) return t.links.length === 0 ? null : { kind: 'none' };
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
