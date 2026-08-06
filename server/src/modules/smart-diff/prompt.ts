import { z } from 'zod';
import type { ChatMessage } from '@devdigest/shared';
import { wrapUntrusted, INJECTION_GUARD } from '@devdigest/reviewer-core';
import { MAX_PATCH_CHARS } from './constants.js';

/**
 * The on-demand per-file summary: one structured call, one file's patch in,
 * one sentence out. This is a feature prompt in code, not an agent prompt —
 * it carries no severity rubric or verdict mapping (those govern the
 * reviewer agents stored on `agents.system_prompt`; see
 * `docs/agent-prompts/`) — but the two rules that DO apply everywhere still
 * apply here: the output shape is enforced out of band by structured output
 * (never described in prose), and every piece of author-controlled content is
 * wrapped as untrusted.
 */

/** MockLLMProvider (and any real structured-output call) keys by this. */
export const FILE_SUMMARY_SCHEMA_NAME = 'FileSummary';

/** Module-local — NOT a shared contract. This call's output shape only. */
export const FileSummaryOutput = z.object({ summary: z.string() });
export type FileSummaryOutput = z.infer<typeof FileSummaryOutput>;

/**
 * Fixed instruction, trusted, never mixed with the patch. Does NOT describe
 * the JSON shape — that's `FileSummaryOutput` + `response_format`, enforced
 * out of band, same convention as `reviewer-core/intent/prompt.ts`.
 */
const SYSTEM_PROMPT = [
  'You summarise what ONE changed file in a pull request does.',
  '',
  'Write exactly one sentence: what does this change do? No preamble, no restating the filename, no hedging.',
  '',
  'You are given only this file’s patch — no other file, no PR description, no repository context. Judge the change on the patch alone.',
].join('\n');

/** Reported so a truncated patch can never read to the model as a complete one (mirrors `hunkHeaderDigest`'s caps). */
function truncatedPatch(patch: string): string {
  if (patch.length <= MAX_PATCH_CHARS) return patch;
  const dropped = patch.length - MAX_PATCH_CHARS;
  return `${patch.slice(0, MAX_PATCH_CHARS)}\n… diff truncated (${dropped} more characters)`;
}

/**
 * Assembles the two-message call. The patch is author-controlled, so it is
 * the only thing wrapped — the file path and the instruction stay trusted
 * and outside the wrap, exactly as `classifyIntent` keeps its instruction
 * outside `wrapUntrusted('hunk-headers', …)`.
 */
export function buildFileSummaryPrompt(path: string, patch: string): ChatMessage[] {
  const system = `${SYSTEM_PROMPT}\n\n${INJECTION_GUARD}`;
  const user = `File: ${path}\n\n${wrapUntrusted('diff', truncatedPatch(patch))}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
