import {
  BYTES_PER_ESTIMATED_TOKEN,
  MAX_BLAST_CHARS,
  MAX_EST_TOKENS_IN,
  MAX_FILES,
  MAX_FILES_CHARS,
  MAX_FINDINGS,
  MAX_FINDINGS_CHARS,
  MAX_HEADER_CHARS,
  MAX_INTENT_CHARS,
  MAX_ISSUE_CHARS,
  MAX_SPEC_DOCS,
  MAX_SPEC_DOC_CHARS,
} from './constants.js';
import type {
  BriefBlastMap,
  BriefFileRow,
  BriefFindingRow,
  BriefIntentRef,
  BriefOutputShape,
  BriefPullRef,
  BriefReviewRef,
  BriefSection,
} from './ports.js';

export type { BriefSection };

/**
 * Pure transforms for the brief module (no I/O, no `this`).
 *
 * Two jobs live here. The first half renders each input source into bounded
 * text and says, in its `source` label, whenever a cap bit — so a truncated
 * input can never read to the model, or to the user, as a complete one. The
 * second half (`buildAllowed` / `groundBrief`) is the grounding gate: the code
 * that makes "the brief never names a file outside the pull request" a
 * guarantee rather than a prompt instruction.
 */

// ---------------------------------------------------------------- the budget

/** The budget's unit: `ceil(chars / 4)`, never a tokenizer count. */
export function estTokens(text: string): number {
  if (text.length <= 0) return 0;
  return Math.ceil(text.length / BYTES_PER_ESTIMATED_TOKEN);
}

/** The character ceiling the estimate implies. */
export const MAX_PROMPT_CHARS = MAX_EST_TOKENS_IN * BYTES_PER_ESTIMATED_TOKEN;

/**
 * The final backstop on the assembled prompt.
 *
 * Room for the marker is reserved BEFORE slicing, so the returned string —
 * marker included — honours the ceiling. Truncating to the ceiling and then
 * appending would breach it by the marker's own length, which is exactly the
 * kind of off-by-a-little that makes an invariant untestable.
 *
 * `alreadySpent` is the length of prompt text this string will be sent
 * alongside (the system message). Counting it here is what makes the ceiling
 * bound the whole prompt rather than one half of it.
 */
export function capPrompt(text: string, alreadySpent = 0): string {
  const budget = Math.max(0, MAX_PROMPT_CHARS - alreadySpent);
  if (text.length <= budget) return text;
  // `\n…[truncated ` + digits + ` chars]`. The digit count can never exceed
  // that of the input's own length, so this reserve is always sufficient.
  const reserve = 20 + String(text.length).length;
  const keep = Math.max(0, budget - reserve);
  return `${text.slice(0, keep)}\n…[truncated ${text.length - keep} chars]`;
}

/** Truncate to `cap`, reporting whether it bit — the caller labels the source. */
function clip(text: string, cap: number): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false };
  return { text: text.slice(0, cap), truncated: true };
}

/** `label` when nothing was dropped, `label (truncated)` when something was. */
function label(base: string, truncated: boolean): string {
  return truncated ? `${base} (truncated)` : base;
}

// -------------------------------------------------------------- the renderers

export interface BriefInputs {
  pull: BriefPullRef;
  files: BriefFileRow[];
  intent: BriefIntentRef | undefined;
  blast: BriefBlastMap | null;
  review: BriefReviewRef | undefined;
  /** Specification documents actually read, as `CloneDocReader` returned them. */
  docs: { label: string; content: string }[];
}

export interface RenderedInputs {
  sections: BriefSection[];
  /** One entry per rendered section, carrying every cap that bit. */
  sources: string[];
  /** The sections' raw text, joined. Convenience for logging and tests. */
  text: string;
}

/** Source 1 — who is changing what, in one block. */
export function renderHeader(pull: BriefPullRef, files: BriefFileRow[]): BriefSection {
  const adds = files.reduce((n, f) => n + f.additions, 0);
  const dels = files.reduce((n, f) => n + f.deletions, 0);
  const body = [
    `#${pull.number} ${pull.title}`,
    `author: ${pull.author}`,
    `branch: ${pull.headRef} → ${pull.baseRef}`,
    `changes: +${adds} -${dels} across ${files.length} file(s)`,
  ].join('\n');
  return { label: 'pr', heading: 'Pull request', text: clip(body, MAX_HEADER_CHARS).text };
}

/**
 * Source 2 — the changed paths and their per-file `+/-`.
 *
 * Reads `path`, `additions` and `deletions` and nothing else. It cannot read a
 * patch: `BriefFileRow` has no such field, which is where the "no diff hunk
 * body reaches any prompt" rule is actually enforced.
 */
