import Anthropic from '@anthropic-ai/sdk';
import { canonicalJson } from '../domain';

// Claude 呼び出しの境界。Claude API の呼び出しは必ずこの層（記録・再生）を通す。

export type LlmPurpose = 'ingest_decision' | 'reply_estimate' | 'boundary_summary';

export interface LlmRequest {
  purpose: LlmPurpose;
  model: string;
  system: string;
  user: string;
  /** 構造化出力の JSON Schema。省略時はテキスト */
  schema?: Record<string, unknown>;
  maxTokens?: number;
}

export interface LlmClient {
  /** 構造化出力なら JSON 文字列、そうでなければ本文のテキストを返す */
  complete(req: LlmRequest): Promise<string>;
}

export class LlmRefusalError extends Error {}

/** 本物の Claude API */
export class AnthropicLlm implements LlmClient {
  constructor(private readonly client: Anthropic) {}

  async complete(req: LlmRequest): Promise<string> {
    const res = await this.client.beta.messages.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      // 判断・要約は軽い用途なので low。ポリシー判定で断られたときはサーバ側の既定のフォールバックに任せる
      output_config: {
        effort: 'low',
        ...(req.schema ? { format: { type: 'json_schema' as const, schema: req.schema } } : {}),
      },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (res.stop_reason === 'refusal') throw new LlmRefusalError(`refused (${req.purpose})`);
    const text = res.content
      .filter((b): b is Extract<(typeof res.content)[number], { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (!text) throw new Error(`empty response (${req.purpose}, stop_reason=${res.stop_reason})`);
    return text;
  }
}

export interface Recording {
  key: string;
  request: LlmRequest;
  response: string;
}

export interface RecordingStore {
  get(key: string): Promise<Recording | undefined>;
  put(rec: Recording): Promise<void>;
}

export async function recordingKey(req: LlmRequest): Promise<string> {
  const data = new TextEncoder().encode(canonicalJson(req));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export class RecordingMissingError extends Error {}

/**
 * 記録・再生モード。
 * - replay: 記録だけを返す。記録がなければ失敗（テストはこのモードのみ）
 * - record: 本物を呼んで記録する（既にあれば再利用）
 * - rerecord: 既存の記録を無視して呼び直す（モデルを変えたときの差分取り）
 */
export class RecordReplayLlm implements LlmClient {
  constructor(
    private readonly mode: 'replay' | 'record' | 'rerecord',
    private readonly store: RecordingStore,
    private readonly inner?: LlmClient,
  ) {}

  async complete(req: LlmRequest): Promise<string> {
    const key = await recordingKey(req);
    if (this.mode !== 'rerecord') {
      const hit = await this.store.get(key);
      if (hit) return hit.response;
      if (this.mode === 'replay') throw new RecordingMissingError(`no recording for ${req.purpose} (${key})`);
    }
    if (!this.inner) throw new Error('record mode requires a live client');
    const response = await this.inner.complete(req);
    await this.store.put({ key, request: req, response });
    return response;
  }
}

export class MemoryRecordingStore implements RecordingStore {
  readonly recordings = new Map<string, Recording>();
  async get(key: string) {
    return this.recordings.get(key);
  }
  async put(rec: Recording) {
    this.recordings.set(rec.key, rec);
  }
}
