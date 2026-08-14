import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  BYTES_PER_ESTIMATED_TOKEN,
  DEFAULT_CONTEXT_ROOTS,
  MAX_DOCS_PER_RUN,
  MAX_DOC_BYTES,
  MAX_LIST_DOCS,
  MAX_PATH_CHARS,
  SETTINGS_ROOTS_KEY,
  EXCLUDED_DIRS,
  UNREAD_REASON,
} from '../src/modules/project-context/constants.js';
import type { AttachmentRecord, OrderInput } from '../src/modules/project-context/domain.js';
import {
  agentToken,
  applyReadCap,
  capList,
  estimateTokensFromBytes,
  fingerprintAttachments,
  formatSpecRead,
  formatSpecUnread,
  isUnderRoots,
  orderAndDedupe,
  parseRoots,
  sumTokens,
  toPosix,
  truncateForPrompt,
} from '../src/modules/project-context/helpers.js';

/**
 * Hermetic by construction: no `test/helpers/pg.ts`, no Docker, no filesystem.
 * The only `node:path` use is building a *native* fixture path for `toPosix`,
 * which is the one assertion that has to differ per platform to be meaningful.
 */

const att = (path: string, order: number, repoId = 'repo-1'): AttachmentRecord => ({
  path,
  repoId,
  order,
});

// ------------------------------------------------------------------ constants

describe('constants', () => {
  it('carries the exact values the spec fixes', () => {
    expect([...DEFAULT_CONTEXT_ROOTS]).toEqual(['specs', 'docs', 'insights']);
    expect([...EXCLUDED_DIRS]).toEqual([
      '.git',
      'node_modules',
      'dist',
      'build',
      '.next',
      'coverage',
      'out',
      'vendor',
    ]);
    expect(MAX_LIST_DOCS).toBe(500);
    expect(MAX_DOCS_PER_RUN).toBe(20);
    expect(MAX_DOC_BYTES).toBe(65_536);
    expect(MAX_PATH_CHARS).toBe(1024);
    expect(SETTINGS_ROOTS_KEY).toBe('context_roots');
  });

  it('keeps the read-cap reason and the cap itself in step', () => {
    // The reason text quotes the number. If the cap moves and the string does
    // not, AC-25's entry lies about why the document was skipped.
    expect(UNREAD_REASON.read_cap).toBe(
      `only ${MAX_DOCS_PER_RUN} documents are read per run`,
    );
    expect(UNREAD_REASON.outside).toBe('path resolves outside the repository');
    expect(UNREAD_REASON.not_found).toBe('not found in the repository clone');
    expect(UNREAD_REASON.no_clone).toBe('no repository clone on disk');
  });
});

// ------------------------------------------------------------------ toPosix

describe('toPosix', () => {
  it('normalises a nested native path to forward slashes only (AC-2)', () => {
    // Nested on purpose: a flat path cannot surface a separator bug, which is
    // exactly how the depgraph shipped a silent zero-result walk.
    const native = join('server', 'src', 'modules', 'x', 'docs', 'y.md');
    const out = toPosix(native);
    expect(out).toBe('server/src/modules/x/docs/y.md');
    expect(out).not.toContain('\\');
    expect(out.split('/')).toHaveLength(6);
  });

  it('leaves an already-POSIX path alone', () => {
    expect(toPosix('specs/a.md')).toBe('specs/a.md');
  });
});

// ------------------------------------------------------------------ isUnderRoots

