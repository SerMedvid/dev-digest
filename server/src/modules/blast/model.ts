import type { LLMProvider } from '@devdigest/shared';
import type { BlastSummaryModelPort } from './ports.js';
import {
  buildBlastSummaryPrompt,
  BLAST_SUMMARY_SCHEMA_NAME,
  BlastSummaryOutput,
} from './prompt.js';

/**
 * Driven adapter for the module's one structured call. Binds a provider and a
 * model id to the prompt in `prompt.ts` and does nothing else — mirrors
 * `modules/smart-diff/model.ts`.
 */
export class BlastSummaryModel implements BlastSummaryModelPort {
  constructor(
    private llm: LLMProvider,
    readonly provider: string,
    readonly model: string,
  ) {}

  async explain(mapJson: string): Promise<{ summary: string }> {
    const res = await this.llm.completeStructured({
      model: this.model,
      schema: BlastSummaryOutput,
      schemaName: BLAST_SUMMARY_SCHEMA_NAME,
      temperature: 0,
      messages: buildBlastSummaryPrompt(mapJson),
    });
    return { summary: res.data.summary };
  }
}
