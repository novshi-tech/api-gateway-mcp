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
import { createApp } from './http/app';
import { d1Repo } from './store/d1';

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
}

const CHANNELS = ['email', 'slack', 'line', 'jira', 'bitbucket'] as const;

/** 組み立て（IO の配線）。D1 はバインディングなので接続を張ったり閉じたりしない */
function build(env: Env): MurmurService {
  const db = drizzle(env.DB);
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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const service = build(env);
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
    return app.fetch(request, env, ctx);
  },

  /** 取り込みのポーリングと期限の見回り */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const r = await build(env).tick();
    console.log(JSON.stringify({ msg: 'tick', ...r }));
  },
} satisfies ExportedHandler<Env>;
