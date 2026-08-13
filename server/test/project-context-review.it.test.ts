import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { RunTrace } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Db } from '../src/db/client.js';
import { ProjectContextRepository } from '../src/modules/project-context/repository.js';
import { CloneWalker } from '../src/modules/project-context/walk.js';
import { DEFAULT_CONTEXT_ROOTS, MAX_DOC_BYTES } from '../src/modules/project-context/constants.js';

/**
 * Project context **inside a review run** — the wiring in `run-executor.ts`, end
 * to end through `POST /pulls/:id/review`.
 *
 * Three properties of this file are load-bearing.
 *
 *  - **One outer `describe` owns the testcontainer.** Vitest fires an `afterAll`
 *    registered inside a `describe` as soon as that block finishes, so a sibling
 *    top-level block sharing the module-level `db` is handed a closed pool and
 *    every `app.inject` 500s with `CONNECTION_ENDED` (`server/INSIGHTS.md`,
 *    2026-08-10).
 *  - **Live Log assertions read the replay-first SSE buffer**
 *    (`GET /runs/:id/events`), never `GET /runs/:id/trace`: `completeAgentRun`
 *    writes the terminal status ~45 lines before the trace row exists, so the
 *    trace 404s intermittently right after a run finishes (`server/INSIGHTS.md`,
 *    2026-08-05). Trace *content* is therefore read from `run_traces` by polling
 *    until the row appears, which closes the same window.
 *  - **Fixture documents are short, ordinary prose.** `container.tokenizer` is
 *    `js-tiktoken`'s `cl100k_base`, which is quadratic in the length of a single
 *    whitespace-free run (16 KB of one "word" ≈ 23 s), and `resolveForRun`
 *    token-counts every document it reads. The real tokenizer is used here on
 *    purpose — AC-31's `~<n> tokens` is only meaningful if it comes from the
 *    port the editor uses — so the fixtures must stay small and word-broken.
 *
 * The LLM is a `MockLLMProvider` keyed by schema name ('Intent' for the intent
 * classifier the batch derives first, 'Review' for the reviewer), so this
 * asserts WIRING, never model behaviour.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context-review] Docker not available — skipping integration tests.');
}

/** Nested, prose, and each carrying a marker only that document can put in a prompt. */
const RATE_LIMIT_DOC = 'specs/rate-limit.md';
const RATE_LIMIT_TEXT =
  '# Rate limits\n\nEvery public endpoint is capped at 100 requests per minute per token.\n';
const NAMING_DOC = 'docs/deep/naming.md';
const NAMING_TEXT = '# Naming\n\nUse snake case for every column in the database.\n';
const TESTING_DOC = 'insights/testing.md';
const TESTING_TEXT = '# Testing\n\nEvery repository method is covered by a database backed test.\n';
/** Attached while it exists, then deleted before the run reads it (AC-26). */
const VANISHING_DOC = 'specs/vanishes.md';

/**
 * A document past `MAX_DOC_BYTES`, for the AC-24 truncation branch end to end.
 *
 * **Ordinary prose, with whitespace.** `js-tiktoken`'s BPE is quadratic in the
 * length of one unbroken word — 64 KiB of a single letter run measured at
 * minutes in this repo — while the same 64 KiB word-broken counts in ~260 ms, so
 * the real tokenizer stays in play (see the file header) and the case costs one
 * ordinary run. Do not "simplify" this to `'y'.repeat(70_000)`.
 *
 * `OVERSIZED_TAIL` sits past the cap and is the case's negative control: the
 * marker alone would also be appended if the reader had handed the whole file
 * over, so the assertion that this sentinel is absent from the prompt is what
 * proves the cut actually bound.
 */
const OVERSIZED_DOC = 'specs/oversized.md';
const OVERSIZED_TAIL = 'PAST-THE-CAP-SENTINEL';
const OVERSIZED_TEXT = ((): string => {
  const paragraph =
    'Every public endpoint is capped at one hundred requests per minute per token, and the\n' +
    'limiter keeps a rolling window per client so one burst cannot starve the tenant.\n\n';
  let text = '# Oversized runbook\n\n';
  while (Buffer.byteLength(text, 'utf8') <= MAX_DOC_BYTES) text += paragraph;
  return `${text}${OVERSIZED_TAIL}\n`;
})();
const OVERSIZED_BYTES = Buffer.byteLength(OVERSIZED_TEXT, 'utf8');

