import type { MurmurService } from '../../app/service';
import type { ServiceDataSource } from '../../domain';
import type { ConnectorStateStore } from '../../store/connector-state';
import { GatewayAuthError } from '../../ports/gateway';
import type { SyncJob, SyncQueue } from '../graph/jobs';
import type { JiraCursor, SourceState } from '../graph/state';
import type { JiraApi } from './api';
import type { JiraComment, JiraIssue } from './issue';
import { itemsOfIssue, toUtc } from './normalize';
import { chunk, deltaJql, KEYS_PER_QUERY, minutesBefore, OVERLAP_MINUTES, planJiraMaintenance, WEBHOOK_EVENTS, webhookFilter } from './plan';

// Jira のキューの仕事（0034 の決定 3）。通知はヒントで、正は JQL の差分。位置（syncedUntil）は取り込みが終わってから進める。
// Graph と同じキューを使い、Jira の経路のデータソースだけを扱う。

/** 1 回の仕事で読む検索のページの上限。超えたら、そこまでで位置を進めて続きを積む */
export const MAX_PAGES_PER_JOB = 10;

export interface JiraSyncDeps {
  service: MurmurService;
  state: ConnectorStateStore;
  queue: SyncQueue;
  /** データソースの本人の同意で Jira を呼ぶ口を作る（issue_token する） */
  jiraFor(source: SourceState): Promise<JiraApi>;
  now(): string;
  /** 本人の Webhook の受け口（<PUBLIC_URL>/webhooks/jira/<本人ごとの秘密>）。なければ Webhook を使わない */
  webhookUrlFor?(userId: string): Promise<string>;
  log?(entry: Record<string, unknown>): void;
}

interface Ctx {
  source: SourceState;
  ds: ServiceDataSource & { connector: { kind: 'jira'; cloudId: string; site: string; jql: string } };
  api: JiraApi | null;
}

export class JiraSync {
  constructor(private readonly deps: JiraSyncDeps) {}

  async handle(job: SyncJob): Promise<void> {
    switch (job.kind) {
      case 'maintain': {
        let failed = 0;
        for (const s of await this.deps.state.sources()) {
          if (s.kind !== 'jira') continue;
          await this.guard(s.dataSourceId, (ctx) => this.maintain(ctx), { allowDisconnected: true }).catch((err: unknown) => {
            failed++;
            this.deps.log?.({ msg: 'jira_maintain_failed', dataSourceId: s.dataSourceId, error: String(err) });
          });
        }
        if (failed > 0) this.deps.log?.({ msg: 'jira_maintain_done', failed });
        return;
      }
      case 'setup':
        return this.guard(job.dataSourceId, (ctx) => this.setup(ctx));
      case 'jira-sync':
        return this.guard(job.dataSourceId, (ctx) => this.sync(ctx));
      case 'disconnect':
        return this.guard(job.dataSourceId, (ctx) => this.unregister(ctx), { allowDisconnected: true });
      default:
        return;
    }
  }

  /** 本人の Webhook の受け口に届いた通知: 本人の Jira のデータソースを取り直す（中身は使わない） */
  async notified(userId: string): Promise<number> {
    const targets = (await this.deps.state.sources()).filter((s) => s.kind === 'jira' && s.userId === userId && s.status === 'ok');
    for (const s of targets) await this.deps.queue.send({ kind: 'jira-sync', dataSourceId: s.dataSourceId });
    return targets.length;
  }

  private async guard(dataSourceId: string, run: (ctx: Ctx) => Promise<void>, opts: { allowDisconnected?: boolean } = {}): Promise<void> {
    const source = await this.deps.state.source(dataSourceId);
    if (!source || source.kind !== 'jira') return;
    if (source.status === 'disconnected' && !opts.allowDisconnected) return;
    const ds = (await this.deps.service.directory()).dataSource(dataSourceId);
    if (!ds || ds.kind !== 'service' || ds.connector?.kind !== 'jira') return;
    const ctx: Ctx = { source, ds: ds as Ctx['ds'], api: null };
    try {
      await run(ctx);
    } catch (err) {
      if (!(err instanceof GatewayAuthError)) throw err;
      const latest = (await this.deps.state.source(dataSourceId)) ?? source;
      await this.deps.state.putSource({ ...latest, status: 'broken', reason: err.message, lastRetryAt: this.deps.now() });
      this.deps.log?.({ msg: 'connector_broken', dataSourceId, reason: err.message });
    }
  }

  private async maintain(ctx: Ctx): Promise<void> {
    const plan = planJiraMaintenance(ctx.source, this.deps.now(), !!this.deps.webhookUrlFor);
    switch (plan.kind) {
      case 'idle':
        return;
      case 'cleanup':
        return this.unregister(ctx);
      case 'retry':
        await this.put(ctx, { lastRetryAt: this.deps.now() });
        return this.setup(ctx);
      case 'maintain':
        if (plan.register) await this.register(ctx);
        else if (plan.refresh) await this.refresh(ctx);
        if (plan.sync) await this.sync(ctx);
    }
  }

  /** つないだ直後・範囲を変えたあと・broken からの戻り: Webhook を登録し直し、差分を取って ok にする */
  private async setup(ctx: Ctx): Promise<void> {
    if (this.deps.webhookUrlFor) await this.register(ctx);
    await this.sync(ctx);
    await this.put(ctx, { status: 'ok', reason: null });
  }

