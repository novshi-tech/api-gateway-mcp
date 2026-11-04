import { drizzle } from 'drizzle-orm/d1';
import type { Fetcher } from './connectors/gateway/http';
import { clientMetadata, GatewayOAuth } from './connectors/gateway/oauth';
import { identityAuthenticator, RemoteGateway } from './connectors/gateway/remote';
import type { SyncJob } from './connectors/graph/jobs';
import { GRAPH_SCOPE } from './connectors/graph/scope';
import { JIRA_SCOPE } from './connectors/jira/api';
import { SecretBox } from './connectors/secrets';
import { createMurmur, type MurmurConfig } from './feature';
import { D1ConnectorState } from './store/connector-state';
import type { Db } from './store/d1';

// 単独の Worker の入口（ゲートウェイは別の Worker。0023 の段取り 4 で UBS を移すまで残す）。
// env を読むのはここだけで、組み立ては feature.ts。

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

/** 本体の API のトークンの確かめ方（ゲートウェイの identity の JWT） */
function identityOf(env: Env) {
  return env.GATEWAY_JWKS ? { jwks: JSON.parse(env.GATEWAY_JWKS) as unknown, audience: env.IDENTITY_AUDIENCE, issuer: env.IDENTITY_ISSUER || undefined } : undefined;
}

const now = () => new Date().toISOString();

/** 外部コネクタ（0024）は PUBLIC_URL と TOKEN_KEY とゲートウェイの URL があるときだけ */
async function connectorsOf(env: Env): Promise<MurmurConfig['connectors']> {
  const gatewayUrl = env.GATEWAY_URL || env.IDENTITY_ISSUER;
  if (!env.PUBLIC_URL || !env.TOKEN_KEY || !gatewayUrl) return undefined;
  const publicUrl = env.PUBLIC_URL.replace(/\/+$/, '');
  const fetcher: Fetcher = env.GATEWAY_WEB ? (url, init) => env.GATEWAY_WEB!.fetch(url, init) : (url, init) => fetch(url, init);
  const oauthConfig = { gatewayUrl, publicUrl };
  // ゲートウェイの口（0023）。読める口は種類ごとにここで固定する
  const gateway = new RemoteGateway({
    fetcher,
    oauth: new GatewayOAuth(oauthConfig, fetcher, now),
    oauthConfig,
    state: new D1ConnectorState(drizzle(env.DB) as Db),
    box: await SecretBox.fromBase64(env.TOKEN_KEY),
    now,
    identity: identityOf(env),
    kinds: {
      graph: { service: env.GRAPH_SERVICE || 'graph', scope: GRAPH_SCOPE },
      jira: { service: env.JIRA_SERVICE || 'jira', scope: JIRA_SCOPE },
    },
  });
  return { publicUrl, gateway, webhookKey: env.TOKEN_KEY, clientMetadata: clientMetadata(oauthConfig) };
}

async function murmur(env: Env) {
  const config: MurmurConfig = {
    db: env.DB,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    claudeModel: env.CLAUDE_MODEL,
    recentThreadLimit: env.RECENT_THREAD_LIMIT ? Number(env.RECENT_THREAD_LIMIT) : undefined,
    webhookSecret: env.WEBHOOK_SECRET,
    timelineToken: env.TIMELINE_TOKEN,
    queue: env.SYNC_QUEUE,
    connectors: await connectorsOf(env),
  };
  return createMurmur(config, identityAuthenticator(identityOf(env), now));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return (await murmur(env)).fetch(request, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return (await murmur(env)).scheduled(ctx);
  },
  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext): Promise<void> {
    return (await murmur(env)).queue(batch, ctx);
  },
} satisfies ExportedHandler<Env>;