export function renderFiles(files: BriefFileRow[]): { section: BriefSection; source: string } {
  const shown = files.slice(0, MAX_FILES);
  const lines = shown.map((f) => `${f.path} (+${f.additions} -${f.deletions})`);
  if (files.length > shown.length) {
    lines.push(`… ${files.length - shown.length} more file(s)`);
  }
  const clipped = clip(lines.join('\n'), MAX_FILES_CHARS);
  // The count cap is reported as "N of M" rather than "(truncated)": how many
  // files the PR really touches is itself a fact the reader needs.
  const base = files.length > shown.length ? `files (${shown.length} of ${files.length})` : 'files';
  return {
    section: { label: 'files', heading: 'Changed files', text: clipped.text },
    source: label(base, clipped.truncated),
  };
}

/** Source 3 — the derived intent and its scope lists. */
export function renderIntent(intent: BriefIntentRef): { section: BriefSection; source: string } {
  const body = [
    intent.intent,
    '',
    `in scope: ${intent.in_scope.join('; ') || '—'}`,
    `out of scope: ${intent.out_of_scope.join('; ') || '—'}`,
    `confidence: ${intent.confidence}`,
  ].join('\n');
  const clipped = clip(body, MAX_INTENT_CHARS);
  return {
    section: { label: 'intent', heading: 'Derived intent', text: clipped.text },
    source: label('intent', clipped.truncated),
  };
}

/** Source 4 — the linked issue, read from `pr_intent`. No network call. */
export function renderIssue(
  issue: NonNullable<BriefIntentRef['linkedIssue']>,
): { section: BriefSection; source: string } {
  const body = [`#${issue.number} ${issue.title}`, '', issue.body ?? ''].join('\n').trimEnd();
  const clipped = clip(body, MAX_ISSUE_CHARS);
  const name = `issue#${issue.number}`;
  return {
    section: { label: name, heading: 'Linked issue', text: clipped.text },
    source: label(name, clipped.truncated),
  };
}

/**
 * Source 5 — the blast map.
 *
 * The map's own `summary` slot is split out and rendered as prose: it is a
 * paragraph a model already wrote, and leaving it inside the JSON invites the
 * brief to quote it as if it were an index fact.
 */
export function renderBlast(blast: BriefBlastMap): { section: BriefSection; source: string } {
  const { summary, ...map } = blast;
  const body = summary
    ? `${JSON.stringify(map)}\n\nExisting summary: ${summary}`
    : JSON.stringify(map);
  const clipped = clip(body, MAX_BLAST_CHARS);
  return {
    section: { label: 'blast', heading: 'Blast radius', text: clipped.text },
    source: label('blast', clipped.truncated),
  };
}

/**
 * Source 6 — the latest review's findings.
 *
 * `rationale` and `suggestion` are never rendered; see `BriefFindingRow`. The
 * line range is, because it is the only thing in the whole prompt that vouches
 * for a line number — `groundBrief` rule 4 checks `review_focus` against
 * exactly these ranges.
 */
export function renderFindings(review: BriefReviewRef): { section: BriefSection; source: string } {
  const shown = review.findings.slice(0, MAX_FINDINGS);
  const lines = shown.map(
    (f) =>
      `${f.severity} ${f.category}/${f.kind} ${f.file}:${f.startLine}-${f.endLine} — ${f.title}`,
  );
  if (review.findings.length > shown.length) {
    lines.push(`… ${review.findings.length - shown.length} more finding(s)`);
  }
  const clipped = clip(lines.join('\n'), MAX_FINDINGS_CHARS);
  const base =
    review.findings.length > shown.length
      ? `findings (${shown.length} of ${review.findings.length})`
      : 'findings';
  return {
    section: { label: 'findings', heading: 'Latest review findings', text: clipped.text },
    source: label(base, clipped.truncated),
  };
}

/**
 * Source 7 — the specification documents the PR body itself references.
 *
 * One section per document, so each carries its own path in its untrusted
 * wrapper: a committed `.md` is author-controlled text, and merging three of
 * them into one block would let the second file's content read as the first's.
 */
