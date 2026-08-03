import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
} from '../src/db/seed-prompts.js';

/**
 * `docs/agent-prompts/*.md` is the reviewable original; `src/db/seed-prompts.ts`
 * is what a fresh workspace actually gets. Nothing but a comment kept the two in
 * step, so a prompt edited in one place shipped a reviewer that did not match
 * its own documentation. This is that guard.
 *
 * It compares the two verbatim. The template literal's `\`` escapes are a source
 * detail — the constant's runtime value already has plain backticks — so the
 * only normalisation needed is the file's trailing newline, plus CRLF for a
 * checkout with `core.autocrlf=true`.
 */

const docsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'docs',
  'agent-prompts',
);

const normalise = (s: string) => s.replace(/\r\n/g, '\n').trimEnd();

const PAIRS: Array<{ file: string; constant: string; prompt: string }> = [
  { file: 'general-reviewer.md', constant: 'GENERAL_REVIEWER_PROMPT', prompt: GENERAL_REVIEWER_PROMPT },
  { file: 'security-reviewer.md', constant: 'SECURITY_REVIEWER_PROMPT', prompt: SECURITY_REVIEWER_PROMPT },
  {
    file: 'performance-reviewer.md',
    constant: 'PERFORMANCE_REVIEWER_PROMPT',
    prompt: PERFORMANCE_REVIEWER_PROMPT,
  },
  {
    file: 'test-quality-reviewer.md',
    constant: 'TEST_QUALITY_REVIEWER_PROMPT',
    prompt: TEST_QUALITY_REVIEWER_PROMPT,
  },
];

describe('seeded reviewer prompts mirror docs/agent-prompts', () => {
  for (const { file, constant, prompt } of PAIRS) {
    it(`${constant} matches docs/agent-prompts/${file}`, () => {
      const doc = normalise(readFileSync(path.join(docsDir, file), 'utf8'));
      expect(
        normalise(prompt),
        `docs/agent-prompts/${file} and ${constant} in src/db/seed-prompts.ts have drifted — edit both`,
      ).toBe(doc);
    });
  }

  it('covers every prompt exported by seed-prompts.ts', async () => {
    const exported = Object.keys(await import('../src/db/seed-prompts.js')).filter((k) =>
      k.endsWith('_PROMPT'),
    );
    expect(exported.sort()).toEqual(PAIRS.map((p) => p.constant).sort());
  });
});

/**
 * The Test Quality Reviewer is a shell whose subject matter comes from linked
 * skills. Two properties of that design are load-bearing enough to pin: the
 * CRITICAL list is closed (a skill body is rendered verbatim into the prompt, so
 * nothing but the prompt itself can stop a rule from inventing a blocker), and
 * the agent must never report a coverage figure it cannot measure from a diff.
 */
describe('TEST_QUALITY_REVIEWER_PROMPT invariants', () => {
  it('has no "What to look for" section and points at the skills instead', () => {
    expect(TEST_QUALITY_REVIEWER_PROMPT).not.toMatch(/^#+ What to look for/m);
    expect(TEST_QUALITY_REVIEWER_PROMPT).toContain('## Skills / rules');
  });

  it('closes the CRITICAL list against the linked skills', () => {
    expect(TEST_QUALITY_REVIEWER_PROMPT).toMatch(/CRITICAL list below is closed/);
    expect(TEST_QUALITY_REVIEWER_PROMPT).toMatch(/at most WARNING/);
  });

  it('never states a coverage figure', () => {
    expect(TEST_QUALITY_REVIEWER_PROMPT).not.toMatch(/\d+\s*%/);
    expect(TEST_QUALITY_REVIEWER_PROMPT).toMatch(/Never report a coverage number/);
  });
});