describe('isUnderRoots', () => {
  const cases: [string, readonly string[], string | null][] = [
    // AC-1 — a root counts as a path segment at ANY depth.
    ['server/src/modules/x/docs/y.md', DEFAULT_CONTEXT_ROOTS, 'docs'],
    ['specs/a.md', DEFAULT_CONTEXT_ROOTS, 'specs'],
    ['insights/deep/nested/z.md', DEFAULT_CONTEXT_ROOTS, 'insights'],
    // Edge case 4 — root matching is CASE-SENSITIVE (the `.md` check is not).
    ['Specs/a.md', DEFAULT_CONTEXT_ROOTS, null],
    ['SPECS/a.md', DEFAULT_CONTEXT_ROOTS, null],
    ['server/DOCS/a.md', DEFAULT_CONTEXT_ROOTS, null],
    // Segment, not substring.
    ['mydocs/a.md', DEFAULT_CONTEXT_ROOTS, null],
    ['docsy/a.md', DEFAULT_CONTEXT_ROOTS, null],
    ['a/subdocs/b.md', DEFAULT_CONTEXT_ROOTS, null],
    // A root name in the FILE name is not a root directory.
    ['a/docs.md', DEFAULT_CONTEXT_ROOTS, null],
    ['a/specs.md', DEFAULT_CONTEXT_ROOTS, null],
    // Nothing matches.
    ['README.md', DEFAULT_CONTEXT_ROOTS, null],
    ['src/index.ts', DEFAULT_CONTEXT_ROOTS, null],
    // Configured roots replace the defaults, they do not extend them.
    ['adr/0001.md', ['adr'], 'adr'],
    ['specs/a.md', ['adr'], null],
    // Empty configuration matches nothing.
    ['specs/a.md', [], null],
  ];

  for (const [path, roots, expected] of cases) {
    it(`${path} under [${roots.join(', ')}] → ${expected === null ? 'null' : expected}`, () => {
      expect(isUnderRoots(path, roots)).toBe(expected);
    });
  }

  it('returns the shallowest matching segment when two roots are on the path', () => {
    expect(isUnderRoots('docs/specs/a.md', DEFAULT_CONTEXT_ROOTS)).toBe('docs');
    expect(isUnderRoots('specs/docs/a.md', DEFAULT_CONTEXT_ROOTS)).toBe('specs');
  });

  it('does not care about the extension — that check lives in the walker', () => {
    expect(isUnderRoots('docs/notes.txt', DEFAULT_CONTEXT_ROOTS)).toBe('docs');
  });
});

// ------------------------------------------------------------------ parseRoots

describe('parseRoots', () => {
  const defaults = ['specs', 'docs', 'insights'];

  const cases: [string, unknown, string[]][] = [
    // The ordinary case: no settings row at all (AC-3).
    ['undefined (no row)', undefined, defaults],
    ['null', null, defaults],
    // A valid stored value wins.
    ["['adr']", ['adr'], ['adr']],
    ["['specs', 'adr']", ['specs', 'adr'], ['specs', 'adr']],
    // AC-76/AC-77 — anything unparseable degrades to the defaults, never widens.
    ["['../..'] (traversal)", ['../..'], defaults],
    ["['a/b'] (separator)", ['a/b'], defaults],
    ["['a\\\\b'] (backslash)", ['a\\b'], defaults],
    ["['.']", ['.'], defaults],
    ["['..']", ['..'], defaults],
    ["[''] (empty segment)", [''], defaults],
    ["'specs' (string, not array)", 'specs', defaults],
    ['42', 42, defaults],
    ['{}', {}, defaults],
    ['[] (empty array)', [], defaults],
    ['[1, 2]', [1, 2], defaults],
    ["['docs', 'x/y'] (one bad element)", ['docs', 'x/y'], defaults],
  ];

  for (const [label, stored, expected] of cases) {
    it(`${label} → [${expected.join(', ')}]`, () => {
      expect(() => parseRoots(stored)).not.toThrow();
      expect(parseRoots(stored)).toEqual(expected);
    });
  }

  it('never hands back the module constant, so a caller cannot mutate the default', () => {
    const first = parseRoots(undefined);
    expect(first).not.toBe(DEFAULT_CONTEXT_ROOTS as unknown as string[]);
    first.push('etc');
    expect(parseRoots(undefined)).toEqual(defaults);
    expect([...DEFAULT_CONTEXT_ROOTS]).toEqual(defaults);
  });

  it('does not alias the stored array either', () => {
    const stored = ['adr'];
    const out = parseRoots(stored);
    expect(out).toEqual(['adr']);
    out.push('extra');
    expect(stored).toEqual(['adr']);
  });
});