export function renderDocs(docs: { label: string; content: string }[]): {
  sections: BriefSection[];
  sources: string[];
} {
  const sections: BriefSection[] = [];
  const sources: string[] = [];
  for (const doc of docs.slice(0, MAX_SPEC_DOCS)) {
    // `CloneDocReader` labels its results `doc:<path>`; the brief's own source
    // vocabulary calls them `spec:<path>`.
    const path = doc.label.startsWith('doc:') ? doc.label.slice(4) : doc.label;
    const clipped = clip(doc.content, MAX_SPEC_DOC_CHARS);
    const name = `spec:${path}`;
    sections.push({ label: name, heading: `Referenced document ${path}`, text: clipped.text });
    sources.push(label(name, clipped.truncated));
  }
  return { sections, sources };
}

/**
 * Compose every source that arrived. A source that is absent contributes no
 * section and no heading at all — an empty "Derived intent" heading reads to
 * the model as "there is an intent and it is blank", which is a different and
 * false claim from "no intent was derived".
 */
export function renderInputs(input: BriefInputs): RenderedInputs {
  const sections: BriefSection[] = [];
  const sources: string[] = [];

  sections.push(renderHeader(input.pull, input.files));
  sources.push('pr');

  const files = renderFiles(input.files);
  sections.push(files.section);
  sources.push(files.source);

  if (input.intent) {
    const intent = renderIntent(input.intent);
    sections.push(intent.section);
    sources.push(intent.source);

    if (input.intent.linkedIssue) {
      const issue = renderIssue(input.intent.linkedIssue);
      sections.push(issue.section);
      sources.push(issue.source);
    }
  }

  if (input.blast) {
    const blast = renderBlast(input.blast);
    sections.push(blast.section);
    sources.push(blast.source);
  }

  if (input.review && input.review.findings.length > 0) {
    const findings = renderFindings(input.review);
    sections.push(findings.section);
    sources.push(findings.source);
  }

  const docs = renderDocs(input.docs);
  sections.push(...docs.sections);
  sources.push(...docs.sources);

  return { sections, sources, text: sections.map((s) => s.text).join('\n') };
}

// ----------------------------------------------------------- the grounding gate

/**
 * Everything the brief is allowed to name, built from the inputs alone.
 *
 * This is the whole safety property of the feature: a brief that reads
 * confidently about a file which is not in the pull request is the failure mode
 * it exists to avoid, and a prompt instruction is not a guarantee. Mirrors
 * `scopeFindings` in `reviewer-core/src/scope.ts`.
 */
export interface AllowedRefs {
  /** POSIX-normalised paths. Compared EXACTLY — never by suffix. */
  files: Set<string>;
  /** `endpoints_affected` and `crons_affected` from the blast map. */
  endpoints: Set<string>;
  /** file → the finding line ranges on it. The only vouchers for a line number. */
  findingRanges: Map<string, { start: number; end: number }[]>;
}

/**
 * Normalise a reference to the form the allowed sets are keyed by.
 *
 * Separators are folded to POSIX so a Windows-shaped path cannot slip past a
 * comparison made against POSIX keys. Everything else is left alone —
 * deliberately. Resolving `..`, stripping a leading `/`, or trimming a
 * `./` prefix would turn a path that escapes the repository into one that
 * matches a file inside it, which is precisely the input this gate exists to
 * reject. A traversal attempt must FAIL to match, not be repaired into one.
 */
function normPath(ref: string): string {
  return ref.trim().replace(/\\/g, '/');
}

export function buildAllowed(input: {
  files: BriefFileRow[];
  blast: BriefBlastMap | null;
  /** Paths of the specification documents that were actually read. */
  specPaths: string[];
  findings: BriefFindingRow[];
}): AllowedRefs {
  const files = new Set<string>();
  const endpoints = new Set<string>();

  for (const f of input.files) files.add(normPath(f.path));
  for (const p of input.specPaths) files.add(normPath(p));

  if (input.blast) {
    for (const sym of input.blast.changed_symbols) {
      // The symbol's own declaring file is in `pr_files` by construction, but
      // its CALLERS are the whole point of a blast map: they sit outside the
      // diff, and a risk that names one is naming something real.
      files.add(normPath(sym.file));
      for (const c of sym.callers) files.add(normPath(c.file));
      for (const e of sym.endpoints) endpoints.add(e);
      for (const c of sym.crons) endpoints.add(c);
    }
    // The BFS-widened union as well as the per-symbol attributions: which of
    // the two the model quoted is incidental, and treating one as invented
    // because it came from the other would drop a true reference.
    for (const e of input.blast.endpoints) endpoints.add(e);
    for (const c of input.blast.crons) endpoints.add(c);
  }

  const findingRanges = new Map<string, { start: number; end: number }[]>();
  for (const f of input.findings) {
    const key = normPath(f.file);
    const list = findingRanges.get(key) ?? [];
    list.push({ start: f.startLine, end: f.endLine });
    findingRanges.set(key, list);
  }

  return { files, endpoints, findingRanges };
}

