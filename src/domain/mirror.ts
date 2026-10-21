import { checkAttribute } from './commands';
import type { CoreContext } from './context';
import type { Channel } from './entities';
import { DomainError } from './errors';
import { draft, type AttributeValue, type DraftEvent } from './events';
import { threadOfSourceKey, type InboundSignal } from './ingest';
import type { Projections } from './projections';

// 状態の写し（0010・0014。ステップ 7）。状態を持つデータソース（Jira の課題など）の状態を、
// スレッドの属性に片方向で写す判断（純関数）。Murmur の側では書き換えない。

/** コネクタが正規化した状態の写し。課題の更新 1 回分 */
export interface InboundMirror {
  kind: 'mirror';
  dataSourceId: string;
  channel: Channel;
  /** ソースの区切り（課題キー） */
  threadKey: string;
  /** 写す値（null は空）。名前はデータソースの AttributeDef。party 型はそのチャネルのアドレスで渡す（Party に直す） */
  fields: Record<string, AttributeValue | null>;
  /** ソースの更新の識別子（監査用） */
  sourceRef: string;
}

/** コネクタが返すもの: シグナルか状態の写し */
export type InboundItem = InboundSignal | InboundMirror;

export function isMirror(item: InboundItem): item is InboundMirror {
  return (item as { kind?: unknown }).kind === 'mirror';
}

export type MirrorPlan =
  | { kind: 'no_thread'; threadKey: string }
  | { kind: 'unchanged'; threadId: string }
  | { kind: 'mirrored'; threadId: string; fields: Record<string, AttributeValue | null>; events: DraftEvent[] };

/**
 * 写しの判断。課題キーのスレッドに、変わった属性だけを ThreadMirrored で写す（同じ値なら何もしない。冪等）。
 * スレッドはシグナル（課題の作成・起票の記録）で作られる。まだなければ写さない（no_thread）
 */
export function planMirror(p: Projections, ctx: CoreContext, m: InboundMirror): MirrorPlan {
  const ds = ctx.dir.dataSource(m.dataSourceId);
  if (!ds || ds.tenantId !== p.tenantId || ds.kind !== 'service') {
    throw new DomainError('invalid', `data source ${m.dataSourceId} is not a service data source of tenant ${p.tenantId}`);
  }
  if (ds.channel !== m.channel) throw new DomainError('invalid', `data source ${ds.id} is ${ds.channel}, not ${m.channel}`);
  const threadId = threadOfSourceKey(p, ds.id, m.threadKey);
  if (!threadId) return { kind: 'no_thread', threadKey: m.threadKey };
  const t = p.threads[threadId]!;

  const defs = ctx.dir.attributeDefs(ds.id);
  const changed: Record<string, AttributeValue | null> = {};
  for (const [name, raw] of Object.entries(m.fields)) {
    const def = defs.find((d) => d.name === name);
    if (!def) throw new DomainError('invalid', `attribute ${name} is not defined for data source ${ds.id}`);
    let value: AttributeValue | null;
    if (raw === null) value = null;
    else if (def.type === 'party') {
      if (typeof raw !== 'string') throw new DomainError('invalid', `attribute ${name} (party): not an address`);
      // 知らないアカウントは誰の番にもならないので空として写す
      value = ctx.dir.partyIdOfAddress(p.tenantId, { channel: ds.channel, value: raw }, ctx.now);
    } else value = checkAttribute(ctx.dir, p.tenantId, def, raw);
    if ((t.attributes[name] ?? null) !== value) changed[name] = value;
  }
  if (Object.keys(changed).length === 0) return { kind: 'unchanged', threadId };
  return {
    kind: 'mirrored',
    threadId,
    fields: changed,
    events: [draft('ThreadMirrored', { threadId, dataSourceId: ds.id, threadKey: m.threadKey, fields: changed, sourceRef: m.sourceRef })],
  };
}
