import { z } from 'zod';

/**
 * Onboarding tour wire contract.
 *
 * The five section ids are fixed and ordered — the prompt, the "on this page"
 * TOC and the renderer all key off this tuple, so adding a section means
 * changing it here first.
 *
 * Supersedes the older `Onboarding` / `OnboardingSection` sketch that lived in
 * `contracts/knowledge.ts`: that one modelled a different section set and had
 * no producer.
 */

export const ONBOARDING_SECTION_IDS = [
  'architecture',
  'critical_paths',
  'run_locally',
  'reading_path',
  'first_tasks',
] as const;

export const OnboardingSectionId = z.enum(ONBOARDING_SECTION_IDS);
export type OnboardingSectionIdValue = z.infer<typeof OnboardingSectionId>;

/** A file the tour points at. `percentile` is null when the rank is unknown. */
export const OnboardingFileEntry = z.object({
  path: z.string().min(1),
  note: z.string().max(300).nullable().default(null),
  percentile: z.number().min(0).max(100).nullable().default(null),
});
export type OnboardingFileEntryValue = z.infer<typeof OnboardingFileEntry>;

export const OnboardingCommand = z.object({
  command: z.string().min(1).max(300),
  comment: z.string().max(160).nullable().default(null),
});
export type OnboardingCommandValue = z.infer<typeof OnboardingCommand>;

export const OnboardingTask = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(600),
  path: z.string().min(1),
});
export type OnboardingTaskValue = z.infer<typeof OnboardingTask>;

/**
 * One flat section shape rather than a discriminated union: each id populates
 * the collections it needs and leaves the rest empty, which keeps the renderer
 * a lookup by id instead of a type narrowing per branch.
 */
export const OnboardingSection = z.object({
  id: OnboardingSectionId,
  title: z.string().min(1),
  body: z.string().default(''),
  diagram: z.string().nullable().default(null),
  files: z.array(OnboardingFileEntry).default([]),
  commands: z.array(OnboardingCommand).default([]),
  tasks: z.array(OnboardingTask).default([]),
});
export type OnboardingSectionValue = z.infer<typeof OnboardingSection>;

export const OnboardingStatus = z.enum(['empty', 'running', 'ready', 'failed']);
export type OnboardingStatusValue = z.infer<typeof OnboardingStatus>;

/** Why there is nothing to show. Only meaningful when status is 'empty'. */
export const OnboardingEmptyReason = z.enum(['never_generated', 'not_indexed']);
export type OnboardingEmptyReasonValue = z.infer<typeof OnboardingEmptyReason>;

export const OnboardingView = z.object({
  status: OnboardingStatus,
  sections: z.array(OnboardingSection),
  /** ISO timestamp of the last successful generation. */
  generatedAt: z.string().nullable(),
  /** True when the index moved on since this tour was written. */
  stale: z.boolean(),
  indexedFiles: z.number().int().nonnegative(),
  error: z.string().nullable(),
  reason: OnboardingEmptyReason.nullable(),
});
export type OnboardingViewValue = z.infer<typeof OnboardingView>;
