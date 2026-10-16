import Anthropic from '@anthropic-ai/sdk';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { MurmurService, randomIds, systemClock } from './app/service';
import { verifyIdentity, verifyWebhookSignature } from './auth/identity';
import { DummyConnector } from './connectors/dummy/connector';
import { PgDummyBackend } from './connectors/dummy/pg-backend';
import type { Connectors } from './connectors/types';
import { AiSummarizer } from './derivation/summarizer';
import { AiDecider, AiReplyEstimator } from './ingest/deciders';
import { AnthropicLlm } from './ingest/llm';
import { createApp } from './http/app';
import { pgRepo, type Db } from './store/drizzle';

export interface Env {
  DATABASE_URL: string;
  ANTHROPIC_API_KEY: string;
  WEBHOOK_SECRET: string;
  TIMELINE_TOKEN?: string;
  CLAUDE_MODEL: string;
  IGNORE_CONFIDENCE_THRESHOLD: string;
  IDENTITY_AUDIENCE: string;
  /** ゲートウェイの PUBLIC_URL。設定すれば iss を確かめる */
  IDENTITY_ISSUER?: string;
  /** ゲートウェイの公開鍵（<gateway>/.well-known/jwks.json の中身の JSON 文字列） */
  GATEWAY_JWKS: string;
  /** "true" なら、ダミーコネクタが送ったメッセージを observed-sent として折り返す */
  DUMMY_ECHO_OBSERVED?: string;
}

const CHANNELS = ['email', 'slack', 'line', 'jira', 'bitbucket'] as const;

/** 組み立て（IO の配線）。Neon への接続はリクエスト・Cron 実行ごとに張る */
function build(env: Env): { service: MurmurService; close: () => Promise<void> } {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle(pool) as unknown as Db;
  const llm = new AnthropicLlm(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }));
  const backend = new PgDummyBackend(db);
  const connectors: Connectors = Object.fromEntries(
    CHANNELS.map((ch) => [ch, new DummyConnector(ch, backend, { echoObserved: env.DUMMY_ECHO_OBSERVED === 'true' })]),
  );
  const service = new MurmurService({
    repo: pgRepo(db),
    clock: systemClock,
    newId: randomIds,
    decider: new AiDecider(llm, env.CLAUDE_MODEL),
    estimator: new AiReplyEstimator(llm, env.CLAUDE_MODEL),
    summarizer: new AiSummarizer(llm, env.CLAUDE_MODEL),
    connectors,
    policy: { ignoreThreshold: Number(env.IGNORE_CONFIDENCE_THRESHOLD) },
  });
  return { service, close: () => pool.end() };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { service, close } = build(env);
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
    });
    try {
      return await app.fetch(request, env, ctx);
    } finally {
      ctx.waitUntil(close());
    }
  },

  /** 取り込みのポーリングと期限の見回り */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const { service, close } = build(env);
    try {
      const r = await service.tick();
      console.log(JSON.stringify({ msg: 'tick', ...r }));
    } finally {
      ctx.waitUntil(close());
    }
  },
} satisfies ExportedHandler<Env>;
