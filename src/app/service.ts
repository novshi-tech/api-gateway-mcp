import {
  approveDerivation,
  closeTask,
  correctIngest,
  deriveViewer,
  Directory,
  DomainError,
  explainIgnore,
  finalizeDecision,
  fold,
  getListView,
  getTaskView,
  listMyTasks,
  listProposalsFor,
  derivationView,
  planDecision,
  prepareInbound,
  proposeDerivation,
  recordSent,
  rejectDerivation,
  reopenTask,
  scanOverdue,
  setAttribute,
  signalEvent,
  emptyProjections,
  type AddressRef,
  type CoreContext,
  type CorrectionDecision,
  type DecisionPolicy,
  type DraftEvent,
  type FileRef,
  type InboundSignal,
  type Principal,
  type Projections,
  type TaskFilter,
  type Viewer,
} from '../domain';
import type { Connectors } from '../connectors/types';
import type { Summarizer } from '../derivation/summarizer';
import type { Decider, ReplyEstimator } from '../ingest/deciders';
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
  estimator: ReplyEstimator;
  summarizer?: Summarizer;
  connectors: Connectors;
  policy: DecisionPolicy;
}

export type IngestResult =
  | { status: 'duplicate'; signalId: string }
  | { status: 'merged'; derivationId: string }
  | { status: 'ignored' | 'attached' | 'created'; signalId: string; taskId: string | null; decidedBy: 'anchor' | 'ai' | 'human' };

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

  /** タスク ID から、Viewer の所属テナントのどれにあるかを探す */
  private async tenantOfTask(viewer: Viewer, taskId: string): Promise<string> {
    for (const m of viewer.memberships) {
      const p = await this.state(m.tenantId);
      if (p.tasks[taskId]) return m.tenantId;
    }
    throw new DomainError('not_found', `task ${taskId} not found`);
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
      if (prepared.kind === 'merged') return { events: [], result: { status: 'merged', derivationId: prepared.derivationId } };

      const { direction, payload } = prepared;
      const estimate = direction === 'out' ? await this.deps.estimator.estimate(payload, ctx.now) : undefined;
      const sigEvent = signalEvent(direction, payload, estimate);
      // シグナルを先に畳み込んだ状態で判断する（判断対象のシグナル自身を候補の文脈に含めないため、索引だけ使う）
      const withSignal = fold([{ ...sigEvent, tenantId, seq: p.lastSeq + 1, at: ctx.now }], p);
      const plan = planDecision(withSignal, ctx, direction, payload);

      let decided: { events: DraftEvent[]; taskId: string | null; decidedBy: 'anchor' | 'ai' | 'human' };
      if (plan.kind === 'decided') {
        decided = { events: plan.events, taskId: plan.taskId, decidedBy: 'anchor' };
      } else {
        const { raw, by } = await this.deps.decider.decide(plan.request);
        const fin = finalizeDecision(withSignal, ctx, plan.request, raw, by, this.deps.policy);
        decided = { ...fin, decidedBy: by };
      }
      const decision = decided.events[0];
      const kind = decision?.type === 'IngestDecided' ? decision.payload.decision.kind : 'ignore';
      return {
        events: [sigEvent, ...decided.events],
        result: {
          status: kind === 'ignore' ? 'ignored' : kind === 'attach' ? 'attached' : 'created',
          signalId: payload.signalId,
          taskId: decided.taskId,
          decidedBy: decided.decidedBy,
        },
      };
    });
  }

  // ---- 定期処理（Cron） ----

  /** ダミーを含む各コネクタから取り込む。資格情報（CredentialRef）ごとに pull する */
  async pollConnectors(): Promise<IngestResult[]> {
    const dir = await this.directory();
    const results: IngestResult[] = [];
    const seen = new Set<string>();
    for (const cred of dir.seed.credentialRefs) {
      const addr = dir.seed.addresses.find((a) => a.id === cred.addressId);
      const connector = addr ? this.deps.connectors[addr.channel] : undefined;
      if (!addr || !connector) continue;
      const key = `${cred.tenantId}|${addr.channel}|${JSON.stringify(cred.principal)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { signals } = await connector.pull(cred.principal, null);
      for (const s of signals) results.push(await this.ingest(cred.tenantId, s));
    }
    return results;
  }

  /** 返事期待の期限の見回り。冪等 */
  async checkOverdue(): Promise<number> {
    const dir = await this.directory();
    let count = 0;
    for (const tenantId of dir.tenantIds()) {
      count += await this.run(tenantId, (p, ctx) => {
        const events = scanOverdue(p, ctx.now);
        return { events, result: events.length };
      });
    }
    return count;
  }

  async tick(): Promise<{ ingested: number; overdue: number }> {
    const ingested = (await this.pollConnectors()).length;
    const overdue = await this.checkOverdue();
    return { ingested, overdue };
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
        lists: m.listIds.map((id) => ({ id, name: dir.list(id)?.name ?? id })),
      })),
    };
  }

  async listMyTasks(userId: string, filter: TaskFilter = 'open', tenantId?: string) {
    const { viewer } = await this.viewer(userId);
    const states = await Promise.all(viewer.memberships.map((m) => this.state(m.tenantId)));
    return listMyTasks(viewer, states, filter, tenantId);
  }

  async getTask(userId: string, taskId: string) {
    const { viewer, dir } = await this.viewer(userId);
    for (const m of viewer.memberships) {
      const view = getTaskView(dir, viewer, await this.state(m.tenantId), taskId);
      if (view) return view;
    }
    throw new DomainError('not_found', `task ${taskId} not found`);
  }

  async setAttribute(userId: string, input: { taskId: string; name: string; value: unknown }) {
    const { viewer } = await this.viewer(userId);
    const tenantId = await this.tenantOfTask(viewer, input.taskId);
    await this.run(tenantId, (p, ctx) => ({ events: setAttribute(p, viewer, ctx, input), result: undefined }));
    return this.getTask(userId, input.taskId);
  }

  async proposeDerivation(
    userId: string,
    input: {
      taskId: string;
      targetListId: string;
      title?: string;
      /** 省略時は instruction をもとに Claude が境界越えの要約を書く */
      body?: string;
      instruction?: string;
      attachments?: FileRef[];
      toPartyIds?: string[];
      replyExpected?: { by: string } | null;
      replyToDerivationId?: string;
    },
  ) {
    const { viewer } = await this.viewer(userId);
    const tenantId = await this.tenantOfTask(viewer, input.taskId);
    const derivationId = await this.run(tenantId, async (p, ctx) => {
      let body = input.body;
      if (!body) {
        const target = ctx.dir.list(input.targetListId);
        if (!this.deps.summarizer || !target) throw new DomainError('invalid', 'body is required');
        body = await this.deps.summarizer.summarize(p, input.taskId, target, input.instruction ?? '');
      }
      const { events, derivationId } = proposeDerivation(p, viewer, ctx, { ...input, body });
      return { events, result: derivationId };
    });
    const p = await this.state(tenantId);
    return derivationView(p.derivations[derivationId]!);
  }

  async listProposals(userId: string, listId?: string) {
    const { viewer } = await this.viewer(userId);
    const out = [];
    for (const m of viewer.memberships) {
      const p = await this.state(m.tenantId);
      for (const d of listProposalsFor(p, viewer, listId)) {
        // 確認項目: 本文・添付・宛先・返事期待
        out.push({ ...derivationView(d), sourceTaskTitle: p.tasks[d.sourceTaskId]?.title ?? '' });
      }
    }
    return out;
  }

  /** 承認（ユーザーの明示の指示でスタンドが呼ぶ）。外部派生はそのままコネクタで送る */
  async approveDerivation(userId: string, input: { derivationId: string; fromAddress?: AddressRef }) {
    const { viewer } = await this.viewer(userId);
    const tenantId = await this.tenantOf(viewer, (p) => !!p.derivations[input.derivationId], `derivation ${input.derivationId}`);
    const send = await this.run(tenantId, (p, ctx) => {
      const { events, send } = approveDerivation(p, viewer, ctx, input);
      return { events, result: send };
    });
    if (send) {
      const connector = this.deps.connectors[send.from.channel];
      if (!connector) throw new DomainError('invalid', `no connector for ${send.from.channel}`);
      const { sentRef } = await connector.send(send.principal, {
        from: send.from,
        to: send.to,
        subject: send.subject,
        body: send.body,
        attachments: send.attachments,
        inReplyTo: send.inReplyTo,
      });
      await this.run(tenantId, (p) => ({ events: recordSent(p, send.derivationId, sentRef), result: undefined }));
    }
    const p = await this.state(tenantId);
    return derivationView(p.derivations[input.derivationId]!);
  }

  async rejectDerivation(userId: string, input: { derivationId: string; reason: string }) {
    const { viewer } = await this.viewer(userId);
    const tenantId = await this.tenantOf(viewer, (p) => !!p.derivations[input.derivationId], `derivation ${input.derivationId}`);
    await this.run(tenantId, (p) => ({ events: rejectDerivation(p, viewer, input), result: undefined }));
    const p = await this.state(tenantId);
    return derivationView(p.derivations[input.derivationId]!);
  }

  async closeTask(userId: string, input: { taskId: string; reason?: string }) {
    const { viewer } = await this.viewer(userId);
    const tenantId = await this.tenantOfTask(viewer, input.taskId);
    await this.run(tenantId, (p) => ({ events: closeTask(p, viewer, input), result: undefined }));
    return this.getTask(userId, input.taskId);
  }

  async reopenTask(userId: string, input: { taskId: string }) {
    const { viewer } = await this.viewer(userId);
    const tenantId = await this.tenantOfTask(viewer, input.taskId);
    await this.run(tenantId, (p) => ({ events: reopenTask(p, viewer, input), result: undefined }));
    return this.getTask(userId, input.taskId);
  }

  async correctIngest(userId: string, input: { signalId: string; decision: CorrectionDecision; reason: string }) {
    const { viewer } = await this.viewer(userId);
    const tenantId = await this.tenantOf(viewer, (p) => !!p.signals[input.signalId], `signal ${input.signalId}`);
    await this.run(tenantId, (p, ctx) => ({ events: correctIngest(p, viewer, ctx, input), result: undefined }));
    const p = await this.state(tenantId);
    const s = p.signals[input.signalId]!;
    return { signalId: s.signalId, taskId: s.taskId, decision: s.decision };
  }

  async explainIgnore(userId: string, since?: string) {
    const { viewer, dir } = await this.viewer(userId);
    const out = [];
    for (const m of viewer.memberships) {
      out.push(...explainIgnore(dir, viewer, await this.state(m.tenantId), since).map((e) => ({ tenantId: m.tenantId, ...e })));
    }
    return out;
  }

  async getList(userId: string, listId: string) {
    const { viewer, dir } = await this.viewer(userId);
    const view = getListView(dir, viewer, listId);
    if (!view) throw new DomainError('not_found', `list ${listId} not found`);
    return view;
  }
}