const INTENT_FIXTURE = {
  intent: 'Add rate limiting to public API endpoints',
  in_scope: ['Add middleware for rate limiting'],
  out_of_scope: [],
};

/** No findings: this suite asserts prompt/trace wiring, not the grounding gate. */
const REVIEW_FIXTURE = { verdict: 'comment', summary: 'Looks fine.', score: 92, findings: [] };

const schemaNameOf = (c: { req: unknown }) => (c.req as { schemaName?: string }).schemaName;
const userMessageOf = (c: { req: unknown }): string =>
  (c.req as { messages: { content: string }[] }).messages.at(-1)?.content ?? '';

d('project context in the review run (Testcontainers pg)', () => {
  let pg: PgFixture;
  let db: Db;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let llm: MockLLMProvider;
  let workspaceId: string;
  let ctxRepo: ProjectContextRepository;

  let cloneDir: string;
  /** A repository with a real clone on disk, and its pull request. */
  let repoId: string;
  let prId: string;
  /**
   * A purpose-made `clone_path: null` repository for AC-30 — never the seeded
   * one: repointing the single seeded repo at a fixture clone is what other
   * suites do, and "the seeded repo" is then no longer a no-clone row
   * (`server/INSIGHTS.md`, 2026-08-03).
   */
  let noCloneRepoId: string;
  let noClonePrId: string;

  let seq = 0;
  const nextName = (kind: string): string => `ctxrun-${kind}-${seq++}`;

  async function newRepo(clonePath: string | null): Promise<string> {
    const name = nextName('repo');
    const [row] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    return row!.id;
  }

  async function newPull(repo: string): Promise<string> {
    const [row] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 4,
        deletions: 0,
        filesCount: 1,
        status: 'open',
      })
      .returning();
    return row!.id;
  }

  async function newAgent(opts: { repoIntel?: boolean } = {}) {
    const [row] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: nextName('agent'),
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'Review the diff.',
        strategy: 'single-pass',
        repoIntel: opts.repoIntel ?? true,
        enabled: true,
      })
      .returning();
    return row!;
  }

  async function newSkill() {
    const [row] = await db
      .insert(t.skills)
      .values({
        workspaceId,
        name: nextName('skill'),
        description: 'a skill',
        type: 'rubric',
        source: 'manual',
        body: '# rule',
        enabled: true,
      })
      .returning();
    return row!;
  }

  /**
   * The trace row, polled into existence. `waitForPrRuns` returns as soon as
   * `agent_runs.status` is terminal, which is written before `saveRunTrace` —
   * polling the row itself is what removes that window, and it exists on the
   * failure path too (`traceFromBuffer`), so this cannot hang on a failed run.
   */
  async function waitForTrace(runId: string, timeoutMs = 20_000): Promise<RunTrace> {
    const start = Date.now();
    for (;;) {
      const [row] = await db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
      if (row) return row.trace as RunTrace;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`no run_traces row for run ${runId} after ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  interface RunResult {
    runId: string;
    status: string | null;
    trace: RunTrace;
    /** The raw SSE payload — the replay-first buffer, complete and race-free. */
    sse: string;
    /** The user message of the Review call this run made. */
    user: string;
  }

  async function review(pull: string, agentId: string): Promise<RunResult> {
    const before = llm.calls.length;
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pull}/review`,
      payload: { agentId },
    });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id as string;

    const trace = await waitForTrace(runId);
    const [run] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);

    const reviewCall = llm.calls.slice(before).find((c) => schemaNameOf(c) === 'Review');
    expect(reviewCall, 'the run reached the reviewer model').toBeDefined();

    return {
      runId,
      status: run!.status,
      trace,
      sse: sse.payload,
      user: userMessageOf(reviewCall!),
    };
  }

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    ({ workspaceId } = await seed(db));
    ctxRepo = new ProjectContextRepository(db);

    // Nested fixture documents: a flat set cannot surface a separator bug (AC-2).
    cloneDir = await mkdtemp(join(tmpdir(), 'devdigest-ctx-review-'));
    await mkdir(join(cloneDir, 'specs'), { recursive: true });
    await mkdir(join(cloneDir, 'docs', 'deep'), { recursive: true });
    await mkdir(join(cloneDir, 'insights'), { recursive: true });
    await writeFile(join(cloneDir, 'specs', 'rate-limit.md'), RATE_LIMIT_TEXT, 'utf8');
    await writeFile(join(cloneDir, 'docs', 'deep', 'naming.md'), NAMING_TEXT, 'utf8');
    await writeFile(join(cloneDir, 'insights', 'testing.md'), TESTING_TEXT, 'utf8');
    await writeFile(join(cloneDir, 'specs', 'vanishes.md'), '# Gone soon\n\nThis file is deleted.\n', 'utf8');
    await writeFile(join(cloneDir, 'specs', 'oversized.md'), OVERSIZED_TEXT, 'utf8');

    llm = new MockLLMProvider('openai', {
      structuredBySchema: { Intent: INTENT_FIXTURE, Review: REVIEW_FIXTURE },
    });
    app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db,
      overrides: {
        // The agents below are `openai`; the intent feature model defaults to
        // `openrouter`. One mock answers both call sites.
        llm: { openai: llm, openrouter: llm },
        git: new MockGitClient(),
        github: new MockGitHubClient(),
      },
    });

    repoId = await newRepo(cloneDir);
    prId = await newPull(repoId);
    noCloneRepoId = await newRepo(null);
    noClonePrId = await newPull(noCloneRepoId);
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
    if (cloneDir) await rm(cloneDir, { recursive: true, force: true });
  });

  it('the fixture clone is real: discovery finds the nested documents', async () => {
    const { docs } = await new CloneWalker().walk(cloneDir, [...DEFAULT_CONTEXT_ROOTS]);
    expect(docs.map((doc) => doc.path).sort()).toEqual(
      [NAMING_DOC, OVERSIZED_DOC, RATE_LIMIT_DOC, TESTING_DOC, VANISHING_DOC].sort(),
    );
    // The oversized fixture really is over the cap — otherwise its case below
    // asserts a truncation that never had to happen.
    expect(docs.find((doc) => doc.path === OVERSIZED_DOC)?.sizeBytes).toBe(OVERSIZED_BYTES);
    expect(OVERSIZED_BYTES).toBeGreaterThan(MAX_DOC_BYTES);
  });

  it('injects the attached document, names it in specs_read, and says so on the Live Log (AC-16, AC-31, AC-34, AC-70, AC-71)', async () => {
    const agent = await newAgent();
    await ctxRepo.replaceAgentAttachments(workspaceId, agent.id, repoId, [RATE_LIMIT_DOC]);

    const run = await review(prId, agent.id);

    expect(run.status).toBe('done');

    // AC-34 — non-null in the persisted trace, carrying the document's own text.
    expect(run.trace.prompt_assembly.specs).not.toBeNull();
    expect(run.trace.prompt_assembly.specs).toContain(RATE_LIMIT_TEXT.trim());
    expect(run.trace.prompt_assembly.specs).toContain('<untrusted source="spec-0">');

    // AC-16/AC-23 — and it reached the model that way, not merely the trace.
    expect(run.user).toContain('## Project context');
    expect(run.user).toContain('<untrusted source="spec-0">');
    expect(run.user).toContain('capped at 100 requests per minute');

    // AC-31 — one entry, formatted by the module's own helper, tokens from the
    // same `Tokenizer` port the editor uses.
    expect(run.trace.specs_read).toHaveLength(1);
    expect(run.trace.specs_read[0]).toMatch(/^specs\/rate-limit\.md \(~\d+ tokens\)$/);

    // AC-70 — on the run's own event stream (AC-71), independently of the trace.
    expect(run.sse).toContain('Project context: 1 attached, 1 read');
    // AC-71 — and BEFORE the model call, so the count is visible in flight.
    // `Reviewing … in one pass` is the engine's first event, emitted immediately
    // before `completeStructured`.
    const summaryAt = run.sse.indexOf('Project context: 1 attached, 1 read');
    const modelAt = run.sse.indexOf('Reviewing 1 changed file(s) in one pass');
    expect(modelAt).toBeGreaterThan(-1);
    expect(summaryAt).toBeGreaterThan(-1);
    expect(summaryAt).toBeLessThan(modelAt);

    // Nothing about the clone's location leaks into the log.
    expect(run.sse).not.toContain(cloneDir);
  });

  it('still reads and injects the documents when the agent has repo_intel off (AC-21)', async () => {
    const agent = await newAgent({ repoIntel: false });
    await ctxRepo.replaceAgentAttachments(workspaceId, agent.id, repoId, [NAMING_DOC]);

    const run = await review(prId, agent.id);

    expect(run.status).toBe('done');
    // The flag really was off for this run — otherwise the case is vacuous.
    expect(run.sse).toContain('Repo intel disabled for this agent');
    expect(run.trace.prompt_assembly.repo_map ?? null).toBeNull();
    expect(run.trace.prompt_assembly.callers ?? null).toBeNull();

    expect(run.trace.prompt_assembly.specs).toContain('snake case for every column');
    expect(run.trace.specs_read).toHaveLength(1);
    expect(run.trace.specs_read[0]).toMatch(/^docs\/deep\/naming\.md \(~\d+ tokens\)$/);
    expect(run.sse).toContain('Project context: 1 attached, 1 read');
  });

  it('reads one direct document plus the two its linked skill carries, in the AC-17 order (AC-69)', async () => {
    const agent = await newAgent();
    const skill = await newSkill();
    await db.insert(t.agentSkills).values({ agentId: agent.id, skillId: skill.id, order: 0 });
    await ctxRepo.replaceAgentAttachments(workspaceId, agent.id, repoId, [RATE_LIMIT_DOC]);
    await ctxRepo.replaceSkillAttachments(workspaceId, skill.id, repoId, [NAMING_DOC, TESTING_DOC]);

    const run = await review(prId, agent.id);

    expect(run.status).toBe('done');
    // Exactly three: the agent's own document first, then the skill's two in the
    // skill's stored order.
    expect(run.trace.specs_read).toHaveLength(3);
    expect(run.trace.specs_read.map((entry) => entry.split(' (~')[0])).toEqual([
      RATE_LIMIT_DOC,
      NAMING_DOC,
      TESTING_DOC,
    ]);
    for (const entry of run.trace.specs_read) expect(entry).toMatch(/ \(~\d+ tokens\)$/);

    // Three wrapped documents in the prompt, in the same order.
    for (const label of ['spec-0', 'spec-1', 'spec-2']) {
      expect(run.user).toContain(`<untrusted source="${label}">`);
    }
    expect(run.user.indexOf('capped at 100 requests')).toBeLessThan(
      run.user.indexOf('snake case for every column'),
    );
    expect(run.user.indexOf('snake case for every column')).toBeLessThan(
      run.user.indexOf('covered by a database backed test'),
    );
    expect(run.sse).toContain('Project context: 3 attached, 3 read');
  });

  it('omits the section and names every attachment unread when the repo has no clone (AC-30)', async () => {
    const agent = await newAgent();
    await ctxRepo.replaceAgentAttachments(workspaceId, agent.id, noCloneRepoId, [RATE_LIMIT_DOC]);

    const run = await review(noClonePrId, agent.id);

    expect(run.status).toBe('done');
    expect(run.trace.prompt_assembly.specs ?? null).toBeNull();
    expect(run.user).not.toContain('## Project context');
    expect(run.trace.specs_read).toEqual([
      'specs/rate-limit.md — not read: no repository clone on disk',
    ]);
    expect(run.sse).toContain('Project context: 1 attached, 0 read');
    expect(run.sse).toContain(
      'Project context: specs/rate-limit.md not read — no repository clone on disk',
    );
  });

  it('completes the run when an attached document was deleted from the clone (AC-26)', async () => {
    const agent = await newAgent();
    // Attached while it exists: the cap and the read both bind at RUN time, so
    // the row survives the file.
    await ctxRepo.replaceAgentAttachments(workspaceId, agent.id, repoId, [VANISHING_DOC]);
    await rm(join(cloneDir, 'specs', 'vanishes.md'));

    const run = await review(prId, agent.id);

    // The run completes — an unreadable document degrades, it never fails.
    expect(run.status).toBe('done');
    expect(run.trace.specs_read).toEqual([
      'specs/vanishes.md — not read: not found in the repository clone',
    ]);
    expect(run.trace.prompt_assembly.specs ?? null).toBeNull();
    expect(run.user).not.toContain('## Project context');
    expect(run.sse).toContain(
      'Project context: specs/vanishes.md not read — not found in the repository clone',
    );
    expect(run.sse).toContain('Project context: 1 attached, 0 read');
  });

  /**
   * AC-24 through a real run: the reader's byte cap, the marker `service.ts`
   * appends, and the Live Log line the executor emits for a `truncated` note —
   * none of which any other case reaches. The hermetic suite drives the same
   * branch through a fake reader that reports `truncated`; what this adds is
   * that a real file on disk, read through `CloneReader`'s handle-plus-buffer
   * path, produces that note at all.
   *
   * The counts say `1 read`, not `0`: a truncated document IS read. Truncation
   * is a `truncated` note, never an `unread` one, and conflating the two would
   * make the summary line disagree with `specs_read`.
   */
  it('injects an oversized document capped, marked, and says so on the Live Log (AC-24)', async () => {
    const agent = await newAgent();
    await ctxRepo.replaceAgentAttachments(workspaceId, agent.id, repoId, [OVERSIZED_DOC]);

    const run = await review(prId, agent.id);

    expect(run.status).toBe('done');

    // The marker, on the text that reached the model — with the real size it was
    // truncated FROM, which is the only reason the reader reports `bytes`.
    const marker = `[truncated: ${MAX_DOC_BYTES} of ${OVERSIZED_BYTES} bytes]`;
    expect(run.user).toContain('## Project context');
    expect(run.user).toContain('# Oversized runbook');
    expect(run.user).toContain(marker);
    // ...and the cut bound: the sentinel past the cap never reached the prompt.
    expect(run.user).not.toContain(OVERSIZED_TAIL);
    expect(run.trace.prompt_assembly.specs).toContain(marker);
    expect(run.trace.prompt_assembly.specs).not.toContain(OVERSIZED_TAIL);

    // Read, not unread — one entry, with a token figure over the injected text.
    expect(run.trace.specs_read).toHaveLength(1);
    expect(run.trace.specs_read[0]).toMatch(/^specs\/oversized\.md \(~\d+ tokens\)$/);

    // The Live Log line, on the SSE buffer (never `/runs/:id/trace`), exactly
    // once, next to a summary that counts the document as read.
    const line = 'Project context: specs/oversized.md truncated to 65536 bytes';
    expect(run.sse).toContain(line);
    expect(run.sse.split(line)).toHaveLength(2);
    expect(run.sse).toContain('Project context: 1 attached, 1 read');
    expect(run.sse).not.toContain('specs/oversized.md not read');
  });

  /**
   * AC-29, the whole claim: project context is best-effort — like repo-intel and
   * unlike linked skills — so a resolution failure logs one line and the prompt
   * carries no `## Project context` section, rather than failing the run.
   *
   * The failure is injected at the service, not at the store, because the
   * executor's `try` wraps exactly one call and this is the layer that call
   * returns from. The container getter memoises, so the spy reaches the very
   * instance `run-executor.ts` uses (`server/INSIGHTS.md`, 2026-07-29) — and the
   * agent has a real, readable attachment, so without the throw this run WOULD
   * have carried a section. `toHaveBeenCalledTimes(1)` is what pins that.
   */
  it('completes the run with no section and one log line when resolution throws (AC-29)', async () => {
    const agent = await newAgent();
    await ctxRepo.replaceAgentAttachments(workspaceId, agent.id, repoId, [RATE_LIMIT_DOC]);

    const resolveForRun = vi
      .spyOn(app.container.projectContext, 'resolveForRun')
      .mockRejectedValue(new Error('context store unavailable'));

    try {
      const run = await review(prId, agent.id);

      // The run completed. That is the acceptance criterion.
      expect(run.status).toBe('done');
      expect(resolveForRun).toHaveBeenCalledTimes(1);

      // No section, in the prompt and in the trace, and no entries.
      expect(run.user).not.toContain('## Project context');
      expect(run.user).not.toContain('capped at 100 requests per minute');
      expect(run.trace.prompt_assembly.specs ?? null).toBeNull();
      expect(run.trace.specs_read).toEqual([]);

      // One line — the failure's own — and not the summary or a per-document
      // line, both of which are emitted after the call that threw.
      const failed = 'project context: resolution failed — context store unavailable';
      expect(run.sse).toContain(failed);
      expect(run.sse.split(failed)).toHaveLength(2);
      expect(run.sse).not.toContain('Project context:');
      // The message is the error's, so nothing about the clone's location or a
      // document's content can ride out on it.
      expect(run.sse).not.toContain(cloneDir);
    } finally {
      resolveForRun.mockRestore();
    }
  });
});
