import {
  addNote,
  claimThread,
  deriveViewer,
  planOverdue,
  recordSent,
  type RecordSentInput,
  Directory,
  DomainError,
  dismissThread,
  emptyProjections,
  finalizeIngest,
  isMirror,
  planMirror,
  fold,
  foldChanges,
  getListView,
  getThreadView,
  linkThreads,
  listLists,
  listThreads,
  moveSignal,
  planIngest,
  prepareInbound,
  reopenThread,
  setAttribute,
  signalEvent,
  unlinkThreads,
  type CoreContext,
  type DraftEvent,
  type AttributeValue,
  type InboundItem,
  type InboundMirror,
  type InboundSignal,
  type IngestOutcome,
  type IngestPolicy,
  type MoveTarget,
  type Projections,
  type ThreadFilter,
  type Viewer,
} from '../domain';
import type { Connectors } from '../connectors/types';
import type { Decider } from '../ingest/deciders';
import { ConcurrencyError, type Repo } from '../store/types';

// 命令型シェル。IO（DB・Claude・コネクタ・時計・ID 生成）をここに集め、判断は全部コア（src/domain）に任せる。
//   読む → コアで決める → イベントを追記 → fold して投影を保存

export interface Clock {
  now(): string;
}

export const systemClock: Clock = { now: () => new Date().toISOString() };

export const randomIds = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

export interface ServiceDeps {
  repo: Repo;
  clock: Clock;
  newId: (prefix: string) => string;
  decider: Decider;
  connectors: Connectors;
  policy: IngestPolicy;
}

export type IngestResult =
  | { status: 'duplicate'; signalId: string }
  | { status: 'merged'; signalId: string; threadId: string | null }
  | ({ status: 'threaded'; signalId: string } & IngestOutcome);

/** 状態の写しの結果。no_thread はまだ課題のスレッドがない（写さない） */
export type MirrorResult =
  | { status: 'mirrored'; threadId: string; fields: Record<string, AttributeValue | null> }
  | { status: 'unchanged'; threadId: string }
  | { status: 'no_thread'; threadKey: string };

const MAX_RETRIES = 3;

export class MurmurService {
  constructor(readonly deps: ServiceDeps) {}

  // ---- 土台 ----

  async directory(): Promise<Directory> {
    return new Directory(await this.deps.repo.master.loadSeed());
  }

  /** 投影を読み、取りこぼしたイベントがあれば追いつく */
  async state(): Promise<Projections> {
    const { repo } = this.deps;
    const saved = (await repo.projections.load()) ?? emptyProjections();
    const missing = await repo.events.read(saved.lastSeq);
    if (missing.length === 0) return saved;
    const { projections, changes } = foldChanges(missing, saved);
    await repo.projections.save(projections, changes);
    return projections;
  }

  /** 投影を消してイベントから作り直す（H1 の検証にも使う） */
  async rebuild(): Promise<Projections> {
    await this.deps.repo.projections.clear();
    return this.state();
  }

  private context(dir: Directory): CoreContext {
    return { dir, now: this.deps.clock.now(), newId: this.deps.newId };
  }

