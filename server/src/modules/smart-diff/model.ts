import type { LLMProvider } from '@devdigest/shared';
import type { FileSummaryModelPort } from './domain.js';
import { buildFileSummaryPrompt, FILE_SUMMARY_SCHEMA_NAME, FileSummaryOutput } from './prompt.js';

/**
 * Driven adapter for the module's one structured call. Binds a provider and a
 * model id to the prompt in `prompt.ts` and does nothing else — mirrors
 * `modules/intent/model.ts`.
 */
export class FileSummaryModel implements FileSummaryModelPort {
  constructor(
    private llm: LLMProvider,
    readonly provider: string,
    readonly model: string,
  ) {}

  async summarize(path: string, patch: string): Promise<{ summary: string }> {
    const res = await this.llm.completeStructured({
      model: this.model,
      schema: FileSummaryOutput,
      schemaName: FILE_SUMMARY_SCHEMA_NAME,
      temperature: 0,
      messages: buildFileSummaryPrompt(path, patch),
    });
    return { summary: res.data.summary };
  }
}
