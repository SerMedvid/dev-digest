import { describe, it, expect } from 'vitest';
import {
  ContextAttachmentRow,
  ContextAttachmentsUpdate,
  ContextAttachmentsView,
  ContextDoc,
  ContextDocContent,
  ContextDocList,
  ContextPreview,
  ContextRootSegment,
  SettingsKnown,
  SettingsUpdate,
} from '@devdigest/shared';
import { MAX_LIST_DOCS } from '../src/modules/project-context/constants.js';

describe('project-context contracts', () => {
  const doc = {
    path: 'specs/reviews/grounding.md',
    root: 'specs',
    size_bytes: 4096,
    token_estimate: 980,
    used_by_agents: 2,
  };

  it('parses a well-formed document list', () => {
    const list = ContextDocList.parse({
      status: 'ok',
      roots: ['specs', 'docs', 'insights'],
      docs: [doc],
      omitted: 0,
      scanned_at: '2026-08-13T10:00:00.000Z',
    });
    expect(list.docs).toHaveLength(1);
    expect(list.docs[0]).toMatchObject({ root: 'specs', token_estimate: 980 });
  });

  it('parses a no_clone document list with no documents', () => {
    const list = ContextDocList.parse({
      status: 'no_clone',
      roots: ['specs', 'docs', 'insights'],
      docs: [],
      omitted: 0,
      scanned_at: '2026-08-13T10:00:00.000Z',
    });
    expect(list.status).toBe('no_clone');
    expect(list.docs).toEqual([]);
  });

  it('rejects a status outside the closed enum', () => {
    expect(
      ContextDocList.safeParse({
        status: 'error',
        roots: [],
        docs: [],
        omitted: 0,
        scanned_at: '2026-08-13T10:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('requires every ContextDoc field', () => {
    const { token_estimate, ...rest } = doc;
    expect(ContextDoc.safeParse(rest).success).toBe(false);
  });

  // ---- context_roots in SettingsKnown (AC-74) ----
  describe('SettingsKnown.context_roots', () => {
    it('defaults to specs/docs/insights', () => {
      expect(SettingsKnown.parse({}).context_roots).toEqual(['specs', 'docs', 'insights']);
    });

    it('accepts single-segment roots', () => {
      expect(SettingsKnown.parse({ context_roots: ['specs', 'adr'] }).context_roots).toEqual([
        'specs',
        'adr',
      ]);
    });

    for (const bad of ['../x', 'a/b', 'a\\b', '.', '..', '']) {
      it(`rejects ${JSON.stringify(bad)} as a root`, () => {
        expect(SettingsKnown.safeParse({ context_roots: [bad] }).success).toBe(false);
        expect(ContextRootSegment.safeParse(bad).success).toBe(false);
      });
    }

    // This is what makes AC-75 a 422 rather than a silent write: `SettingsUpdate`
    // is the PUT /settings body schema, and a Zod body failure is a 422.
    it('rejects a traversal root through SettingsUpdate', () => {
      expect(SettingsUpdate.safeParse({ context_roots: ['../..'] }).success).toBe(false);
    });

    it('still accepts a valid partial update', () => {
      expect(SettingsUpdate.safeParse({ context_roots: ['specs'] }).success).toBe(true);
    });
  });

  // ---- attachments ----
  it('parses an attachments view with a direct and an inherited row', () => {
    const view = ContextAttachmentsView.parse({
      direct_count: 1,
      effective_count: 2,
      discovered_count: 7,
      token_estimate: 1500,
      rows: [
        {
          path: 'specs/reviews/grounding.md',
          root: 'specs',
          size_bytes: 4096,
          token_estimate: 980,
          repo_id: '11111111-1111-1111-1111-111111111111',
          source: 'direct',
          skill_id: null,
          skill_name: null,
          missing: false,
        },
        {
          path: 'docs/adr/0001-onion.md',
          root: 'docs',
          size_bytes: 2048,
          token_estimate: 520,
          repo_id: '11111111-1111-1111-1111-111111111111',
          source: 'inherited',
          skill_id: '22222222-2222-2222-2222-222222222222',
          skill_name: 'Onion architecture',
          missing: true,
        },
      ],
    });
    expect(view.rows.map((r) => r.source)).toEqual(['direct', 'inherited']);
  });

  it('rejects a source outside the closed enum', () => {
    expect(
      ContextAttachmentRow.safeParse({
        path: 'specs/a.md',
        root: 'specs',
        size_bytes: 1,
        token_estimate: 1,
        repo_id: '11111111-1111-1111-1111-111111111111',
        source: 'discovered',
        skill_id: null,
        skill_name: null,
        missing: false,
      }).success,
    ).toBe(false);
  });

  it('accepts an attachments update and rejects a 1025-character path', () => {
    const repo_id = '11111111-1111-1111-1111-111111111111';
    expect(
      ContextAttachmentsUpdate.safeParse({ repo_id, paths: ['specs/a.md'] }).success,
    ).toBe(true);
    expect(
      ContextAttachmentsUpdate.safeParse({ repo_id, paths: ['a'.repeat(1025)] }).success,
    ).toBe(false);
    expect(
      ContextAttachmentsUpdate.safeParse({ repo_id, paths: ['a'.repeat(1024)] }).success,
    ).toBe(true);
    expect(ContextAttachmentsUpdate.safeParse({ repo_id, paths: [''] }).success).toBe(false);
    expect(ContextAttachmentsUpdate.safeParse({ repo_id: 'nope', paths: [] }).success).toBe(
      false,
    );
  });

  /**
   * The array bound, not just the element bound. `replaceAgentAttachments`
   * inserts every path in one multi-row `INSERT` at 7 bind parameters per row,
   * so an unbounded list stops being a 422 and becomes a 500 the moment it
   * passes Postgres' 65,535-parameter ceiling (~9,360 paths). The cap is
   * `MAX_LIST_DOCS`: a client cannot attach more documents than discovery will
   * ever show it.
   */
  it('caps the attachment set at MAX_LIST_DOCS paths', () => {
    const repo_id = '11111111-1111-1111-1111-111111111111';
    const paths = (n: number): string[] =>
      Array.from({ length: n }, (_, i) => `specs/doc-${i}.md`);
    expect(
      ContextAttachmentsUpdate.safeParse({ repo_id, paths: paths(MAX_LIST_DOCS) }).success,
    ).toBe(true);
    expect(
      ContextAttachmentsUpdate.safeParse({ repo_id, paths: paths(MAX_LIST_DOCS + 1) }).success,
    ).toBe(false);
    // The number the module works to and the number the wire enforces are the
    // same one; a drift here is what makes the endpoint 500 instead of 422.
    expect(MAX_LIST_DOCS).toBe(500);
  });

  /**
   * LU. `expected_version` is the optimistic-concurrency token — the
   * `ContextAttachmentsView.version` the client believed it was replacing —
   * carried in the body of the edit it belongs to.
   *
   * It is **optional** on purpose: the client half is wired separately, and a
   * caller that omits it keeps the previous last-writer-wins behaviour, which is
   * what makes this a compatible addition rather than a breaking one. It is
   * bounded because it is client-supplied and only ever compared for equality.
   */
  it('accepts an attachments update with, and without, an expected version (LU)', () => {
    const repo_id = '11111111-1111-1111-1111-111111111111';
    const body = { repo_id, paths: ['specs/a.md'] };

    expect(ContextAttachmentsUpdate.parse(body).expected_version).toBeUndefined();
    expect(
      ContextAttachmentsUpdate.parse({ ...body, expected_version: '7' }).expected_version,
    ).toBe('7');
    // A fingerprint token (the skill owner's) also fits comfortably.
    expect(
      ContextAttachmentsUpdate.safeParse({ ...body, expected_version: '3-1a2b3c4d5e6f7081' })
        .success,
    ).toBe(true);
    expect(
      ContextAttachmentsUpdate.safeParse({ ...body, expected_version: '' }).success,
    ).toBe(false);
    expect(
      ContextAttachmentsUpdate.safeParse({ ...body, expected_version: 'v'.repeat(65) }).success,
    ).toBe(false);
    // A number is not a token: the field is opaque and compared as a string, so
    // coercion here would let `7` and `'7'` mean the same thing on one side of
    // the wire and not the other.
    expect(
      ContextAttachmentsUpdate.safeParse({ ...body, expected_version: 7 }).success,
    ).toBe(false);
  });

  /**
   * R2 + LU on the response side: the per-row read-cap signal and the view's own
   * token. Both are optional on the wire so a reader written before them still
   * validates — an absent `beyond_read_cap` means exactly what it meant before
   * the flag existed — and the server always sets both.
   */
  it('carries the read-cap signal and the view token, both optional (R2, LU)', () => {
    const row = {
      path: 'specs/a.md',
      root: 'specs',
      size_bytes: 1,
      token_estimate: 1,
      repo_id: '11111111-1111-1111-1111-111111111111',
      source: 'direct' as const,
      skill_id: null,
      skill_name: null,
      missing: false,
    };

    expect(ContextAttachmentRow.parse(row).beyond_read_cap).toBeUndefined();
    expect(
      ContextAttachmentRow.parse({ ...row, beyond_read_cap: true }).beyond_read_cap,
    ).toBe(true);
    expect(
      ContextAttachmentRow.safeParse({ ...row, beyond_read_cap: 'yes' }).success,
    ).toBe(false);

    const view = {
      direct_count: 1,
      effective_count: 1,
      discovered_count: 1,
      token_estimate: 1,
      rows: [row],
    };
    expect(ContextAttachmentsView.parse(view).version).toBeUndefined();
    expect(ContextAttachmentsView.parse({ ...view, version: '4' }).version).toBe('4');
    expect(ContextAttachmentsView.safeParse({ ...view, version: '' }).success).toBe(false);
  });

  // ---- document content + serialisation preview ----
  it('parses truncated document content and a preview block', () => {
    const content = ContextDocContent.parse({
      path: 'specs/reviews/grounding.md',
      content: '# Grounding\n',
      size_bytes: 12,
      truncated: false,
    });
    expect(content.truncated).toBe(false);

    const preview = ContextPreview.parse({
      block: '## Project context\n<untrusted source="spec-0">\nhi\n</untrusted>',
      unread: ['docs/missing.md — not read: not found in the repository clone'],
    });
    expect(preview.unread).toHaveLength(1);
  });
});
