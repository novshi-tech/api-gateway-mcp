import { BOUNDARY_SUMMARY_SYSTEM_PROMPT, buildBoundarySummaryPrompt, type List, type Projections } from '../domain';
import type { LlmClient } from '../ingest/llm';

/** 境界越えの要約・翻訳。派生の本文を省略して提案されたときに使う */
export interface Summarizer {
  summarize(p: Projections, taskId: string, target: Pick<List, 'name' | 'description'>, instruction: string): Promise<string>;
}

export class AiSummarizer implements Summarizer {
  constructor(
    private readonly llm: LlmClient,
    private readonly model: string,
  ) {}

  async summarize(p: Projections, taskId: string, target: Pick<List, 'name' | 'description'>, instruction: string) {
    const text = await this.llm.complete({
      purpose: 'boundary_summary',
      model: this.model,
      system: BOUNDARY_SUMMARY_SYSTEM_PROMPT,
      user: buildBoundarySummaryPrompt(p, taskId, target, instruction),
      maxTokens: 4096,
    });
    return text.trim();
  }
}
