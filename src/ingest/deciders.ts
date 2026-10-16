import {
  AI_DECISION_JSON_SCHEMA,
  AiDecision,
  buildDecisionPrompt,
  buildReplyEstimatePrompt,
  INGEST_SYSTEM_PROMPT,
  normalizeEstimate,
  REPLY_ESTIMATE_JSON_SCHEMA,
  REPLY_ESTIMATE_SYSTEM_PROMPT,
  ReplyEstimate,
  type DecisionRequest,
  type SignalPayload,
} from '../domain';
import type { LlmClient } from './llm';

/** アンカーで決まらなかったシグナルの判断者 */
export interface Decider {
  decide(req: DecisionRequest): Promise<{ raw: AiDecision; by: 'ai' | 'human' }>;
}

export class AiDecider implements Decider {
  constructor(
    private readonly llm: LlmClient,
    private readonly model: string,
  ) {}

  async decide(req: DecisionRequest) {
    const text = await this.llm.complete({
      purpose: 'ingest_decision',
      model: this.model,
      system: INGEST_SYSTEM_PROMPT,
      user: buildDecisionPrompt(req),
      schema: AI_DECISION_JSON_SCHEMA,
      maxTokens: 2048,
    });
    return { raw: AiDecision.parse(JSON.parse(text)), by: 'ai' as const };
  }
}

/** 観測された送信の返事期待の推定 */
export interface ReplyEstimator {
  estimate(signal: SignalPayload, sentAt: string): Promise<{ replyExpectedBy: string | null; by: 'ai' | 'none' }>;
}

export class AiReplyEstimator implements ReplyEstimator {
  constructor(
    private readonly llm: LlmClient,
    private readonly model: string,
  ) {}

  async estimate(signal: SignalPayload, sentAt: string) {
    const text = await this.llm.complete({
      purpose: 'reply_estimate',
      model: this.model,
      system: REPLY_ESTIMATE_SYSTEM_PROMPT,
      user: buildReplyEstimatePrompt(signal, sentAt),
      schema: REPLY_ESTIMATE_JSON_SCHEMA,
      maxTokens: 1024,
    });
    return { replyExpectedBy: normalizeEstimate(ReplyEstimate.parse(JSON.parse(text)), sentAt), by: 'ai' as const };
  }
}

export const noEstimate: ReplyEstimator = {
  async estimate() {
    return { replyExpectedBy: null, by: 'none' };
  },
};