// ------------------------------------------------------------------ capList

describe('capList', () => {
  const docs = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ path: `specs/${String(i).padStart(4, '0')}.md` }));

  it('passes a list at or under the cap through unchanged', () => {
    const out = capList(docs(3), MAX_LIST_DOCS);
    expect(out.docs.map((d) => d.path)).toEqual([
      'specs/0000.md',
      'specs/0001.md',
      'specs/0002.md',
    ]);
    expect(out.omitted).toBe(0);
  });

  it('keeps the first 500 and counts the rest (AC-8)', () => {
    const out = capList(docs(520), MAX_LIST_DOCS);
    expect(out.docs).toHaveLength(500);
    expect(out.omitted).toBe(20);
    expect(out.docs[0]?.path).toBe('specs/0000.md');
    expect(out.docs[499]?.path).toBe('specs/0499.md');
  });

  it('is exact at the boundary', () => {
    expect(capList(docs(500), MAX_LIST_DOCS).omitted).toBe(0);
    expect(capList(docs(501), MAX_LIST_DOCS).omitted).toBe(1);
  });
});

// ------------------------------------------------------------------ orderAndDedupe

describe('orderAndDedupe', () => {
  it('puts agent-attached documents first, then skills in link order (AC-17)', () => {
    const input: OrderInput = {
      direct: [att('specs/d1.md', 0), att('specs/d2.md', 1)],
      skills: [
        { id: 's1', name: 'Skill One', enabled: true, attachments: [att('docs/s1a.md', 0)] },
        { id: 's2', name: 'Skill Two', enabled: true, attachments: [att('docs/s2a.md', 0)] },
      ],
    };
    expect(orderAndDedupe(input).map((d) => d.path)).toEqual([
      'specs/d1.md',
      'specs/d2.md',
      'docs/s1a.md',
      'docs/s2a.md',
    ]);
  });

  it('preserves each owner’s stored order within its own block (AC-17)', () => {
    const input: OrderInput = {
      direct: [att('specs/b.md', 0), att('specs/a.md', 1)],
      skills: [
        {
          id: 's1',
          name: 'Skill One',
          enabled: true,
          attachments: [att('docs/z.md', 0), att('docs/y.md', 1)],
        },
      ],
    };
    expect(orderAndDedupe(input).map((d) => d.path)).toEqual([
      'specs/b.md',
      'specs/a.md',
      'docs/z.md',
      'docs/y.md',
    ]);
  });

  it('labels provenance: direct rows carry no skill, inherited rows name theirs', () => {
    const input: OrderInput = {
      direct: [att('specs/d.md', 0)],
      skills: [
        { id: 's1', name: 'Skill One', enabled: true, attachments: [att('docs/s.md', 0)] },
      ],
    };
    expect(orderAndDedupe(input)).toEqual([
      {
        path: 'specs/d.md',
        repoId: 'repo-1',
        source: 'direct',
        skillId: null,
        skillName: null,
      },
      {
        path: 'docs/s.md',
        repoId: 'repo-1',
        source: 'inherited',
        skillId: 's1',
        skillName: 'Skill One',
      },
    ]);
  });

  it('keeps a path attached both directly and by a skill in the agent’s position (AC-18, edge case 16)', () => {
    const input: OrderInput = {
      direct: [att('specs/shared.md', 0), att('specs/only-direct.md', 1)],
      skills: [
        {
          id: 's1',
          name: 'Skill One',
          enabled: true,
          attachments: [att('specs/shared.md', 0), att('docs/s1.md', 1)],
        },
      ],
    };
    const out = orderAndDedupe(input);
    expect(out.map((d) => d.path)).toEqual([
      'specs/shared.md',
      'specs/only-direct.md',
      'docs/s1.md',
    ]);
    expect(out[0]?.source).toBe('direct');
    expect(out[0]?.skillId).toBeNull();
  });

  it('keeps a path carried by two skills once, in the earlier-linked skill’s position (edge case 17)', () => {
    const input: OrderInput = {
      direct: [],
      skills: [
        { id: 's1', name: 'Skill One', enabled: true, attachments: [att('docs/dup.md', 0)] },
        {
          id: 's2',
          name: 'Skill Two',
          enabled: true,
          attachments: [att('docs/dup.md', 0), att('docs/s2.md', 1)],
        },
      ],
    };
    const out = orderAndDedupe(input);
    expect(out.map((d) => d.path)).toEqual(['docs/dup.md', 'docs/s2.md']);
    expect(out[0]?.skillId).toBe('s1');
    expect(out[0]?.skillName).toBe('Skill One');
  });

  it('contributes nothing for a disabled skill (AC-20, edge case 18)', () => {
    const input: OrderInput = {
      direct: [att('specs/d.md', 0)],
      skills: [
        { id: 's1', name: 'Off', enabled: false, attachments: [att('docs/off.md', 0)] },
        { id: 's2', name: 'On', enabled: true, attachments: [att('docs/on.md', 0)] },
      ],
    };
    expect(orderAndDedupe(input).map((d) => d.path)).toEqual(['specs/d.md', 'docs/on.md']);
  });

  it('does not let a disabled skill claim the position of a document another skill carries', () => {
    const input: OrderInput = {
      direct: [],
      skills: [
        { id: 's1', name: 'Off', enabled: false, attachments: [att('docs/dup.md', 0)] },
        { id: 's2', name: 'On', enabled: true, attachments: [att('docs/dup.md', 0)] },
      ],
    };
    const out = orderAndDedupe(input);
    expect(out).toHaveLength(1);
    expect(out[0]?.skillId).toBe('s2');
  });

  it('normalises the dedupe key, so a native-separator path collides with its POSIX twin', () => {
    const input: OrderInput = {
      direct: [att(join('docs', 'a.md'), 0)],
      skills: [
        { id: 's1', name: 'Skill One', enabled: true, attachments: [att('docs/a.md', 0)] },
      ],
    };
    const out = orderAndDedupe(input);
    expect(out).toHaveLength(1);
    expect(out[0]?.path).toBe('docs/a.md');
  });

  it('returns an empty list for an owner with nothing attached (AC-22 precondition)', () => {
    expect(orderAndDedupe({ direct: [], skills: [] })).toEqual([]);
  });
});