  /**
   * 1 回のコマンド処理。decide はコアの関数を呼んでイベントを返す。
   * 追記が競合したら読み直してやり直す（楽観ロック）。
   */
  private async run<T>(
    decide: (p: Projections, ctx: CoreContext) => Promise<{ events: DraftEvent[]; result: T }> | { events: DraftEvent[]; result: T },
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const p = await this.state();
      const ctx = this.context(await this.directory());
      const { events, result } = await decide(p, ctx);
      if (events.length === 0) return result;
      try {
        const stored = await this.deps.repo.events.append(p.lastSeq, events, ctx.now);
        const { projections, changes } = foldChanges(stored, p);
        await this.deps.repo.projections.save(projections, changes);
        return result;
      } catch (err) {
        if (err instanceof ConcurrencyError && attempt < MAX_RETRIES) continue;
        throw err;
      }
    }
  }

  async viewer(userId: string): Promise<{ viewer: Viewer; dir: Directory }> {
    const dir = await this.directory();
    return { viewer: deriveViewer(dir, userId), dir };
  }

  // ---- Ingest ----

  async ingest(inbound: InboundSignal): Promise<IngestResult> {
    return this.run<IngestResult>(async (p, ctx) => {
      const prepared = prepareInbound(p, ctx, inbound);
      if (prepared.kind === 'duplicate') return { events: [], result: { status: 'duplicate', signalId: prepared.signalId } };
      // 記録した送信の観測（記録が先に届いた順）。シグナルは 1 本のまま、イベントは出さない（H5）
      if (prepared.kind === 'merged') return { events: [], result: { status: 'merged', signalId: prepared.signalId, threadId: prepared.threadId } };

      const { payload, dataSource } = prepared;
      const sigEvent = signalEvent(payload);
      // シグナルを先に畳み込んだ状態で判断する（索引に入るだけで、どのスレッドにもまだ入っていない）
      const withSignal = fold([{ ...sigEvent, seq: p.lastSeq + 1, at: ctx.now }], p);
      const plan = planIngest(withSignal, ctx, dataSource, payload, this.deps.policy);
      let decided;
      if (plan.kind === 'decided') decided = plan;
      else {
        const { raw, by } = await this.deps.decider.decide(plan.request);
        decided = finalizeIngest(ctx, plan.request, raw, by);
      }
      return {
        events: [sigEvent, ...decided.events],
        result: { status: 'threaded', signalId: payload.signalId, ...decided.outcome },
      };
    });
  }

  /** 状態の写し（Jira の課題の状態など）。変わった属性だけを ThreadMirrored で写す */
  async mirror(inbound: InboundMirror): Promise<MirrorResult> {
    return this.run<MirrorResult>((p, ctx) => {
      const plan = planMirror(p, ctx, inbound);
      if (plan.kind === 'no_thread') return { events: [], result: { status: 'no_thread', threadKey: plan.threadKey } };
      if (plan.kind === 'unchanged') return { events: [], result: { status: 'unchanged', threadId: plan.threadId } };
      return { events: plan.events, result: { status: 'mirrored', threadId: plan.threadId, fields: plan.fields } };
    });
  }

  /** コネクタ・Webhook から来た 1 件（シグナルか状態の写し） */
  async ingestItem(item: InboundItem): Promise<IngestResult | MirrorResult> {
    return isMirror(item) ? this.mirror(item) : this.ingest(item);
  }

  // ---- 定期処理（Cron） ----

  /** 各データソースから、そのチャネルのコネクタで取り込む */
  async pollConnectors(): Promise<(IngestResult | MirrorResult)[]> {
    const dir = await this.directory();
    const results: (IngestResult | MirrorResult)[] = [];
    for (const ds of dir.seed.dataSources) {
      if (ds.kind !== 'service') continue;
      const connector = this.deps.connectors[ds.channel];
      if (!connector) continue;
      const { items } = await connector.pull(ds, null);
      for (const item of items) results.push(await this.ingestItem(item));
    }
    return results;
  }

  /** 期限の見回り。返事期待の期限を過ぎたスレッドに ReplyOverdue を出す（冪等） */
  async checkOverdue(): Promise<number> {
    return this.run((p, ctx) => {
      const events = planOverdue(p, ctx.now);
      return { events, result: events.length };
    });
  }

  async tick(): Promise<{ ingested: number; overdue: number }> {
    const ingested = (await this.pollConnectors()).length;
    return { ingested, overdue: await this.checkOverdue() };
  }

  // ---- スタンド向け API（Viewer = ゲートウェイから伝搬された User） ----

  async me(userId: string) {
    const { viewer, dir } = await this.viewer(userId);
    const user = dir.seed.users.find((u) => u.id === userId);
    if (!user) throw new DomainError('not_found', `user ${userId} not found`);
    return {
      user,
      party:
        viewer.partyId === null
          ? null
          : {
              partyId: viewer.partyId,
              name: dir.party(viewer.partyId)?.name ?? '',
              lists: viewer.listIds.map((id) => {
                const ds = dir.dataSource(dir.list(id)?.dataSourceId ?? '');
                return { id, dataSourceId: ds?.id ?? '', name: ds?.name ?? id, kind: ds?.kind ?? 'service' };
              }),
            },
    };
  }

  async listThreads(userId: string, opts: { filter?: ThreadFilter; dataSourceId?: string; since?: string } = {}) {
    const { viewer, dir } = await this.viewer(userId);
    return listThreads(dir, viewer, await this.state(), opts);
  }

  async getThread(userId: string, threadId: string, opts: { since?: string } = {}) {
    const { viewer, dir } = await this.viewer(userId);
    const view = getThreadView(dir, viewer, await this.state(), threadId, opts);
    if (!view) throw new DomainError('not_found', `thread ${threadId} not found`);
    return view;
  }

  /** 個人のメモ。thread_id がなければ新しいスレッド */
  async addNote(userId: string, input: { threadId?: string; title?: string; body: string }) {
    const { viewer } = await this.viewer(userId);
    const threadId = await this.run((p, ctx) => {
      const { events, threadId } = addNote(p, viewer, ctx, input);
      return { events, result: threadId };
    });
    return this.getThread(userId, threadId);
  }

  async claimThread(userId: string, input: { threadId: string; userId: string | null; reason?: string }) {
    const { viewer } = await this.viewer(userId);
    await this.run((p, ctx) => ({ events: claimThread(p, viewer, ctx.dir, input), result: undefined }));
    return this.getThread(userId, input.threadId);
  }

  async linkThreads(userId: string, input: { threadId: string; otherThreadId: string; reason?: string }) {
    const { viewer } = await this.viewer(userId);
    await this.run((p) => ({ events: linkThreads(p, viewer, input), result: undefined }));
    return this.getThread(userId, input.threadId);
  }

  async unlinkThreads(userId: string, input: { threadId: string; otherThreadId: string; reason?: string }) {
    const { viewer } = await this.viewer(userId);
    await this.run((p) => ({ events: unlinkThreads(p, viewer, input), result: undefined }));
    return this.getThread(userId, input.threadId);
  }

  /** 送信の記録。スタンドがゲートウェイ経由で送った直後に呼ぶ。返すのは送ったシグナルの入ったスレッド */
  async recordSent(userId: string, input: RecordSentInput) {
    const { viewer, dir } = await this.viewer(userId);
    const ds = dir.dataSource(input.dataSourceId);
    if (!ds || !viewer.dataSourceIds.includes(ds.id)) {
      throw new DomainError('not_found', `data source ${input.dataSourceId} not found`);
    }
    const threadId = await this.run((p, ctx) => {
      const { events, threadId } = recordSent(p, viewer, ctx, input);
      return { events, result: threadId };
    });
    return this.getThread(userId, threadId);
  }

  async setAttribute(userId: string, input: { threadId: string; name: string; value: unknown }) {
    const { viewer } = await this.viewer(userId);
    await this.run((p, ctx) => ({ events: setAttribute(p, viewer, ctx.dir, input), result: undefined }));
    return this.getThread(userId, input.threadId);
  }

  async dismissThread(userId: string, input: { threadId: string; reason: string }) {
    const { viewer } = await this.viewer(userId);
    await this.run((p) => ({ events: dismissThread(p, viewer, input), result: undefined }));
    return this.getThread(userId, input.threadId);
  }

  async reopenThread(userId: string, input: { threadId: string; reason?: string }) {
    const { viewer } = await this.viewer(userId);
    await this.run((p) => ({ events: reopenThread(p, viewer, input), result: undefined }));
    return this.getThread(userId, input.threadId);
  }

  async moveSignal(userId: string, input: { signalId: string; to: MoveTarget; needsResponse?: boolean; reason: string }) {
    const { viewer } = await this.viewer(userId);
    const threadId = await this.run((p, ctx) => {
      const { events, threadId } = moveSignal(p, viewer, ctx, input);
      return { events, result: threadId };
    });
    return this.getThread(userId, threadId);
  }

  async listLists(userId: string) {
    const { viewer, dir } = await this.viewer(userId);
    return listLists(dir, viewer);
  }

  async getList(userId: string, listId: string) {
    const { viewer, dir } = await this.viewer(userId);
    const view = getListView(dir, viewer, listId);
    if (!view) throw new DomainError('not_found', `list ${listId} not found`);
    return view;
  }
}
