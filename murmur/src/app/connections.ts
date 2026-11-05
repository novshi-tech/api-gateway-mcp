import { canDisconnect, connectJiraSource, connectorOwner, DomainError, connectMailbox, setJiraScope, type ServiceDataSource } from '../domain';
import { ConsentRequired, GatewayAuthError, type GatewayCredential, type GatewayPort, type UpstreamCall, type UpstreamKind } from '../ports/gateway';
import type { GraphApi } from '../connectors/graph/api';
import type { JiraApi, JiraSite } from '../connectors/jira/api';
import type { SyncQueue } from '../connectors/graph/jobs';
import type { SourceState } from '../connectors/graph/state';
import type { ConnectorStateStore, PendingAuthorization } from '../store/connector-state';
import type { MurmurService } from './service';

// 個人の箱をつなぐ（0024 の決定 3）。ゲートウェイとのやりとりは全部ゲートウェイの口（ports/gateway.ts。0023）を通す。
// 本人がスタンドから頼み、ゲートウェイの同意の画面で本体を許可すると、
// 本体はデータソースを実行時に作り（読者は本人 1 人）、キューにサブスクリプションと初回の delta を頼む。
// Jira（0034）も同じ同意で、ゲートウェイの jira の接続からサイトを選び、本人の JQL の範囲を個人リストにする。

/** 認可の途中の state の寿命 */
const PENDING_MINUTES = 15;

export interface ConnectionsDeps {
  gateway: GatewayPort;
  service: MurmurService;
  queue: SyncQueue;
  newId: (prefix: string) => string;
  graphFor(call: UpstreamCall): GraphApi;
  jiraFor(call: UpstreamCall): JiraApi;
  state: ConnectorStateStore;
  now: () => string;
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
    try {
      return await this.connectWithGrant(userId, await this.deps.gateway.credentials(userId, request.kind === 'jira' ? 'jira' : 'graph'), credentialId ?? undefined, request);
    } catch (err) {
      // 同意がない・取り消された・失効した: もう一度許可してもらう
      if (err instanceof ConsentRequired) return this.authorize(userId, credentialId, request);
      // 同意は有効で、選んだ接続そのものがゲートウェイでつなぎ直しを要る。Murmur の同意を取り直しても直らない
      if (err instanceof GatewayAuthError) throw new DomainError('conflict', `ゲートウェイでこの接続をつなぎ直してから、もう一度頼んでください（${err.message}）`);
      throw err;
    }
  }

  private async authorize(userId: string, credentialId: string | null, request: NonNullable<PendingAuthorization['request']>): Promise<ConnectResult> {
    const { url, state, secret } = await this.deps.gateway.consent.begin(userId);
    await this.deps.state.putPending({ state, userId, verifier: secret, credentialId, createdAt: this.deps.now(), request });
    return { status: 'authorize', authorize_url: url };
  }

  /**
   * ゲートウェイの同意の画面から戻ってきた。許可したのが頼んだ本人かを口が確かめてから保管する
   * （別の人がこの URL を開いて許可しても、その人の箱を頼んだ本人のデータソースにはしない）
   */
  async callback(input: { state: string | null; code: string | null; error: string | null }): Promise<CallbackResult> {
    if (!input.state) return { ok: false, message: '認可の state がありません。' };
    const notBefore = new Date(Date.parse(this.deps.now()) - PENDING_MINUTES * 60_000).toISOString();
    const pending = await this.deps.state.takePending(input.state, notBefore);
    if (!pending) return { ok: false, message: 'この認可は期限が切れたか、もう使われています。スタンドからもう一度つないでください。' };
    if (input.error || !input.code) return { ok: false, message: `ゲートウェイで許可されませんでした（${input.error ?? 'no code'}）。` };

    const request = pending.request ?? { kind: 'outlook' };
    const kind = this.kindOf(request);
    const label = kind === 'jira' ? 'Jira' : 'Microsoft Graph';
    const done = await this.deps.gateway.consent.complete({ userId: pending.userId, code: input.code, secret: pending.verifier, kind });
    if (done === 'no_credential') return { ok: false, message: `ゲートウェイに ${label} の接続がありません。ゲートウェイでつないでから、もう一度頼んでください。` };
    if (done === 'wrong_user') {
      return { ok: false, message: '許可したアカウントが、つなぐように頼んだ人と違います。本人のアカウントでもう一度許可してください。' };
    }
    const result = await this.connectWithGrant(pending.userId, await this.deps.gateway.credentials(pending.userId, kind), pending.credentialId ?? undefined, request);
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

  private kindOf(request: NonNullable<PendingAuthorization['request']>): UpstreamKind {
    return request.kind === 'jira' ? 'jira' : 'graph';
  }

  private async connectWithGrant(
    userId: string,
    /** 本人のゲートウェイの接続のうち、つなぐ種類のもの */
    creds: GatewayCredential[],
    credentialId: string | undefined,
    request: NonNullable<PendingAuthorization['request']>,
  ): Promise<ConnectResult> {
    const kind = this.kindOf(request);
    const chosen = credentialId ? creds.find((c) => c.id === credentialId) : creds.length === 1 ? creds[0] : undefined;
    if (credentialId && !chosen) throw new DomainError('not_found', `credential ${credentialId} はゲートウェイの ${kind} の接続にない`);
    if (creds.length === 0) return { status: 'no_credential', register_url: this.deps.gateway.homeUrl };
    if (!chosen) return { status: 'choose', credentials: creds };
    if (request.kind === 'jira') return this.connectJiraWith(userId, chosen.id, request);

    const me = await this.deps.graphFor(await this.deps.gateway.upstream(userId, chosen.id, 'graph')).me();
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
    const api = this.deps.jiraFor(await this.deps.gateway.upstream(userId, credentialId, 'jira'));
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
    if (!ds || !source) throw new DomainError('not_found', `connection ${dataSourceId} not found`);
    // 外せるのは、共有リストは作った人と管理者、個人のリストは本人（0037 の決定 4）。外せない人には、ないのと同じに見せる
    const admin = ds.kind === 'service' && !!ds.shared && (await this.deps.gateway.isAdmin(userId));
    if (!canDisconnect(dir.seed, dataSourceId, userId, admin)) throw new DomainError('not_found', `connection ${dataSourceId} not found`);
    const who = connectorOwner(dir.seed, ds) === userId ? '本人が外した' : admin ? '管理者が外した' : '作った人が外した';
    // Webhook の ID は消すまで残す（disconnect の仕事が消す）
    await this.deps.state.putSource({ ...source, status: 'disconnected', reason: who, folders: {} });
    await this.deps.queue.send({ kind: 'disconnect', dataSourceId });
    return this.list(userId);
  }
}

export type CallbackResult = { ok: boolean; message: string };
