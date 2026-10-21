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
  fold,
  getListView,
  getThreadView,
  linkThreads,
  listLists,
  listThreads,
  moveSignal,
  notesDataSourceOf,
  planIngest,
  prepareInbound,
  reopenThread,
  setAttribute,
  signalEvent,
  unlinkThreads,
  type CoreContext,
  type DraftEvent,
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

const MAX_RETRIES = 3;

export class MurmurService {
  constructor(readonly deps: ServiceDeps) {}

  // ---- 土台 ----

  async directory(): Promise<Directory> {
    return new Directory(await this.deps.repo.master.loadSeed());
  }

  /** 投影を読み、取りこぼしたイベントがあれば追いつく */
  async state(tenantId: string): Promise<Projections> {
    const { repo } = this.deps;
    const saved = (await repo.projections.load(tenantId)) ?? emptyProjections(tenantId);
    const missing = await repo.events.read(tenantId, saved.lastSeq);
    if (missing.length === 0) return saved;
    const next = fold(missing, saved);
    await repo.projections.save(next);
    return next;
  }

  /** 投影を消してイベントから作り直す（H1 の検証にも使う） */
  async rebuild(tenantId: string): Promise<Projections> {
    await this.deps.repo.projections.clear(tenantId);
    return this.state(tenantId);
  }

  private context(dir: Directory): CoreContext {
    return { dir, now: this.deps.clock.now(), newId: this.deps.newId };
  }

