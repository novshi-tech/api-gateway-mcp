import Anthropic from '@anthropic-ai/sdk';
import { drizzle } from 'drizzle-orm/d1';
import { MurmurService, randomIds, systemClock } from './app/service';
import { DEFAULT_POLICY } from './domain';
import { verifyIdentity, verifyWebhookSignature } from './auth/identity';
import { DummyConnector } from './connectors/dummy/connector';
import { D1DummyBackend } from './connectors/dummy/d1-backend';
import type { Connectors } from './connectors/types';
import { AiDecider } from './ingest/deciders';
import { AnthropicLlm } from './ingest/llm';
import { createApp, type ConnectorHttp } from './http/app';
import { d1Repo, type Db } from './store/d1';
import { Connections } from './app/connections';
import { GatewayUser } from './connectors/gateway/client';
import type { Fetcher } from './connectors/gateway/http';
import { clientMetadata, GatewayOAuth } from './connectors/gateway/oauth';
import { GatewayGraphApi } from './connectors/graph/api';
import { SyncJob, type SyncQueue } from './connectors/graph/jobs';
import { jobsFromNotifications } from './connectors/graph/notifications';
import { GraphMailSync } from './connectors/graph/sync';
import { GatewayJiraApi } from './connectors/jira/api';
import { JiraSync } from './connectors/jira/sync';
import { randomHex, SecretBox, sha256Hex } from './connectors/secrets';
import { D1ConnectorState } from './store/connector-state';

export interface Env {
  /** 本体の D1（0021） */
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  WEBHOOK_SECRET: string;
  TIMELINE_TOKEN?: string;
  CLAUDE_MODEL: string;
  /** 区切りの AI 判断に渡す直近のスレッドの本数 */
  RECENT_THREAD_LIMIT?: string;
  IDENTITY_AUDIENCE: string;
  /** ゲートウェイの PUBLIC_URL。設定すれば iss を確かめる */
  IDENTITY_ISSUER?: string;
  /** ゲートウェイの公開鍵（<gateway>/.well-known/jwks.json の中身の JSON 文字列） */
  GATEWAY_JWKS: string;

  // ---- 外部コネクタ（0024）。PUBLIC_URL と TOKEN_KEY がなければ使わない ----
  /** 本体の公開 URL（Graph の通知の受け口と、OAuth のクライアントのメタデータの URL になる） */
  PUBLIC_URL?: string;
  /** ゲートウェイの PUBLIC_URL。なければ IDENTITY_ISSUER */
  GATEWAY_URL?: string;
  /** ゲートウェイのリフレッシュトークンを包む鍵（32 バイトの base64） */
  TOKEN_KEY?: string;
  /** ゲートウェイの Microsoft Graph の接続先の名前（既定 graph） */
  GRAPH_SERVICE?: string;
  /** ゲートウェイの Jira の接続先の名前（省けば jira。0034） */
  JIRA_SERVICE?: string;
  /** 取り込みのキュー（同時実行 1）。なければその場で処理する（ローカルの確認用） */
  SYNC_QUEUE?: Queue<SyncJob>;
  /** ゲートウェイのデフォルトの入口への Service Binding。あれば公開 URL への fetch の代わりに使う */
  GATEWAY_WEB?: { fetch: typeof fetch };
}

const CHANNELS = ['email', 'slack', 'line', 'jira', 'bitbucket'] as const;

/** 組み立て（IO の配線）。D1 はバインディングなので接続を張ったり閉じたりしない */
function build(env: Env): MurmurService {
  const db = drizzle(env.DB) as Db;
  const llm = new AnthropicLlm(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }));
  const backend = new D1DummyBackend(db);
  const connectors: Connectors = Object.fromEntries(
    CHANNELS.map((ch) => [ch, new DummyConnector(ch, backend)]),
  );
  return new MurmurService({
    repo: d1Repo(db),
    clock: systemClock,
    newId: randomIds,
    decider: new AiDecider(llm, env.CLAUDE_MODEL),
    connectors,
    policy: {
      recentThreadLimit: Number(env.RECENT_THREAD_LIMIT ?? DEFAULT_POLICY.recentThreadLimit),
    },
  });
}

interface ConnectorShell extends ConnectorHttp {
  /** キューの仕事を Outlook と Jira の両方に渡す（それぞれ自分の経路のデータソースだけ扱う） */
  sync: { handle(job: SyncJob): Promise<void> };
}

