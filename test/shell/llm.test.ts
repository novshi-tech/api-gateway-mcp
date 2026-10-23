import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { AiDecider } from '../../src/ingest/deciders';
import type { IngestRequest } from '../../src/domain';
import {
  AnthropicLlm,
  LlmRefusalError,
  MemoryRecordingStore,
  recordingKey,
  RecordingMissingError,
  RecordReplayLlm,
  type LlmClient,
  type LlmRequest,
} from '../../src/ingest/llm';

const req: LlmRequest = { purpose: 'ingest_decision', model: 'claude-sonnet-5-5', system: 's', user: 'u', schema: { type: 'object' } };

class CountingLlm implements LlmClient {
  calls = 0;
  constructor(private readonly reply: string) {}
  async complete() {
    this.calls++;
    return this.reply;
  }
}

describe('記録・再生', () => {
  it('キーはリクエストの内容だけで決まり、キー順に依存しない', async () => {
    const k1 = await recordingKey(req);
    const k2 = await recordingKey({ user: 'u', system: 's', model: 'claude-sonnet-5-5', schema: { type: 'object' }, purpose: 'ingest_decision' });
    expect(k1).toBe(k2);
    expect(await recordingKey({ ...req, model: 'other' })).not.toBe(k1);
  });

  it('replay は記録がなければ失敗し、本物を呼ばない', async () => {
    const live = new CountingLlm('x');
    await expect(new RecordReplayLlm('replay', new MemoryRecordingStore(), live).complete(req)).rejects.toBeInstanceOf(RecordingMissingError);
    expect(live.calls).toBe(0);
  });

  it('record は一度だけ本物を呼んで記録し、replay で同じ応答を返す', async () => {
    const store = new MemoryRecordingStore();
    const live = new CountingLlm('{"ok":true}');
    const rec = new RecordReplayLlm('record', store, live);
    expect(await rec.complete(req)).toBe('{"ok":true}');
    expect(await rec.complete(req)).toBe('{"ok":true}');
    expect(live.calls).toBe(1);
    expect([...store.recordings.values()][0]).toMatchObject({ request: req, response: '{"ok":true}' });
    expect(await new RecordReplayLlm('replay', store).complete(req)).toBe('{"ok":true}');
  });

  it('rerecord は既存の記録を無視して呼び直し、上書きする', async () => {
    const store = new MemoryRecordingStore();
    await new RecordReplayLlm('record', store, new CountingLlm('old')).complete(req);
    const live = new CountingLlm('new');
    expect(await new RecordReplayLlm('rerecord', store, live).complete(req)).toBe('new');
    expect(await new RecordReplayLlm('replay', store).complete(req)).toBe('new');
  });

  it('record で本物がなければ失敗する', async () => {
    await expect(new RecordReplayLlm('record', new MemoryRecordingStore()).complete(req)).rejects.toThrow(/live client/);
  });
});

describe('AnthropicLlm', () => {
  const fake = (res: unknown) => {
    const create = vi.fn().mockResolvedValue(res);
    return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
  };

  it('構造化出力・フォールバック・effort を付けて呼び、テキストをつなげて返す', async () => {
    const { client, create } = fake({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a"' }, { type: 'text', text: ':1}' }] });
    expect(await new AnthropicLlm(client).complete(req)).toBe('{"a":1}');
    expect(create.mock.calls[0]![0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object' } } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  });

  it('schema がなければ format を付けない', async () => {
    const { client, create } = fake({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] });
    await new AnthropicLlm(client).complete({ ...req, schema: undefined });
    expect(create.mock.calls[0]![0].output_config).toEqual({ effort: 'low' });
  });

  it('refusal と空応答はエラー', async () => {
    await expect(new AnthropicLlm(fake({ stop_reason: 'refusal', content: [] }).client).complete(req)).rejects.toBeInstanceOf(LlmRefusalError);
    await expect(new AnthropicLlm(fake({ stop_reason: 'max_tokens', content: [] }).client).complete(req)).rejects.toThrow(/empty/);
  });
});

describe('AiDecider', () => {
  const request: IngestRequest = {
    mode: 'new',
    signal: {
      signalId: 's',
      dataSourceId: 'ds',
      direction: 'inbound',
      channel: 'email',
      from: { channel: 'email', value: 'a@x' },
      to: [],
      fromPartyId: null,
      toPartyIds: [],
      body: 'b',
      anchors: {},
      attachments: [],
      sourceRef: 'r',
    },
    dataSource: { id: 'ds', name: 'support@', description: '', channel: 'email', group: false },
    threading: { kind: 'new', by: 'no_match', reason: 'r' },
    candidates: [],
  };

  it('H6 構造化出力を検証して返す。壊れた出力は例外', async () => {
    const out = { thread: 'new', thread_id: null, title: 't', needs_response: true, reason: 'r', confidence: 0.7 };
    const llm = new CountingLlm(JSON.stringify(out));
    expect(await new AiDecider(llm, 'm').decide(request)).toEqual({ raw: out, by: 'ai' });
    await expect(new AiDecider(new CountingLlm('{"thread":"maybe"}'), 'm').decide(request)).rejects.toThrow();
  });
});