// ------------------------------------------------------------------ applyReadCap

describe('applyReadCap', () => {
  const ordered = orderAndDedupe({
    direct: Array.from({ length: 25 }, (_, i) => att(`specs/${String(i).padStart(2, '0')}.md`, i)),
    skills: [],
  });

  it('reads the first 20 in order and drops the rest in order (AC-25)', () => {
    const { read, dropped } = applyReadCap(ordered, MAX_DOCS_PER_RUN);
    expect(read).toHaveLength(20);
    expect(dropped).toHaveLength(5);
    expect(read[0]?.path).toBe('specs/00.md');
    expect(read[19]?.path).toBe('specs/19.md');
    expect(dropped.map((d) => d.path)).toEqual([
      'specs/20.md',
      'specs/21.md',
      'specs/22.md',
      'specs/23.md',
      'specs/24.md',
    ]);
  });

  it('drops nothing at or under the cap', () => {
    const { read, dropped } = applyReadCap(ordered.slice(0, 20), MAX_DOCS_PER_RUN);
    expect(read).toHaveLength(20);
    expect(dropped).toEqual([]);
  });
});

// ------------------------------------------------------------------ truncateForPrompt

describe('truncateForPrompt', () => {
  it('returns the input unchanged at exactly the cap', () => {
    const text = 'a'.repeat(MAX_DOC_BYTES);
    expect(truncateForPrompt(text, MAX_DOC_BYTES, MAX_DOC_BYTES)).toBe(text);
  });

  it('returns the input unchanged below the cap', () => {
    expect(truncateForPrompt('short', 5, MAX_DOC_BYTES)).toBe('short');
  });

  it('appends the exact marker after a newline when the cap bound (AC-24)', () => {
    const head = 'a'.repeat(MAX_DOC_BYTES);
    const out = truncateForPrompt(head, 3_145_728, MAX_DOC_BYTES);
    expect(out).toBe(`${head}\n[truncated: 65536 of 3145728 bytes]`);
  });

  it('caps by bytes, not characters', () => {
    // 'é' is two UTF-8 bytes: a 10-byte cap keeps five of them, not ten.
    const out = truncateForPrompt('é'.repeat(100), 200, 10);
    expect(out).toBe(`${'é'.repeat(5)}\n[truncated: 10 of 200 bytes]`);
  });
});

