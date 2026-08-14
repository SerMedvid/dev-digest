import { z } from 'zod';
import type { LLMProvider } from '@devdigest/shared';
import { renderPrompt } from '../../platform/prompts.js';
import { MAX_FIRST_TASKS } from './constants.js';
import type { FactsSkeleton, Narrative } from './domain.js';
import type { OnboardingModelPort } from './ports.js';

/**
 * Driven adapter for the tour's ONE structured call. The Zod schema lives here
 * (the boundary ring) and `completeStructured` validates the response, so the
 * service never parses model output.
 *
 * The schema name 'OnboardingTour' is load-bearing: `MockLLMProvider` looks
 * fixtures up by it, and tests key off that name.
 */

const NoteEntry = z.object({ path: z.string().min(1), note: z.string().max(160) });

const TourNarrative = z.object({
  architecture: z.object({
    body: z.string().min(1).max(6_000),
    diagram: z.string().max(4_000).nullable(),
  }),
  critical_paths: z.array(NoteEntry).max(20),
  reading_path: z.array(NoteEntry).max(20),
  commands: z
    .array(z.object({ index: z.number().int().nonnegative(), comment: z.string().max(160) }))
    .max(20),
  first_tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        body: z.string().max(600),
        path: z.string().min(1),
      }),
    )
    .max(MAX_FIRST_TASKS * 2),
});

export class OnboardingModel implements OnboardingModelPort {
  constructor(
    private llm: LLMProvider,
    readonly provider: string,
    readonly model: string,
  ) {}

  async write(facts: FactsSkeleton, language: string): Promise<Narrative> {
    const system = await renderPrompt('onboarding.system.md', {
      language,
      maxTasks: String(MAX_FIRST_TASKS),
    });
    const { data } = await this.llm.completeStructured({
      model: this.model,
      schema: TourNarrative,
      schemaName: 'OnboardingTour',
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: renderSkeleton(facts) },
      ],
    });
    return {
      architecture: data.architecture,
      criticalPathNotes: data.critical_paths,
      readingPathNotes: data.reading_path,
      commandComments: data.commands,
      firstTasks: data.first_tasks,
    };
  }
}

/**
 * The skeleton as the model sees it. Commands are numbered because the model
 * refers back to them by index, and everything derived from the repository is
 * fenced in <untrusted> — a README that says "ignore previous instructions" is
 * then plainly data.
 */
function renderSkeleton(facts: FactsSkeleton): string {
  return [
    'SKELETON (authoritative — do not add to or reorder these lists):',
    '',
    'criticalPaths:',
    ...facts.criticalPaths.map((f, i) => `  ${i}. ${f.path}${rank(f.percentile)}`),
    '',
    'readingPath:',
    ...facts.readingPath.map((f, i) => `  ${i}. ${f.path}${rank(f.percentile)}`),
    '',
    'commands:',
    ...facts.commands.map((c, i) => `  ${i}. ${c}`),
    '',
    'dependencyChains:',
    ...facts.chains.map((c) => `  - ${c.join(' -> ')}`),
    '',
    '<untrusted>',
    'REPO MAP:',
    facts.repoMap,
    '</untrusted>',
  ].join('\n');
}

function rank(percentile: number | null): string {
  return percentile === null ? '' : ` (rank p${Math.round(percentile)})`;
}