  /**
   * 1 回のコマンド処理。decide はコアの関数を呼んでイベントを返す。
   * 追記が競合したら読み直してやり直す（楽観ロック）。
   */
  private async run<T>(
    tenantId: string,
    decide: (p: Projections, ctx: CoreContext) => Promise<{ events: DraftEvent[]; result: T }> | { events: DraftEvent[]; result: T },
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const p = await this.state(tenantId);
      const ctx = this.context(await this.directory());
      const { events, result } = await decide(p, ctx);
      if (events.length === 0) return result;
      try {
        const stored = await this.deps.repo.events.append(tenantId, p.lastSeq, events, ctx.now);
        await this.deps.repo.projections.save(fold(stored, p));
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

  private async tenantOf(viewer: Viewer, pick: (p: Projections) => boolean, what: string): Promise<string> {
    for (const m of viewer.memberships) {
      if (pick(await this.state(m.tenantId))) return m.tenantId;
    }
    throw new DomainError('not_found', `${what} not found`);
  }

  // ---- Ingest ----

  async ingest(tenantId: string, inbound: InboundSignal): Promise<IngestResult> {
    return this.run<IngestResult>(tenantId, async (p, ctx) => {
      const prepared = prepareInbound(p, ctx, inbound);
      if (prepared.kind === 'duplicate') return { events: [], result: { status: 'duplicate', signalId: prepared.signalId } };
      // 記録した送信の観測（記録が先に届いた順）。シグナルは 1 本のまま、イベントは出さない（H5）
      if (prepared.kind === 'merged') return { events: [], result: { status: 'merged', signalId: prepared.signalId, threadId: prepared.threadId } };

      const { payload, dataSource } = prepared;
      const sigEvent = signalEvent(payload);
      // シグナルを先に畳み込んだ状態で判断する（索引に入るだけで、どのスレッドにもまだ入っていない）
      const withSignal = fold([{ ...sigEvent, tenantId, seq: p.lastSeq + 1, at: ctx.now }], p);
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

  // ---- 定期処理（Cron） ----

  /** 各データソースから、そのチャネルのコネクタで取り込む */
  async pollConnectors(): Promise<IngestResult[]> {
    const dir = await this.directory();
    const results: IngestResult[] = [];
    for (const ds of dir.seed.dataSources) {
      if (ds.kind !== 'service') continue;
      const connector = this.deps.connectors[ds.channel];
      if (!connector) continue;
      const { signals } = await connector.pull(ds, null);
      for (const s of signals) results.push(await this.ingest(ds.tenantId, s));
    }
    return results;
  }

  /** 期限の見回り。返事期待の期限を過ぎたスレッドに ReplyOverdue を出す（冪等） */
  async checkOverdue(): Promise<number> {
    const dir = await this.directory();
    let n = 0;
    for (const tenantId of dir.tenantIds()) {
      n += await this.run(tenantId, (p, ctx) => {
        const events = planOverdue(p, ctx.now);
        return { events, result: events.length };
      });
    }
    return n;
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
      parties: viewer.memberships.map((m) => ({
        tenantId: m.tenantId,
        tenantName: dir.seed.tenants.find((t) => t.id === m.tenantId)?.name ?? m.tenantId,
        partyId: m.partyId,
        name: dir.party(m.partyId)?.name ?? '',
        lists: m.listIds.map((id) => {
          const ds = dir.dataSource(dir.list(id)?.dataSourceId ?? '');
          return { id, dataSourceId: ds?.id ?? '', name: ds?.name ?? id, kind: ds?.kind ?? 'service' };
        }),
      })),
    };
  }

  async listThreads(userId: string, opts: { filter?: ThreadFilter; tenantId?: string; dataSourceId?: string; since?: string } = {}) {
    const { viewer, dir } = await this.viewer(userId);
    const states = await Promise.all(viewer.memberships.map((m) => this.state(m.tenantId)));
    return listThreads(dir, viewer, states, opts);
  }

  async getThread(userId: string, threadId: string, opts: { since?: string } = {}) {
    const { viewer, dir } = await this.viewer(userId);
    for (const m of viewer.memberships) {
      const view = getThreadView(dir, viewer, await this.state(m.tenantId), threadId, opts);
      if (view) return view;
    }
    throw new DomainError('not_found', `thread ${threadId} not found`);
  }

  private async threadTenant(viewer: Viewer, threadId: string): Promise<string> {
    return this.tenantOf(viewer, (p) => !!p.threads[threadId], `thread ${threadId}`);
  }

  /** 個人のメモ。thread_id がなければ新しいスレッド。テナントは thread_id か tenant から、なければ自分のメモが 1 つだけのテナント */
  async addNote(userId: string, input: { threadId?: string; title?: string; body: string; tenantId?: string }) {
    const { viewer, dir } = await this.viewer(userId);
    let tenantId: string;
    if (input.threadId !== undefined) tenantId = await this.threadTenant(viewer, input.threadId);
    else if (input.tenantId !== undefined) tenantId = input.tenantId;
    else {
      const withNotes = viewer.memberships.filter((m) => notesDataSourceOf(dir, viewer, m.tenantId));
      if (withNotes.length !== 1) throw new DomainError('invalid', 'tenant is required (notes in several tenants)');
      tenantId = withNotes[0]!.tenantId;
    }
    const threadId = await this.run(tenantId, (p, ctx) => {
      const { events, threadId } = addNote(p, viewer, ctx, input);
      return { events, result: threadId };
    });
    return this.getThread(userId, threadId);
  }

  async claimThread(userId: string, input: { threadId: string; userId: string | null; reason?: string }) {
    const { viewer } = await this.viewer(userId);
    const tenantId = await this.threadTenant(viewer, input.threadId);
    await this.run(tenantId, (p, ctx) => ({ events: claimThread(p, viewer, ctx.dir, input), result: undefined }));
    return this.getThread(userId, input.threadId);
  }

  async linkThreads(userId: string, input: { threadId: string; otherThreadId: string; reason?: string }) {
    const { viewer } = await this.viewer(userId);
    const tenantId = await this.threadTenant(viewer, input.threadId);
    await this.run(tenantId, (p) => ({ events: linkThreads(p, viewer, input), result: undefined }));
    return this.getThread(userId, input.threadId);
  }

  async unlinkThreads(userId: string, input: { threadId: string; otherThreadId: string; reason?: string }) {
    const { viewer } = await this.viewer(userId);
    const tenantId = await this.threadTenant(viewer, input.threadId);
    await this.run(tenantId, (p) => ({ events: unlinkThreads(p, viewer, input), result: undefined }));
    return this.getThread(userId, input.threadId);
  }

  /** 送信の記録。スタンドがゲートウェイ経由で送った直後に呼ぶ。返すのは送ったシグナルの入ったスレッド */
  async recordSent(userId: string, input: RecordSentInput) {
    const { viewer, dir } = await this.viewer(userId);
    const ds = dir.dataSource(input.dataSourceId);
    if (!ds || !viewer.memberships.some((m) => m.dataSourceIds.includes(ds.id))) {
      throw new DomainError('not_found', `data source ${input.dataSourceId} not found`);
    }
    const threadId = await this.run(ds.tenantId, (p, ctx) => {
      const { events, threadId } = recordSent(p, viewer, ctx, input);
      return { events, result: threadId };
    });
    return this.getThread(userId, threadId);
  }

  async setAttribute(userId: string, input: { threadId: string; name: string; value: unknown }) {
    const { viewer } = await this.viewer(userId);
    const tenantId = await this.threadTenant(viewer, input.threadId);
    await this.run(tenantId, (p, ctx) => ({ events: setAttribute(p, viewer, ctx.dir, input), result: undefined }));
    return this.getThread(userId, input.threadId);
  }

  async dismissThread(userId: string, input: { threadId: string; reason: string }) {
    const { viewer } = await this.viewer(userId);
    const tenantId = await this.tenantOf(viewer, (p) => !!p.threads[input.threadId], `thread ${input.threadId}`);
    await this.run(tenantId, (p) => ({ events: dismissThread(p, viewer, input), result: undefined }));
    return this.getThread(userId, input.threadId);
  }

  async reopenThread(userId: string, input: { threadId: string; reason?: string }) {
    const { viewer } = await this.viewer(userId);
    const tenantId = await this.tenantOf(viewer, (p) => !!p.threads[input.threadId], `thread ${input.threadId}`);
    await this.run(tenantId, (p) => ({ events: reopenThread(p, viewer, input), result: undefined }));
    return this.getThread(userId, input.threadId);
  }

  async moveSignal(userId: string, input: { signalId: string; to: MoveTarget; needsResponse?: boolean; reason: string }) {
    const { viewer } = await this.viewer(userId);
    const tenantId = await this.tenantOf(viewer, (p) => !!p.signals[input.signalId], `signal ${input.signalId}`);
    const threadId = await this.run(tenantId, (p, ctx) => {
      const { events, threadId } = moveSignal(p, viewer, ctx, input);
      return { events, result: threadId };
    });
    return this.getThread(userId, threadId);
  }

  async listLists(userId: string, opts: { tenantId?: string } = {}) {
    const { viewer, dir } = await this.viewer(userId);
    return listLists(dir, viewer, opts);
  }

  async getList(userId: string, listId: string) {
    const { viewer, dir } = await this.viewer(userId);
    const view = getListView(dir, viewer, listId);
    if (!view) throw new DomainError('not_found', `list ${listId} not found`);
    return view;
  }
}
