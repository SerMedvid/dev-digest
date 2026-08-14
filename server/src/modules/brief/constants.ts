/**
 * Every bound the brief composition holds itself to.
 *
 * The per-source caps below sum to roughly **28 500 characters** — 5 000 files
 * + 6 000 blast + 6 000 findings + 4 500 specs + 3 000 issue + 1 500 intent +
 * 500 header, plus ~2 000 for the system prompt, the section headings and the
 * untrusted wrappers — against a ceiling of 32 000. The budget invariant
 * therefore holds **by construction**, and `capPrompt` is a backstop rather
 * than the mechanism: if somebody raises one of these constants carelessly, the
 * prompt is truncated with a visible marker instead of silently breaching the
 * ceiling.
 *
 * `MAX_EST_TOKENS_IN` is measured in ESTIMATED tokens (`ceil(chars / 4)`), the
 * same estimate `project-context/helpers.ts` uses. The estimate — not a
 * tokenizer count — is the budget's unit, so the invariant is deterministic and
 * testable with no provider in the loop. The real tiktoken count goes to the
 * log for observability only; it is never the gate.
 */

/** The estimator's divisor. Four characters per token, as elsewhere in `server/`. */
export const BYTES_PER_ESTIMATED_TOKEN = 4;

/** The whole assembled prompt's ceiling ⇒ 32 000 characters. */
export const MAX_EST_TOKENS_IN = 8_000;

/** Source 1 — title, author, branch, `+N -M`, file count. */
export const MAX_HEADER_CHARS = 500;

/** Source 2 — changed files listed individually before `… N more file(s)`. */
export const MAX_FILES = 60;
/** Source 2 — the rendered file list's ceiling. */
export const MAX_FILES_CHARS = 5_000;

/** Source 3 — the intent statement plus both scope lists. */
export const MAX_INTENT_CHARS = 1_500;

/** Source 4 — the stored linked issue's number, title and body. */
export const MAX_ISSUE_CHARS = 3_000;

/** Source 5 — the blast map JSON plus its summary paragraph. */
export const MAX_BLAST_CHARS = 6_000;

/** Source 6 — findings rendered individually. */
export const MAX_FINDINGS = 40;
/** Source 6 — the rendered findings list's ceiling. */
export const MAX_FINDINGS_CHARS = 6_000;

/** Source 7 — specification documents the PR body references. */
export const MAX_SPEC_DOCS = 3;
/** Source 7 — per document; 3 × 1 500 = 4 500 in total. */
export const MAX_SPEC_DOC_CHARS = 1_500;

/** Machine reasons carried on a refusal, in the shape of `BLAST_REASON`. */
export const BRIEF_REASON = {
  /** The PR has no changed files — there is no question to ask. */
  noFiles: 'brief_no_inputs',
} as const;
