import { connectJiraSource, connectorOwner, DomainError, connectMailbox, setJiraScope, type ServiceDataSource } from '../domain';
import { GatewayUser, issueToken, listCredentials, type GatewayCredential, type GatewayUserDeps } from '../connectors/gateway/client';
import { GatewayAuthError } from '../connectors/gateway/http';
import { authorizeUrl, type GatewayOAuth, type GatewayOAuthConfig } from '../connectors/gateway/oauth';
import type { GraphApi } from '../connectors/graph/api';
import type { JiraApi, JiraSite } from '../connectors/jira/api';
import type { SyncQueue } from '../connectors/graph/jobs';
import type { SourceState } from '../connectors/graph/state';
import { randomHex, s256 } from '../connectors/secrets';
import type { ConnectorStateStore, PendingAuthorization } from '../store/connector-state';
import type { MurmurService } from './service';

// 個人の箱をつなぐ（0024 の決定 3）。本人がスタンドから頼み、ゲートウェイの同意の画面で本体を許可すると、
// 本体はデータソースを実行時に作り（読者は本人 1 人）、キューにサブスクリプションと初回の delta を頼む。
// Jira（0034）も同じ同意で、ゲートウェイの jira の接続からサイトを選び、本人の JQL の範囲を個人リストにする。

/** 認可の途中の state の寿命 */
const PENDING_MINUTES = 15;

export interface ConnectionsDeps extends GatewayUserDeps {
  service: MurmurService;
  oauthConfig: GatewayOAuthConfig;
  oauth: GatewayOAuth;
  queue: SyncQueue;
  newId: (prefix: string) => string;
  /** ゲートウェイの Microsoft Graph の接続先の名前 */
  graphService: string;
  graphFor(token: { token: string; baseUrl: string }): GraphApi;
  /** ゲートウェイの Jira の接続先の名前 */
  jiraService: string;
  jiraFor(token: { token: string; baseUrl: string }): JiraApi;
  state: ConnectorStateStore;
}

export type ConnectResult =
  /** 本人がこの URL を開いて、ゲートウェイの同意の画面で本体を許可する */
  | { status: 'authorize'; authorize_url: string }
  /** ゲートウェイに Graph の接続が複数ある。credential_id を選んでもう一度呼ぶ */
  | { status: 'choose'; credentials: GatewayCredential[] }
  /** ゲートウェイに Graph の接続がない。本人がゲートウェイでつないでからもう一度 */
  | { status: 'no_credential'; register_url: string }
  /** Jira: 接続が複数のサイトに届く。site を選んでもう一度 */
  | { status: 'choose_site'; sites: JiraSite[] }
  | { status: 'connected'; data_source: { id: string; name: string }; created: boolean };

export interface ConnectJiraInput {
  credentialId?: string;
  /** サイトの cloudId（accessible-resources の id） */
  cloudId?: string;
  /** 範囲の JQL（省けば担当・起票・ウォッチ） */
  jql?: string;
}

export interface ConnectionView {
  data_source: string;
  name: string;
  kind: 'outlook' | 'jira';
  /** Jira: サイトと範囲の JQL */
  site?: string;
  jql?: string;
  status: SourceState['status'];
  reason: string | null;
  connected_at: string;
  last_sync_at: string | null;
}

export class Connections {
  constructor(private readonly deps: ConnectionsDeps) {}

  private user(userId: string) {
    return new GatewayUser(this.deps, userId);
  }

  /** つなぐ。同意がまだなら認可の URL を返し、あればゲートウェイの接続を選んでデータソースを作る（何度呼んでもよい） */
  async connectOutlook(userId: string, credentialId?: string): Promise<ConnectResult> {
    return this.connect(userId, credentialId ?? null, { kind: 'outlook' });
  }

  /** Jira をつなぐ（0034 の決定 1）。同意は Outlook と同じもの */
  async connectJira(userId: string, input: ConnectJiraInput = {}): Promise<ConnectResult> {
    return this.connect(userId, input.credentialId ?? null, { kind: 'jira', cloudId: input.cloudId, jql: input.jql });
  }

  private async connect(userId: string, credentialId: string | null, request: NonNullable<PendingAuthorization['request']>): Promise<ConnectResult> {
    const dir = await this.deps.service.directory();
    if (!dir.seed.users.some((u) => u.id === userId)) throw new DomainError('forbidden', `user ${userId} はまだサインインしていない`);
    if (await this.deps.state.grant(userId)) {
      try {
        return await this.connectWithGrant(userId, await this.user(userId).listCredentials(), credentialId ?? undefined, request);
      } catch (err) {
        // 同意が取り消された・失効した: もう一度許可してもらう
        if (!(err instanceof GatewayAuthError)) throw err;
        await this.deps.state.deleteGrant(userId);
      }
    }
    return this.authorize(userId, credentialId, request);
  }

  private async authorize(userId: string, credentialId: string | null, request: NonNullable<PendingAuthorization['request']>): Promise<ConnectResult> {
    const state = randomHex(24);
    const verifier = randomHex(32);
    await this.deps.state.putPending({ state, userId, verifier, credentialId, createdAt: this.deps.now(), request });
    return { status: 'authorize', authorize_url: authorizeUrl(this.deps.oauthConfig, { state, codeChallenge: await s256(verifier) }) };
  }