// ------------------------------------------------------------------ trace formats

describe('formatSpecRead', () => {
  it('formats the read entry exactly (AC-31)', () => {
    expect(formatSpecRead('specs/a.md', 412)).toBe('specs/a.md (~412 tokens)');
  });

  it('matches the pattern the review it-test asserts', () => {
    expect(formatSpecRead('specs/rate-limit.md', 7)).toMatch(
      /^specs\/rate-limit\.md \(~\d+ tokens\)$/,
    );
  });
});

describe('formatSpecUnread', () => {
  it('formats the unread entry exactly, with an em dash (AC-32)', () => {
    const out = formatSpecUnread('specs/a.md', 'no repository clone on disk');
    expect(out).toBe('specs/a.md — not read: no repository clone on disk');
    // Assert the dash by codepoint: a hyphen-minus here passes a careless
    // eyeball and fails a byte comparison.
    expect(out.codePointAt('specs/a.md '.length)).toBe(0x2014);
    expect(out).not.toContain(' - ');
  });

  it('carries each of the four reasons verbatim', () => {
    expect(formatSpecUnread('a.md', UNREAD_REASON.outside)).toBe(
      'a.md — not read: path resolves outside the repository',
    );
    expect(formatSpecUnread('a.md', UNREAD_REASON.not_found)).toBe(
      'a.md — not read: not found in the repository clone',
    );
    expect(formatSpecUnread('a.md', UNREAD_REASON.no_clone)).toBe(
      'a.md — not read: no repository clone on disk',
    );
    expect(formatSpecUnread('a.md', UNREAD_REASON.read_cap)).toBe(
      'a.md — not read: only 20 documents are read per run',
    );
  });
});

// The run's three Live Log lines moved to `platform/project-context-log.ts`
// with the formatters; their assertions live in `project-context-log.test.ts`.

// ------------------------------------------------------------------ sumTokens

describe('sumTokens', () => {
  it('sums the token estimates', () => {
    expect(
      sumTokens([
        { path: 'specs/a.md', token_estimate: 100 },
        { path: 'docs/b.md', token_estimate: 25 },
      ]),
    ).toBe(125);
  });

  it('counts a duplicated path once (AC-67)', () => {
    expect(
      sumTokens([
        { path: 'specs/a.md', token_estimate: 100 },
        { path: 'specs/a.md', token_estimate: 100 },
        { path: 'docs/b.md', token_estimate: 25 },
      ]),
    ).toBe(125);
  });

  it('keeps the first occurrence’s estimate when duplicates disagree', () => {
    expect(
      sumTokens([
        { path: 'specs/a.md', token_estimate: 100 },
        { path: 'specs/a.md', token_estimate: 999 },
      ]),
    ).toBe(100);
  });

  it('is zero for an empty set', () => {
    expect(sumTokens([])).toBe(0);
  });
});

// ------------------------------------------------------- estimateTokensFromBytes

