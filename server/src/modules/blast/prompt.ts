import { z } from 'zod';
import type { ChatMessage } from '@devdigest/shared';
import { wrapUntrusted, INJECTION_GUARD } from '@devdigest/reviewer-core';
import { MAX_SUMMARY_INPUT_CHARS } from './constants.js';

/**
 * The on-demand blast-map explanation: one structured call, the computed map
 * in, one paragraph out. A feature prompt in code, not an agent prompt (see
 * `docs/agent-prompts/`) — but the two rules that always apply do apply: the
 * output shape is enforced out of band by structured output rather than
 * described in prose, and every piece of repository-derived content is wrapped
 * as untrusted.
 *
 * The map is derived from repository file paths and symbol names, which a PR
 * author fully controls — a file may be named to read like an instruction.
 * Hence the wrap, exactly as smart-diff wraps a path.
 */

/** MockLLMProvider (and any real structured-output call) keys by this. */
export const BLAST_SUMMARY_SCHEMA_NAME = 'BlastSummary';

/** Module-local — NOT a shared contract. This call's output shape only. */
export const BlastSummaryOutput = z.object({ summary: z.string() });
export type BlastSummaryOutput = z.infer<typeof BlastSummaryOutput>;

/**
 * Fixed instruction, trusted, never mixed with the map. The "do not invent"
 * clauses are load-bearing: everything the user sees in the card is computed
 * from the index, so a summary naming a file that isn't in the map would be
 * the one part of this feature that hallucinates.
 */
const SYSTEM_PROMPT = [
  'You explain a pull request’s blast radius — a precomputed map of which changed symbols exist, which files call them, and which HTTP endpoints or scheduled jobs sit downstream.',
  '',
  'Write exactly one paragraph a reviewer can read in ten seconds: what the change reaches, and what is worth checking because of it. No preamble, no bullet list, no restating the map field by field.',
  '',
  'Describe ONLY the nodes and edges given to you. Do not name a file, symbol, endpoint or job that does not appear in the map, do not guess what the code does, and do not estimate risk the map does not support. If the map is small, say so plainly rather than padding.',
].join('\n');

/**
 * Reported so a truncated map can never read to the model as a complete one
 * (mirrors smart-diff's `truncatedPatch`). A map this wide is already past the
 * point of being one readable paragraph, so the cap is a real limit and not a
 * formality.
 */
function truncatedMap(mapJson: string): string {
  if (mapJson.length <= MAX_SUMMARY_INPUT_CHARS) return mapJson;
  const dropped = mapJson.length - MAX_SUMMARY_INPUT_CHARS;
  return `${mapJson.slice(0, MAX_SUMMARY_INPUT_CHARS)}\n…[truncated ${dropped} chars]`;
}

export function buildBlastSummaryPrompt(mapJson: string): ChatMessage[] {
  const system = `${SYSTEM_PROMPT}\n\n${INJECTION_GUARD}`;
  const user = `Blast map:\n${wrapUntrusted('blast-map', truncatedMap(mapJson))}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