  /**
   * ゲートウェイの同意の画面から戻ってきた。コードをトークンに換え、許可したのが頼んだ本人かを確かめてから保管する
   * （別の人がこの URL を開いて許可しても、その人の箱を頼んだ本人のデータソースにはしない）
   */
  async callback(input: { state: string | null; code: string | null; error: string | null }): Promise<CallbackResult> {
    if (!input.state) return { ok: false, message: '認可の state がありません。' };
    const notBefore = new Date(Date.parse(this.deps.now()) - PENDING_MINUTES * 60_000).toISOString();
    const pending = await this.deps.state.takePending(input.state, notBefore);
    if (!pending) return { ok: false, message: 'この認可は期限が切れたか、もう使われています。スタンドからもう一度つないでください。' };
    if (input.error || !input.code) return { ok: false, message: `ゲートウェイで許可されませんでした（${input.error ?? 'no code'}）。` };

    const request = pending.request ?? { kind: 'outlook' };
    const label = request.kind === 'jira' ? `Jira（${this.deps.jiraService}）` : `Microsoft Graph（${this.deps.graphService}）`;
    const tokens = await this.deps.oauth.exchange(input.code, pending.verifier);
    const all = await listCredentials(this.deps.fetcher, this.deps.gatewayUrl, tokens.accessToken);
    // 本人の確かめ: ゲートウェイの短命トークンの sub がゲートウェイの User。つなぐサービスの接続で確かめる
    const probe = all.find((c) => c.service === this.serviceOf(request))?.id;
    if (!probe) return { ok: false, message: `ゲートウェイに ${label} の接続がありません。ゲートウェイでつないでから、もう一度頼んでください。` };
    const issued = await issueToken(this.deps.fetcher, this.deps.gatewayUrl, tokens.accessToken, [probe]);
    if (issued.userId !== pending.userId) {
      return { ok: false, message: '許可したアカウントが、つなぐように頼んだ人と違います。本人のアカウントでもう一度許可してください。' };
    }
    await GatewayUser.save(this.deps, pending.userId, tokens);
    const result = await this.connectWithGrant(pending.userId, all, pending.credentialId ?? undefined, request);
    switch (result.status) {
      case 'connected':
        return {
          ok: true,
          message:
            request.kind === 'jira'
              ? `${result.data_source.name} をつなぎました。これから更新される課題を取り込みます（過去のコメントは取りません）。`
              : `${result.data_source.name} をつなぎました。これから届くメールを取り込みます（過去のメールは取りません）。`,
        };
      case 'choose':
        return { ok: true, message: `ゲートウェイに ${label} の接続が複数あります。スタンドに戻って、どれをつなぐか選んでください。` };
      case 'choose_site':
        return { ok: true, message: 'Jira のサイトが複数あります。スタンドに戻って、どのサイトをつなぐか選んでください。' };
      default:
        return { ok: false, message: 'つなげませんでした。スタンドからもう一度頼んでください。' };
    }
  }

  private serviceOf(request: NonNullable<PendingAuthorization['request']>): string {
    return request.kind === 'jira' ? this.deps.jiraService : this.deps.graphService;
  }

  private async connectWithGrant(
    userId: string,
    all: GatewayCredential[],
    credentialId: string | undefined,
    request: NonNullable<PendingAuthorization['request']>,
  ): Promise<ConnectResult> {
    const service = this.serviceOf(request);
    const creds = all.filter((c) => c.service === service);
    const chosen = credentialId ? creds.find((c) => c.id === credentialId) : creds.length === 1 ? creds[0] : undefined;
    if (credentialId && !chosen) throw new DomainError('not_found', `credential ${credentialId} はゲートウェイの ${service} の接続にない`);
    if (creds.length === 0) return { status: 'no_credential', register_url: `${this.deps.gatewayUrl.replace(/\/+$/, '')}/` };
    if (!chosen) return { status: 'choose', credentials: creds };
    if (request.kind === 'jira') return this.connectJiraWith(userId, chosen.id, request);

    const issued = await this.user(userId).issueToken([chosen.id]);
    const me = await this.deps.graphFor(issued).me();
    const { result: plan } = await this.deps.service.changeMaster(userId, 'Outlook をつなぐ', (d, ctx) =>
      connectMailbox(d, ctx, { userId, gatewayCredentialId: chosen.id, displayName: me.displayName, addresses: me.addresses }),
    );

    const ds = plan.dataSource;
    const current = await this.deps.state.source(ds.id);
    if (!current || current.status !== 'ok') {
      await this.deps.state.putSource({
        kind: 'outlook',
        dataSourceId: ds.id,
        userId,
        gatewayCredentialId: chosen.id,
        status: 'setup',
        reason: null,
        // 外したあとのつなぎ直しも、その時点から取る（間の分は取らない）
        folders: current?.status === 'broken' ? current.folders : {},
        connectedAt: current?.status === 'broken' ? current.connectedAt : this.deps.now(),
        lastSyncAt: current?.lastSyncAt ?? null,
        lastRetryAt: null,
      });
      await this.deps.queue.send({ kind: 'setup', dataSourceId: ds.id });
    }
    return { status: 'connected', data_source: { id: ds.id, name: ds.name }, created: plan.kind === 'created' };
  }