/**
 * The document list's figure. It has no reader and no tokenizer behind it on
 * purpose — the exact count over 500 documents blocked the event loop for
 * minutes, and the client refetches the list on every checkbox tick.
 */
describe('estimateTokensFromBytes', () => {
  it('is ceil(bytes / 4)', () => {
    expect(estimateTokensFromBytes(0)).toBe(0);
    expect(estimateTokensFromBytes(1)).toBe(1);
    expect(estimateTokensFromBytes(4)).toBe(1);
    expect(estimateTokensFromBytes(5)).toBe(2);
    expect(estimateTokensFromBytes(8)).toBe(2);
    expect(estimateTokensFromBytes(65_536)).toBe(16_384);
  });

  it('never reports a non-empty document as zero tokens', () => {
    for (const bytes of [1, 2, 3, 7, 4095]) {
      expect(estimateTokensFromBytes(bytes)).toBeGreaterThan(0);
    }
  });

  it('is total: a nonsensical size is zero, never NaN or negative', () => {
    expect(estimateTokensFromBytes(-1)).toBe(0);
    expect(estimateTokensFromBytes(Number.NaN)).toBe(0);
  });

  /**
   * R2, the same defect class: a figure that states tokens no run is billed for.
   * The reader stops at `MAX_DOC_BYTES`, so a 3 MB attachment contributes
   * `MAX_DOC_BYTES / 4` and not `3 MB / 4` — unclamped it read ~786,432 tokens
   * against a run that injects at most 16,384. The clamp is inside the estimator
   * so the document list and the attachment view cannot disagree per row.
   */
  it('clamps the byte count to MAX_DOC_BYTES — the run never injects more (R2)', () => {
    const capped = MAX_DOC_BYTES / BYTES_PER_ESTIMATED_TOKEN;

    expect(estimateTokensFromBytes(3 * 1024 * 1024)).toBe(capped);
    expect(estimateTokensFromBytes(MAX_DOC_BYTES)).toBe(capped);
    expect(estimateTokensFromBytes(MAX_DOC_BYTES + 1)).toBe(capped);
    // Below the cap nothing changed: the clamp is a ceiling, not a rescale.
    expect(estimateTokensFromBytes(MAX_DOC_BYTES - 4)).toBe(capped - 1);
    expect(estimateTokensFromBytes(Number.MAX_SAFE_INTEGER)).toBe(capped);
  });
});

// -------------------------------------------------------------- concurrency

/**
 * LU. The two concurrency tokens. Both are opaque above these functions —
 * compared for equality, never ordered or parsed — and both are produced in
 * exactly one place so the write that compares a token and the view that hands
 * it out cannot drift.
 */
describe('agentToken', () => {
  it('is the agent version, as a string', () => {
    expect(agentToken(1)).toBe('1');
    expect(agentToken(42)).toBe('42');
  });

  it('distinguishes consecutive versions, which is the whole job', () => {
    expect(agentToken(7)).not.toBe(agentToken(8));
  });

  it('fits the wire bound on expected_version', () => {
    expect(agentToken(Number.MAX_SAFE_INTEGER).length).toBeLessThanOrEqual(64);
  });
});

