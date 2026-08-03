import { z } from 'zod';
import type { LLMProvider } from '@devdigest/shared';
import { MAX_FILE_LINES, MAX_SELECTED } from './constants.js';
import { CONVENTION_CATEGORIES, type RawCandidate, type SampleFile } from './domain.js';
import { numberLines } from './helpers.js';
import { EXTRACTION_PROMPT, FILE_SELECTION_PROMPT } from './prompts.js';

/**
 * Driven adapter for the two structured LLM calls. Zod schemas live here (the
 * boundary ring) and `completeStructured` validates the response, so the
 * service never parses model output.
 *
 * The schema names are load-bearing: `MockLLMProvider.structuredBySchema`
 * already documents 'ConventionFileSelection' then 'ConventionExtraction', and
 * tests key their fixtures off them.
 */

const FileSelection = z.object({
  paths: z.array(z.string()).max(MAX_SELECTED * 2),
});

const Extraction = z.object({
  candidates: z.array(
    z.object({
      category: z.enum(CONVENTION_CATEGORIES),
      rule: z.string().min(1).max(300),
      evidence_path: z.string().min(1),
      evidence_line: z.number().int().positive(),
      evidence_snippet: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export class ConventionsModel {
  constructor(
    private llm: LLMProvider,
    readonly provider: string,
    readonly model: string,
  ) {}

  async selectFiles(input: { pool: string[] }): Promise<string[]> {
    const { data } = await this.llm.completeStructured({
      model: this.model,
      schema: FileSelection,
      schemaName: 'ConventionFileSelection',
      temperature: 0,
      messages: [
        { role: 'system', content: FILE_SELECTION_PROMPT.replace('{{max}}', String(MAX_SELECTED)) },
        { role: 'user', content: input.pool.map((p) => `- ${p}`).join('\n') },
      ],
    });
    return data.paths;
  }

  async extract(input: { files: SampleFile[] }): Promise<RawCandidate[]> {
    const { data } = await this.llm.completeStructured({
      model: this.model,
      schema: Extraction,
      schemaName: 'ConventionExtraction',
      temperature: 0,
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: input.files.map(renderFile).join('\n\n') },
      ],
    });
    return data.candidates.map((c) => ({
      category: c.category,
      rule: c.rule,
      evidencePath: c.evidence_path,
      evidenceLine: c.evidence_line,
      evidenceSnippet: c.evidence_snippet,
      confidence: c.confidence,
    }));
  }
}

/** One sample, labelled by kind and line-numbered so citations can be checked. */
function renderFile(file: SampleFile): string {
  return [
    `--- ${file.kind}: ${file.path} ---`,
    numberLines(file.content, MAX_FILE_LINES),
  ].join('\n');
}