  /** 今の Webhook を消して、範囲の jqlFilter で登録し直す。登録できなくても取り込みは見回りの差分で続く */
  private async register(ctx: Ctx): Promise<void> {
    const api = await this.api(ctx);
    const cursor = this.cursor(ctx);
    if (cursor.webhookIds.length > 0) await api.deleteWebhooks(ctx.ds.connector.cloudId, cursor.webhookIds);
    const url = await this.deps.webhookUrlFor!(ctx.source.userId);
    const filters = [...new Set([webhookFilter(ctx.ds.connector.jql), 'assignee = currentUser() OR reporter = currentUser()'])];
    let ids: number[] = [];
    for (const jqlFilter of filters) {
      const [r] = await api.registerWebhooks(ctx.ds.connector.cloudId, url, [{ events: WEBHOOK_EVENTS, jqlFilter }]);
      if (r && 'id' in r) {
        ids = [r.id];
        break;
      }
      this.deps.log?.({ msg: 'jira_webhook_rejected', dataSourceId: ctx.ds.id, jqlFilter, errors: r?.errors });
    }
    // 寿命は 30 日。延長の結果で正しい期限に置き換える
    const expiresAt = ids.length > 0 ? ((await api.refreshWebhooks(ctx.ds.connector.cloudId, ids)) ?? null) : null;
    await this.put(ctx, { jira: { ...this.cursor(ctx), webhookIds: ids, webhookExpiresAt: expiresAt } });
  }

  private async refresh(ctx: Ctx): Promise<void> {
    const cursor = this.cursor(ctx);
    const expiresAt = await (await this.api(ctx)).refreshWebhooks(ctx.ds.connector.cloudId, cursor.webhookIds);
    if (expiresAt) await this.put(ctx, { jira: { ...cursor, webhookExpiresAt: expiresAt } });
    else await this.register(ctx);
  }

  private async unregister(ctx: Ctx): Promise<void> {
    const cursor = ctx.source.jira;
    if (cursor && cursor.webhookIds.length > 0) await (await this.api(ctx)).deleteWebhooks(ctx.ds.connector.cloudId, cursor.webhookIds);
    if (cursor) await this.put(ctx, { jira: { ...cursor, webhookIds: [], webhookExpiresAt: null } });
  }

  /**
   * 範囲の差分（と開いているスレッドの課題）を取り込む。読み切れば位置を始めた時刻に進める。
   * ページの上限で止めたら、検索の位置を持ち越して続きを積む（同じ JQL で再開するので、読み直さない）
   */
  private async sync(ctx: Ctx): Promise<void> {
    const cursor = this.cursor(ctx);
    const resume = cursor.resume;
    const startedAt = resume?.startedAt ?? this.deps.now();
    const keys = resume?.keys ?? (await this.openKeys(ctx));
    const since = minutesBefore(cursor.syncedUntil, OVERLAP_MINUTES);
    const api = await this.api(ctx);
    const { cloudId, jql } = ctx.ds.connector;
    const batches = keys.length > 0 ? chunk(keys, KEYS_PER_QUERY) : [[]];
    let pages = 0;
    for (let b = resume?.batch ?? 0; b < batches.length; b++) {
      let token: string | undefined = (b === resume?.batch ? resume.nextPageToken : null) ?? undefined;
      const q = deltaJql(jql, batches[b]!, cursor.syncedUntil, startedAt);
      do {
        if (pages >= MAX_PAGES_PER_JOB) {
          await this.put(ctx, { jira: { ...this.cursor(ctx), resume: { startedAt, keys, batch: b, nextPageToken: token ?? null } } });
          await this.deps.queue.send({ kind: 'jira-sync', dataSourceId: ctx.ds.id });
          return;
        }
        const page = await api.search(cloudId, q, token);
        pages++;
        for (const issue of page.issues) await this.ingestIssue(ctx, issue, since);
        token = page.nextPageToken ?? undefined;
      } while (token);
    }
    const { resume: _done, ...rest } = this.cursor(ctx);
    await this.put(ctx, { jira: { ...rest, syncedUntil: startedAt }, lastSyncAt: startedAt });
  }

  private async ingestIssue(ctx: Ctx, issue: JiraIssue, since: string): Promise<void> {
    const comments = await this.commentsSince(ctx, issue.key, since);
    for (const item of itemsOfIssue(ctx.ds.id, issue, comments, since)) await this.deps.service.ingestItem(item);
  }

  /** 新しい順に読み、since より前に来たら止める */
  private async commentsSince(ctx: Ctx, key: string, since: string): Promise<JiraComment[]> {
    const api = await this.api(ctx);
    const out: JiraComment[] = [];
    let startAt = 0;
    for (;;) {
      const page = await api.comments(ctx.ds.connector.cloudId, key, startAt);
      let older = false;
      for (const c of page.comments) {
        if (toUtc(c.created) < since) older = true;
        else out.push(c);
      }
      startAt += page.comments.length;
      if (older || page.comments.length === 0 || startAt >= page.total) return out;
    }
  }

  /** 開いているスレッドの課題キー（片付けておらず、ソースで完了していないもの） */
  private async openKeys(ctx: Ctx): Promise<string[]> {
    const p = await this.deps.service.state();
    return Object.values(p.threads)
      .filter((t) => t.dataSourceId === ctx.ds.id && t.sourceKey && !t.dismissed && !t.closedAtSource)
      .map((t) => t.sourceKey!)
      .filter((k) => /^[A-Z][A-Z0-9_]*-\d+$/.test(k))
      .sort();
  }

  private cursor(ctx: Ctx): JiraCursor {
    return ctx.source.jira ?? { syncedUntil: ctx.source.connectedAt, webhookIds: [], webhookExpiresAt: null };
  }

  private async api(ctx: Ctx): Promise<JiraApi> {
    ctx.api ??= await this.deps.jiraFor(ctx.source);
    return ctx.api;
  }

  private async put(ctx: Ctx, patch: Partial<SourceState>) {
    ctx.source = { ...ctx.source, ...patch };
    await this.deps.state.putSource(ctx.source);
  }
}
