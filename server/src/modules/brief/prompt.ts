import { z } from 'zod';
import type { ChatMessage } from '@devdigest/shared';
import { wrapUntrusted, INJECTION_GUARD } from '@devdigest/reviewer-core';
import { capPrompt } from './helpers.js';
import type { BriefOutputShape, BriefSection } from './ports.js';

/**
 * The PR Why + Risk Brief: one structured call, seven bounded sources in, five
 * fields out. A feature prompt in code, not an agent prompt (see
 * `docs/agent-prompts/`) — but the two rules that always apply do apply: the
 * output shape is enforced out of band by structured output rather than
 * described in prose, and every piece of repository-derived content is wrapped
 * as untrusted.
 *
 * All seven sources are author-controlled or derived from author-controlled
 * text: a branch name, a file path, an issue body and a committed `.md` can
 * each be written to read like an instruction. Hence one wrapper per source,
 * each carrying its own label, so no block can pass itself off as another.
 */

/** MockLLMProvider (and any real structured-output call) keys by this. */
export const BRIEF_SCHEMA_NAME = 'PrBrief';

/**
 * Module-local — NOT the shared contract. This call's output shape only, so a
 * wire-contract change can never silently alter what the model is asked for.
 *
 * `line` is `nullish` here and `nullable` on the wire: a model that omits the
 * key entirely is a normal outcome, and the grounding gate normalises it.
 */
export const BriefOutput: z.ZodType<BriefOutputShape> = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: z.enum(['high', 'medium', 'low']),
  risks: z.array(
    z.object({
      title: z.string(),
      explanation: z.string(),
      severity: z.enum(['high', 'medium', 'low']),
      refs: z.array(z.string()),
    }),
  ),
  review_focus: z.array(
    z.object({
      file: z.string(),
      line: z.number().int().nullish(),
      reason: z.string(),
    }),
  ),
});
/**
 * The annotation on `BriefOutput` above is the assertion that the schema and
 * `ports.ts`'s structural mirror agree: widen or narrow either one and this
 * file stops compiling, so the two cannot drift in silence.
 */
export type { BriefOutputShape };

/**
 * Fixed instruction, trusted, never mixed with the inputs.
 *
 * The "do not invent" clauses are load-bearing but they are not the guarantee —
 * `groundBrief` is. They exist so the model's first attempt is usually right,
 * and so a dropped reference is an anomaly rather than routine.
 */
const SYSTEM_PROMPT = [
  'You brief a code reviewer on a pull request before they read its diff. You are given only what follows: the PR header, its changed file paths with per-file line counts, the derived intent, the linked issue, a precomputed blast-radius map, the latest review’s findings, and any specification documents the PR itself references.',
  '',
  '`what` is ONE sentence naming the change. `why` is one short paragraph a reviewer reads in ten seconds — the reason the change exists and what it costs to get wrong, not a restatement of the file list.',
  '',
  'Order `review_focus` by what to read FIRST: the file where a mistake would be most expensive, then outward. Give each entry a reason specific to that file, not a generic one.',
  '',
  'Describe ONLY what is in the inputs. Do not name a file, endpoint or scheduled job that does not appear in them. Do not invent a line number — the findings are the only input that carries one, so cite a line only when a finding vouches for it and leave it out otherwise. If an input is absent, say less; do not fill the gap.',
  '',
  'You never see the diff itself, only the paths. Reason about reach and blast, never about the contents of a hunk.',
].join('\n');

/**
 * The whole prompt: the trusted system message, then every section under its
 * trusted heading with its body wrapped as untrusted under its own source label.
 *
 * The cap is applied to the ASSEMBLED user message, with the system message's
 * own length subtracted first, so `MAX_EST_TOKENS_IN` bounds the **prompt** and
 * not merely the half of it the caps happen to cover. Per-source caps alone
 * would let the sum drift past the ceiling the moment one of them is raised.
 *
 * Built here and handed to the model port as messages, rather than the service
 * re-assembling a copy to measure: the string that is counted and the string
 * that is sent must be the same string, or `est_tokens_in` is fiction.
 */
export function buildBriefPrompt(sections: BriefSection[]): ChatMessage[] {
  const system = `${SYSTEM_PROMPT}\n\n${INJECTION_GUARD}`;
  const user = capPrompt(
    sections.map((s) => `${s.heading}:\n${wrapUntrusted(s.label, s.text)}`).join('\n\n'),
    system.length,
  );
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Every character that will be sent — what `est_tokens_in` is measured over. */
export function promptChars(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + m.content.length, 0);
}