describe('fingerprintAttachments', () => {
  it('is stable for the same set', () => {
    expect(fingerprintAttachments(['specs/a.md', 'docs/b.md'])).toBe(
      fingerprintAttachments(['specs/a.md', 'docs/b.md']),
    );
  });

  /**
   * Order-sensitive, because reordering *is* an edit here — the editor's drag
   * writes a new `order` column and nothing else. A fingerprint that ignored
   * order would accept a replace computed against the other arrangement.
   */
  it('moves when the order moves', () => {
    expect(fingerprintAttachments(['a.md', 'b.md'])).not.toBe(
      fingerprintAttachments(['b.md', 'a.md']),
    );
  });

  it('moves when a document is added or removed', () => {
    const one = fingerprintAttachments(['specs/a.md']);
    expect(one).not.toBe(fingerprintAttachments(['specs/a.md', 'specs/b.md']));
    expect(one).not.toBe(fingerprintAttachments([]));
    expect(one).not.toBe(fingerprintAttachments(['specs/b.md']));
  });

  /**
   * The empty set has a token too. "Nothing attached" is a state a client can
   * legitimately have read and be replacing, so it needs a value that satisfies
   * the contract's `min(1)` rather than an empty string.
   */
  it('gives the empty set a non-empty token', () => {
    expect(fingerprintAttachments([]).length).toBeGreaterThan(0);
    expect(fingerprintAttachments([])).toBe(fingerprintAttachments([]));
  });

  /**
   * A token has to survive the wire bound at the largest set the contract
   * accepts — `MAX_LIST_DOCS` paths of `MAX_PATH_CHARS` each — because the client
   * echoes it back into `expected_version`, which is `max(64)`.
   */
  it('is a fixed short length whatever the set size', () => {
    const many = Array.from({ length: MAX_LIST_DOCS }, () => 'a'.repeat(MAX_PATH_CHARS));
    expect(fingerprintAttachments(many).length).toBeLessThanOrEqual(64);
    expect(fingerprintAttachments(['a.md']).length).toBeLessThanOrEqual(64);
  });

  /**
   * A separator collision would make two different sets share a token, and a
   * shared token is a **missed** rejection — the silent lost update this exists
   * to stop. The paths that could collide on a `\n` join are refused at the write
   * boundary (`requireRelativePath` rejects every control character), but the
   * count prefix makes the near-miss cases differ regardless.
   */
  it('separates sets that would collide on a naive join', () => {
    expect(fingerprintAttachments(['a\nb'])).not.toBe(fingerprintAttachments(['a', 'b']));
  });
});

// ------------------------------------------------------------------ agreement

describe('the deduped set is one set', () => {
  /**
   * AC-64/AC-66/AC-67 must not be able to disagree with AC-18: the editor's
   * footer and the run's `specs` array are the same deduped set, so they are
   * asserted against each other here.
   *
   * This used to compare `orderAndDedupe` against `effectiveSet` as well. That
   * second ordering has been deleted — both funnelled into the same
   * `dedupeByPath`, so the comparison only ever proved that one function called
   * another, while a second implementation of "the effective set" is precisely
   * how the editor footer and the run drift apart later.
   */
  it('has orderAndDedupe and sumTokens agree on the same fixture', () => {
    const direct = [att('specs/shared.md', 0), att('specs/direct.md', 1)];
    const inherited = [
      { path: 'specs/shared.md', skillId: 's1', skillName: 'Skill One' },
      { path: 'docs/s1.md', skillId: 's1', skillName: 'Skill One' },
      { path: 'docs/s1.md', skillId: 's2', skillName: 'Skill Two' },
    ];
    const ordered = orderAndDedupe({
      direct,
      skills: [
        {
          id: 's1',
          name: 'Skill One',
          enabled: true,
          attachments: [att('specs/shared.md', 0), att('docs/s1.md', 1)],
        },
        { id: 's2', name: 'Skill Two', enabled: true, attachments: [att('docs/s1.md', 0)] },
      ],
    });

    expect(ordered.map((d) => d.path)).toEqual([
      'specs/shared.md',
      'specs/direct.md',
      'docs/s1.md',
    ]);
    // Direct first, in the agent's position, and the both-attached path reads
    // as `direct` (AC-66, AC-67).
    expect(ordered.map((d) => d.source)).toEqual(['direct', 'direct', 'inherited']);
    expect(ordered.map((d) => d.skillId)).toEqual([null, null, 's1']);

    // The footer figure equals the figure the run injects: three documents at
    // 10 tokens each, even though five rows were attached.
    const rows = [
      ...direct.map((d) => ({ path: d.path, token_estimate: 10 })),
      ...inherited.map((r) => ({ path: r.path, token_estimate: 10 })),
    ];
    expect(sumTokens(rows)).toBe(ordered.length * 10);
  });
});
