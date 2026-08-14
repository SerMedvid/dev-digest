import type { ChatMessage, LLMProvider } from '@devdigest/shared';
import type { BriefModelPort, BriefOutputShape } from './ports.js';
import { BRIEF_SCHEMA_NAME, BriefOutput } from './prompt.js';

/**
 * Driven adapter for the module's one structured call. Binds a provider and a
 * model id to the schema in `prompt.ts` and does nothing else — mirrors
 * `modules/blast/model.ts`.
 *
 * It takes assembled messages rather than raw text: the service has to measure
 * `est_tokens_in` over exactly what is sent, and re-assembling a second copy
 * here to measure there is how the two drift.
 */
export class BriefModel implements BriefModelPort {
  constructor(
    private llm: LLMProvider,
    readonly provider: string,
    readonly model: string,
  ) {}

  async generate(messages: ChatMessage[]): Promise<BriefOutputShape> {
    const res = await this.llm.completeStructured({
      model: this.model,
      schema: BriefOutput,
      schemaName: BRIEF_SCHEMA_NAME,
      temperature: 0,
      messages,
    });
    return res.data;
  }
}