/** 外部コネクタの配線。ゲートウェイを呼ぶ仕事は全部 queue を通す（Queues がなければ waitUntil でその場で） */
async function buildConnectors(env: Env, service: MurmurService, waitUntil: (p: Promise<unknown>) => void): Promise<ConnectorShell | null> {
  const gatewayUrl = env.GATEWAY_URL || env.IDENTITY_ISSUER;
  if (!env.PUBLIC_URL || !env.TOKEN_KEY || !gatewayUrl) return null;
  const publicUrl = env.PUBLIC_URL.replace(/\/+$/, '');
  const fetcher: Fetcher = env.GATEWAY_WEB ? (url, init) => env.GATEWAY_WEB!.fetch(url, init) : (url, init) => fetch(url, init);
  const now = () => new Date().toISOString();
  const state = new D1ConnectorState(drizzle(env.DB) as Db);
  const box = await SecretBox.fromBase64(env.TOKEN_KEY);
  const oauthConfig = { gatewayUrl, publicUrl };
  const oauth = new GatewayOAuth(oauthConfig, fetcher, now);
  const graphService = env.GRAPH_SERVICE || 'graph';
  const gatewayDeps = { fetcher, gatewayUrl, oauth, state, box, now };
  const graphFor = (t: { token: string; baseUrl: string }) => new GatewayGraphApi(fetcher, t.baseUrl, t.token, graphService);

  const jiraService = env.JIRA_SERVICE || 'jira';
  const jiraFor = (t: { token: string; baseUrl: string }) => new GatewayJiraApi(fetcher, t.baseUrl, t.token, jiraService);
  // Jira の Webhook の受け口の秘密（本人ごと。S0: REST の Webhook の URL は本人ごとに 1 つ）。TOKEN_KEY から導くので保管しない
  const jiraSecret = (userId: string) => sha256Hex(`${env.TOKEN_KEY}:jira-webhook:${userId}`);

  let sync: ConnectorShell['sync'];
  const queue: SyncQueue = env.SYNC_QUEUE
    ? { send: async (job) => void (await env.SYNC_QUEUE!.send(job)) }
    : { send: async (job) => waitUntil(sync.handle(job).catch((err) => console.error(JSON.stringify({ msg: 'sync_failed', job, error: String(err) })))) };
  const log = (entry: Record<string, unknown>) => console.log(JSON.stringify(entry));
  const issuedFor = (source: { userId: string; gatewayCredentialId: string }) => new GatewayUser(gatewayDeps, source.userId).issueToken([source.gatewayCredentialId]);
  const jira = new JiraSync({
    service,
    state,
    queue,
    jiraFor: async (source) => jiraFor(await issuedFor(source)),
    now,
    webhookUrlFor: async (userId) => `${publicUrl}/webhooks/jira/${await jiraSecret(userId)}`,
    log,
  });
  const graph = new GraphMailSync({
    service,
    state,
    queue,
    graphFor: async (source) => graphFor(await issuedFor(source)),
    now,
    notificationUrl: `${publicUrl}/webhooks/graph`,
    newClientState: () => randomHex(32),
    hash: sha256Hex,
    log,
  });
  sync = {
    async handle(job) {
      await graph.handle(job);
      await jira.handle(job);
    },
  };
  const connections = new Connections({ ...gatewayDeps, service, oauthConfig, queue, newId: randomIds, graphService, graphFor, jiraService, jiraFor });
  return {
    sync,
    connections,
    clientMetadata: clientMetadata(oauthConfig),
    notifications: async (body) => {
      const { jobs, rejected } = await jobsFromNotifications(body, { subscription: (id) => state.subscription(id), hash: sha256Hex });
      if (rejected > 0) console.warn(JSON.stringify({ msg: 'graph_notification_rejected', rejected }));
      for (const job of jobs) await queue.send(job);
      return jobs.length;
    },
    jiraNotified: async (secret, body) => {
      const users = [...new Set((await state.sources()).filter((s) => s.kind === 'jira').map((s) => s.userId))];
      for (const userId of users) {
        if ((await jiraSecret(userId)) !== secret) continue;
        // 本文の形を確かめるため、キーと種類だけ残す（0034 の S0 の残り。中身は使わない）
        const b = (body ?? {}) as Record<string, unknown>;
        log({ msg: 'jira_webhook', keys: Object.keys(b).sort(), webhookEvent: b.webhookEvent, matchedWebhookIds: b.matchedWebhookIds });
        return jira.notified(userId);
      }
      console.warn(JSON.stringify({ msg: 'jira_webhook_rejected' }));
      return null;
    },
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const service = build(env);
    let shell: Promise<ConnectorShell | null> | undefined;
    const app = createApp({
      service: () => service,
      authenticate: async (token) => {
        if (!env.GATEWAY_JWKS) return null;
        const r = await verifyIdentity(
          token,
          JSON.parse(env.GATEWAY_JWKS),
          { audience: env.IDENTITY_AUDIENCE, issuer: env.IDENTITY_ISSUER || undefined },
          Math.floor(Date.now() / 1000),
        );
        return r.ok ? r.sub : null;
      },
      webhookVerify: (body, sig) => (env.WEBHOOK_SECRET ? verifyWebhookSignature(body, sig, env.WEBHOOK_SECRET) : Promise.resolve(false)),
      timelineToken: env.TIMELINE_TOKEN,
      connectors: () => (shell ??= buildConnectors(env, service, (p) => ctx.waitUntil(p))),
    });
    return app.fetch(request, env, ctx);
  },

  /** 取り込みのポーリングと期限の見回り。外部コネクタはサブスクリプションの手入れと保険の delta をキューに頼む */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const service = build(env);
    const r = await service.tick();
    console.log(JSON.stringify({ msg: 'tick', ...r }));
    const shell = await buildConnectors(env, service, (p) => ctx.waitUntil(p));
    if (shell) await (env.SYNC_QUEUE ? env.SYNC_QUEUE.send({ kind: 'maintain' }) : shell.sync.handle({ kind: 'maintain' }));
  },

  /** 取り込みのキュー（同時実行 1）。失敗した仕事はキューが試し直す */
  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext): Promise<void> {
    const service = build(env);
    const shell = await buildConnectors(env, service, (p) => ctx.waitUntil(p));
    for (const message of batch.messages) {
      const job = SyncJob.safeParse(message.body);
      if (!shell || !job.success) {
        message.ack();
        continue;
      }
      try {
        await shell.sync.handle(job.data);
        message.ack();
      } catch (err) {
        console.error(JSON.stringify({ msg: 'sync_failed', job: job.data, error: String(err) }));
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