/** One thing the gate removed, and why. Logged and counted, never silent. */
export interface GroundDrop {
  kind: 'risk' | 'ref' | 'focus' | 'line';
  value: string;
  reason: string;
}

/** The grounded brief's shape — `Brief` minus the wire-contract import. */
export interface GroundedBrief {
  what: string;
  why: string;
  risk_level: 'high' | 'medium' | 'low';
  risks: { title: string; explanation: string; severity: 'high' | 'medium' | 'low'; refs: string[] }[];
  review_focus: { file: string; line: number | null; reason: string }[];
}

/**
 * Split a `file:line`-shaped reference on the LAST colon.
 *
 * The last, not the first: a Windows-shaped `C:\src\x.ts:12` and a path
 * containing a colon both split correctly this way, and the file part is what
 * the allowed set is keyed by. A reference with no numeric suffix is returned
 * whole, because `METHOD /path` endpoints are also refs.
 */
function refFilePart(ref: string): string {
  const at = ref.lastIndexOf(':');
  if (at <= 0) return ref;
  const tail = ref.slice(at + 1);
  return /^\d+$/.test(tail) ? ref.slice(0, at) : ref;
}

/**
 * Apply the five rules to a model's output, returning the brief that may be
 * persisted and every reference that did not survive.
 *
 * Pure: it reports its drops, it does not log them. The caller decides what to
 * do with `dropped`, and the caller is what makes them visible — a suppressed
 * real risk is invisible by construction, which is the same reason the scope
 * gate reports its own drops rather than swallowing them.
 */
export function groundBrief(
  out: BriefOutputShape,
  allowed: AllowedRefs,
): { brief: GroundedBrief; dropped: GroundDrop[] } {
  const dropped: GroundDrop[] = [];

  // Rules 1 and 2 — every ref must name something in the inputs, and a risk
  // that names nothing in the pull request is not a risk about this PR.
  const risks: GroundedBrief['risks'] = [];
  for (const risk of out.risks) {
    const kept: string[] = [];
    for (const ref of risk.refs) {
      const norm = normPath(ref);
      const file = refFilePart(norm);
      if (allowed.files.has(file) || allowed.endpoints.has(norm) || allowed.endpoints.has(file)) {
        kept.push(ref);
        continue;
      }
      dropped.push({
        kind: 'ref',
        value: ref,
        reason: `"${ref}" names no file in this pull request, no caller in its blast map, no document that was read, and no endpoint or job the map reports`,
      });
    }
    if (kept.length === 0) {
      dropped.push({
        kind: 'risk',
        value: risk.title,
        reason: `every reference on risk "${risk.title}" was invented, so the risk describes nothing in this pull request`,
      });
      continue;
    }
    risks.push({ ...risk, refs: kept });
  }

  // Rules 3 and 4 — the file must be real, and a line survives only when a
  // finding on that same file vouches for it.
  const review_focus: GroundedBrief['review_focus'] = [];
  for (const item of out.review_focus) {
    const file = normPath(item.file);
    if (!allowed.files.has(file)) {
      dropped.push({
        kind: 'focus',
        value: item.file,
        reason: `"${item.file}" is not a file in this pull request`,
      });
      continue;
    }
    const line = item.line ?? null;
    if (line == null) {
      review_focus.push({ file: item.file, line: null, reason: item.reason });
      continue;
    }
    const ranges = allowed.findingRanges.get(file) ?? [];
    const vouched = ranges.some((r) => line >= r.start && line <= r.end);
    if (!vouched) {
      // The ITEM survives: "read this file first" is still useful and still
      // grounded. Only the line — the one part nothing in the inputs supports
      // — is removed. Nothing but a finding carries a line number, so any
      // other line the model emits was invented.
      dropped.push({
        kind: 'line',
        value: `${item.file}:${line}`,
        reason: `no finding on "${item.file}" covers line ${line}, and nothing else in the inputs carries a line number`,
      });
      review_focus.push({ file: item.file, line: null, reason: item.reason });
      continue;
    }
    review_focus.push({ file: item.file, line, reason: item.reason });
  }

  // Rule 5 — `what`, `why` and `risk_level` pass through untouched. They are
  // judgements about the inputs, not references into them, and there is
  // nothing here to check them against.
  return {
    brief: {
      what: out.what,
      why: out.why,
      risk_level: out.risk_level,
      risks,
      review_focus,
    },
    dropped,
  };
}