  private async connectJiraWith(userId: string, credentialId: string, request: { kind: 'jira'; cloudId?: string; jql?: string }): Promise<ConnectResult> {
    const issued = await this.user(userId).issueToken([credentialId]);
    const api = this.deps.jiraFor(issued);
    const sites = await api.sites();
    const site = request.cloudId ? sites.find((s) => s.id === request.cloudId) : sites.length === 1 ? sites[0] : undefined;
    if (request.cloudId && !site) throw new DomainError('not_found', `site ${request.cloudId} はこの Jira の接続から届かない`);
    if (!site) {
      if (sites.length === 0) throw new DomainError('conflict', 'この Jira の接続から届くサイトがない');
      return { status: 'choose_site', sites };
    }
    const me = await api.myself(site.id);
    const { result: plan } = await this.deps.service.changeMaster(userId, 'Jira をつなぐ', (d, ctx) =>
      connectJiraSource(d, ctx, {
        userId,
        gatewayCredentialId: credentialId,
        cloudId: site.id,
        site: site.url,
        siteName: site.name,
        accountId: me.accountId,
        displayName: me.displayName,
        jql: request.jql,
      }),
    );
    const ds = plan.dataSource;
    const current = await this.deps.state.source(ds.id);
    if (!current || current.status !== 'ok') {
      const now = this.deps.now();
      await this.deps.state.putSource({
        kind: 'jira',
        dataSourceId: ds.id,
        userId,
        gatewayCredentialId: credentialId,
        status: 'setup',
        reason: null,
        folders: {},
        // 外したあとのつなぎ直しも、その時点から取る（間の分は取らない）。broken からの戻りは続きから
        jira: current?.status === 'broken' && current.jira ? current.jira : { syncedUntil: now, webhookIds: current?.jira?.webhookIds ?? [], webhookExpiresAt: null },
        connectedAt: current?.status === 'broken' ? current.connectedAt : now,
        lastSyncAt: current?.lastSyncAt ?? null,
        lastRetryAt: null,
      });
      await this.deps.queue.send({ kind: 'setup', dataSourceId: ds.id });
    }
    return { status: 'connected', data_source: { id: ds.id, name: ds.name }, created: plan.kind === 'created' };
  }

  /** Jira の範囲の JQL を変える（0034 の決定 2）。Webhook を登録し直し、新しい範囲で取り直す。過去のスレッドは消さない */
  async setJiraScope(userId: string, dataSourceId: string, jql: string): Promise<ConnectionView[]> {
    const source = await this.deps.state.source(dataSourceId);
    if (!source || source.kind !== 'jira') throw new DomainError('not_found', `connection ${dataSourceId} not found`);
    await this.deps.service.changeMaster(userId, 'Jira の範囲を変える', (d) => setJiraScope(d, userId, dataSourceId, jql));
    if (source.status === 'ok') {
      await this.deps.state.putSource({ ...source, status: 'setup' });
      await this.deps.queue.send({ kind: 'setup', dataSourceId });
    }
    return this.list(userId);
  }

  async list(userId: string): Promise<ConnectionView[]> {
    const dir = await this.deps.service.directory();
    const sources = (await this.deps.state.sources()).filter((s) => s.userId === userId);
    return sources.map((s) => {
      const ds = dir.dataSource(s.dataSourceId) as ServiceDataSource | undefined;
      const jira = ds?.connector?.kind === 'jira' ? ds.connector : undefined;
      return {
        data_source: s.dataSourceId,
        name: ds?.name ?? s.dataSourceId,
        kind: s.kind ?? ('outlook' as const),
        ...(jira ? { site: jira.site, jql: jira.jql } : {}),
        status: s.status,
        reason: s.reason,
        connected_at: s.connectedAt,
        last_sync_at: s.lastSyncAt,
      };
    });
  }

  /** 外す。サブスクリプションを消し、cursor を捨てる。スレッドとデータソースは残る（読者はそのまま読める） */
  async disconnect(userId: string, dataSourceId: string): Promise<ConnectionView[]> {
    const dir = await this.deps.service.directory();
    const ds = dir.dataSource(dataSourceId);
    const source = await this.deps.state.source(dataSourceId);
    if (!ds || !source || connectorOwner(dir.seed, ds) !== userId) throw new DomainError('not_found', `connection ${dataSourceId} not found`);
    // Webhook の ID は消すまで残す（disconnect の仕事が消す）
    await this.deps.state.putSource({ ...source, status: 'disconnected', reason: '本人が外した', folders: {} });
    await this.deps.queue.send({ kind: 'disconnect', dataSourceId });
    return this.list(userId);
  }
}

export type CallbackResult = { ok: boolean; message: string };
