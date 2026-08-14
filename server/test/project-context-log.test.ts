import { describe, it, expect } from 'vitest';
import {
  MAX_DOC_BYTES,
  UNREAD_REASON,
} from '../src/modules/project-context/constants.js';
import {
  logSummaryLine,
  logTruncatedLine,
  logUnreadLine,
} from '../src/platform/project-context-log.js';

/**
 * The run's three Live Log lines, moved out of
 * `test/project-context-helpers.test.ts` with their assertions unchanged when
 * the formatters moved from `modules/project-context/helpers.ts` to
 * `platform/project-context-log.ts` — only the import path differs, which is
 * what makes that move provably behaviour-preserving.
 *
 * Hermetic: no Docker, no filesystem, no clock.
 */

describe('logSummaryLine', () => {
  it('states zero for a run with nothing attached (AC-72)', () => {
    expect(logSummaryLine(0, 0)).toBe('Project context: 0 attached, 0 read');
  });

  it('states the two counts (AC-70)', () => {
    expect(logSummaryLine(25, 20)).toBe('Project context: 25 attached, 20 read');
  });
});

/**
 * The two per-document Live Log formats. They live in one file rather than
 * inline in `run-executor.ts` for the same reason the trace entries do: the
 * strings are asserted byte for byte, so exactly one file may produce them.
 */
describe('logUnreadLine', () => {
  it('formats the unread line exactly, with an em dash (AC-26)', () => {
    const out = logUnreadLine('specs/a.md', 'not found in the repository clone');
    expect(out).toBe('Project context: specs/a.md not read — not found in the repository clone');
    // By codepoint: a hyphen-minus substituted here reads the same and fails a
    // byte comparison.
    expect(out.codePointAt('Project context: specs/a.md not read '.length)).toBe(0x2014);
    expect(out).not.toContain(' - ');
  });

  it('carries each of the four reasons verbatim', () => {
    expect(logUnreadLine('a.md', UNREAD_REASON.outside)).toBe(
      'Project context: a.md not read — path resolves outside the repository',
    );
    expect(logUnreadLine('a.md', UNREAD_REASON.not_found)).toBe(
      'Project context: a.md not read — not found in the repository clone',
    );
    expect(logUnreadLine('a.md', UNREAD_REASON.no_clone)).toBe(
      'Project context: a.md not read — no repository clone on disk',
    );
    expect(logUnreadLine('a.md', UNREAD_REASON.read_cap)).toBe(
      'Project context: a.md not read — only 20 documents are read per run',
    );
  });
});

describe('logTruncatedLine', () => {
  it('formats the truncation line exactly (AC-24)', () => {
    expect(logTruncatedLine('docs/big.md')).toBe(
      'Project context: docs/big.md truncated to 65536 bytes',
    );
  });

  it('quotes the cap it truncated to, so the line cannot outlive a cap change', () => {
    expect(logTruncatedLine('docs/big.md')).toBe(
      `Project context: docs/big.md truncated to ${MAX_DOC_BYTES} bytes`,
    );
  });
});
