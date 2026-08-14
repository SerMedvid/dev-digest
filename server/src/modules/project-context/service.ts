// The `prompt.js` SUBPATH, never the package barrel. `@devdigest/reviewer-core`
// re-exports `OpenRouterProvider`, whose first line is `import OpenAI from
// 'openai'` — and `tsPreCompilationDeps: true` makes that a real edge, so the
// barrel import puts the OpenAI SDK in this module's core dependency graph.
// `core-no-sdk` matches the direct edge only and stays green either way, which
// is exactly why this has to be a convention rather than a gate.
// `prompt.ts` itself imports only `@devdigest/shared` and `./intent/prompt.js`.
import { wrapUntrusted } from '@devdigest/reviewer-core/prompt.js';
import type {
  ContextAttachmentRow,
  ContextAttachmentsView,
  ContextDocContent,
  ContextDocList,
  ContextPreview,
} from '@devdigest/shared';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import {
  MAX_DOCS_PER_RUN,
  MAX_DOC_BYTES,
  MAX_PATH_CHARS,
  UNREAD_REASON,
} from './constants.js';
import {
  agentToken,
  applyReadCap,
  estimateTokensFromBytes,
  fingerprintAttachments,
  formatSpecRead,
  formatSpecUnread,
  isUnderRoots,
  orderAndDedupe,
  sumTokens,
  toPosix,
  truncateForPrompt,
} from './helpers.js';
import type {
  AttachmentsToken,
  OrderInput,
  OrderedDoc,
  OwnerKind,
  RepoRef,
  ReplaceOutcome,
  UnreadReason,
} from './domain.js';
import type {
  ContextFileReader,
  DiscoveredDoc,
  ProjectContextDeps,
  RunNote,
  RunResolution,
} from './ports.js';

/**
 * The project-context use-cases: discover documents in a repository clone,
 * attach them to an agent or a skill, and resolve the attached set into the
 * `specs` array a review run injects.
 *
 * Three properties are load-bearing.
 *
 *  - **Workspace containment is this file's job.** `store.attachmentsFor` and
 *    `store.resolveForRun` take no `workspaceId` and filter none — they trust
 *    their caller. So every method here resolves the owner *first* through
 *    `getRepo`, `agentBundle`, `skillOwner` or the workspace-scoped
 *    `replaceAgentAttachments`, all of which do filter, and passes on only ids
 *    that resolution returned. A method that forwarded a client-supplied id
 *    straight into `attachmentsFor` would be an IDOR.
 *  - **Both caps bind at read time, never at attach time** (AC-11, AC-24,
 *    AC-25). A document may grow after it was attached, so a cap applied when
 *    the checkbox was ticked is a cap that does not bind. Nothing here refuses
 *    an attachment for being large.
 *  - **Document text is untrusted, author-controlled content.** It reaches the
 *    model only as the `specs` slot, which `assemblePrompt` wraps as
 *    `<untrusted source="spec-N">`; this file's only serialisation
 *    (`serialiseSpecs`) reproduces that byte for byte through the *same*
 *    `wrapUntrusted`, so the preview cannot drift from the prompt (AC-49).
 *    Nothing here logs document content or the clone's absolute path.
 *
 * No fs, no SQL, no HTTP: the filesystem arrives as two ports and the database
 * as one, so every case above is provable without Docker.
 */
export class ProjectContextService {
  constructor(private deps: ProjectContextDeps) {}

  // ------------------------------------------------------------- discovery

  /**
   * The repository's document list (AC-6, AC-9). Both arms of AC-7 — no
   * `clone_path` at all, **and** a `clone_path` whose directory is not on disk —
   * yield an empty list with the `no_clone` status and no throw, which is what
   * makes the route a 200 rather than a 5xx. The second arm can only come from
   * the walker: `docs: []` is the same value a cloned-but-empty repository
   * produces, and the client renders two different empty states off the
   * difference (AC-40 vs AC-41).
   *
   * **This endpoint reads nothing.** The token figure is `ceil(size_bytes / 4)`
   * over the size `stat()` already returned during the walk, and the UI labels
   * it `≈`. Running the real tokenizer here was a measured event-loop stall:
   * `js-tiktoken`'s `bytePairMerge` is quadratic in one unbroken letter run
   * (4 KiB → 1.2 s, 8 KiB → 5.7 s, extrapolating to ~370 s at the 64 KiB read
   * cap), it is synchronous pure JS, and the client refetches this list on
   * **every checkbox tick** because the mutation invalidates its query. The real
   * tokenizer stays where the number is spent: the attachment view (`≈ N tokens`
   * against what the run injects) and the run trace. Do not reintroduce a read
   * here.
   */
  async listDocuments(workspaceId: string, repoId: string): Promise<ContextDocList> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const roots = await this.deps.store.roots(workspaceId);

    const noClone = (): ContextDocList => ({
      status: 'no_clone',
      roots,
      docs: [],
      omitted: 0,
      scanned_at: new Date().toISOString(),
    });

    if (repo.clonePath === null) return noClone();

    const startedAt = Date.now();
    const { docs, omitted, cloneMissing } = await this.deps.walker.walk(repo.clonePath, roots);
    // Set, but not on disk: the same degraded state as a null `clone_path`, and
    // reported as such rather than as an empty clone (AC-7).
    if (cloneMissing) return noClone();

    const usage = await this.deps.store.usageCounts(workspaceId, repoId);
    // Paths, counts and a duration — never content, never the clone's path.
    this.deps.logger?.info(
      { repoId, documents: docs.length, omitted, durationMs: Date.now() - startedAt },
      'project-context discovery',
    );

    return {
      status: 'ok',
      roots,
      omitted,
      scanned_at: new Date().toISOString(),
      docs: docs.map((doc) => ({
        path: doc.path,
        root: doc.root,
        size_bytes: doc.sizeBytes,
        token_estimate: estimateTokensFromBytes(doc.sizeBytes),
        // `usageCounts` keeps a path in the map with 0 when it is reachable only
        // through a disabled skill, so `?? 0` covers "never attached" only.
        used_by_agents: usage.get(doc.path) ?? 0,
      })),
    };
  }

  /**
   * One document's text for the read-only preview.
   *
   * The path is client-supplied and is **not** trusted for having appeared in a
   * discovery result: it is re-confined by `deps.reader`, which resolves it
   * lexically against the clone root and again through `realpath` before opening
   * anything. Every failure — escaping, absent, or not a document this feature
   * reads — is a `NotFoundError` carrying the fixed reason string and nothing
   * else: no resolved path, no absolute path, no file content, and not the
   * client's own input echoed back.
   */
  async readDocument(
    workspaceId: string,
    repoId: string,
    path: string,
  ): Promise<ContextDocContent> {
    if (path.length === 0 || path.length > MAX_PATH_CHARS) {
      throw new ValidationError('path must be a repo-relative path');
    }
    const repo = await this.requireRepo(workspaceId, repoId);
    if (repo.clonePath === null) throw new NotFoundError(UNREAD_REASON.no_clone);

    const reader = await this.deps.reader.open(repo.clonePath);
    const result = await reader.read(path, MAX_DOC_BYTES);
    if (!result.ok) throw new NotFoundError(unreadReasonFor(result.reason));

    return {
      path: toPosix(path),
      content: result.text,
      size_bytes: result.bytes,
      truncated: result.truncated,
    };
  }

  // ----------------------------------------------------------- attachments

  /**
   * The agent editor's Context tab: the agent's own documents plus those
   * inherited from its **enabled** linked skills, deduped (AC-61…AC-67).
   *
   * `agentBundle` filters `workspaceId`, so a well-formed id belonging to
   * another workspace is `undefined` here and a 404 at the route — never a 403
   * (AC-14).
   */
  async attachmentsForAgent(
    workspaceId: string,
    agentId: string,
    repoId: string,
  ): Promise<ContextAttachmentsView> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const bundle = await this.deps.store.agentBundle(workspaceId, agentId, repo.id);
    if (bundle === undefined) throw new NotFoundError('Agent not found');
    return this.attachmentsView(
      workspaceId,
      repo,
      'agent',
      agentId,
      bundle,
      agentToken(bundle.version),
    );
  }

  /**
   * The skill editor's section. A skill inherits nothing, so every row is
   * `direct` and the effective set is the stored set.
   */
  async attachmentsForSkill(
    workspaceId: string,
    skillId: string,
    repoId: string,
  ): Promise<ContextAttachmentsView> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const owner = await this.requireSkill(workspaceId, skillId);
    const direct = await this.deps.store.attachmentsFor('skill', owner.id, repo.id);
    return this.attachmentsView(
      workspaceId,
      repo,
      'skill',
      owner.id,
      { direct, skills: [] },
      // The stored set *as stored* — before the dedupe and before the
      // cross-repository rows are appended — because that is what the write
      // compares against under its lock.
      fingerprintAttachments(direct.map((record) => record.path)),
    );
  }

  /**
   * Replace one owner's attachment set for one repository and return the fresh
   * view, so the client's optimistic state reconciles in one round trip (AC-43,
   * AC-44).
   *
   * The two owner kinds 404 differently because the repository does: the agent
   * write is workspace-scoped and reports `not_found` when the agent is not this
   * workspace's (having written nothing), while the skill's 404 message can only
   * come from `skillOwner` — so the skill is resolved **before** the write, or a
   * cross-workspace request would silently look like a success.
   *
   * `expectedVersion` is the client's optimistic-concurrency token, and the
   * `stale` outcome is a **409**: the request was well formed and the owner
   * exists, but the state it was computed against has moved, so applying this
   * whole-set body would delete somebody else's edit. Without it, two overlapping
   * replaces commit in lock-acquisition order rather than send order and the
   * earlier body can silently win. It is optional, so a caller that sends none
   * keeps the old last-writer-wins behaviour.
   */
  async setAttachments(
    workspaceId: string,
    owner: { kind: OwnerKind; id: string },
    repoId: string,
    paths: string[],
    expectedVersion?: AttachmentsToken,
  ): Promise<ContextAttachmentsView> {
    const repo = await this.requireRepo(workspaceId, repoId);
    // Defence in depth: a stored path is only ever read back through the
    // confined reader, but there is no reason to persist a path that could not
    // possibly name a document inside the clone.
    const clean = paths.map((path) => requireRelativePath(path));

    if (owner.kind === 'agent') {
      const outcome = await this.deps.store.replaceAgentAttachments(
        workspaceId,
        owner.id,
        repo.id,
        clean,
        expectedVersion,
      );
      requireWritten(outcome, 'Agent not found');
      return this.attachmentsForAgent(workspaceId, owner.id, repo.id);
    }

    const skill = await this.requireSkill(workspaceId, owner.id);
    const outcome = await this.deps.store.replaceSkillAttachments(
      workspaceId,
      skill.id,
      repo.id,
      clean,
      expectedVersion,
    );
    requireWritten(outcome, 'Skill not found');
    return this.attachmentsForSkill(workspaceId, skill.id, repo.id);
  }

  /**
   * The skill editor's serialisation preview (AC-49): the same documents the run
   * would read, serialised by the same `wrapUntrusted` under the same heading,
   * plus the entries for anything that could not be read.
   */
  async previewForSkill(
    workspaceId: string,
    skillId: string,
    repoId: string,
  ): Promise<ContextPreview> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const owner = await this.requireSkill(workspaceId, skillId);
    const direct = await this.deps.store.attachmentsFor('skill', owner.id, repo.id);
    const ordered = orderAndDedupe(onlyRepo({ direct, skills: [] }, repo.id));

    const resolved = await this.resolveDocuments(ordered, repo.clonePath);
    return { block: serialiseSpecs(resolved.specs), unread: resolved.unreadEntries };
  }

  // ------------------------------------------------------------- the run

  /**
   * Resolve one run's documents (AC-16…AC-30). The security-critical path.
   *
   * **Caller contract.** This method takes no `workspaceId`: `agentId`,
   * `repoId` and `clonePath` must all come from rows the caller already resolved
   * workspace-scoped. `ReviewRunExecutor` satisfies that — the agent and the
   * pull request both come off the run it is executing, and `clonePath` off the
   * pull request's own repository row. Do not call this with an id that arrived
   * in a request.
   *
   * It never reads the agent's `repo_intel` flag, or anything else about the
   * agent: a run with repo intel disabled still injects its documents (AC-21).
   * It throws only if the store throws — the executor wraps the call and
   * degrades to no `## Project context` section (AC-29).
   */
  async resolveForRun(
    agentId: string,
    repoId: string,
    clonePath: string | null,
  ): Promise<RunResolution> {
    const bundle = await this.deps.store.resolveForRun(agentId, repoId);
    // The repository already filters the PR's repository in SQL (AC-19). Doing
    // it again here is belt-and-braces and costs nothing — and it happens
    // *before* the dedupe, so a cross-repo row can never take the
    // first-occurrence slot of a path that is legitimately attached.
    return this.resolveDocuments(orderAndDedupe(onlyRepo(bundle, repoId)), clonePath);
  }

  // ------------------------------------------------------------ internals

  /**
   * One attachment view. `rows` is the effective set for the requested
   * repository, followed by the owner's own attachments for **other**
   * repositories — inert rows the editor renders inactive and labels with the
   * repository they belong to (AC-50). Those rows are outside every count and
   * carry no size or token figure: they are not in this repository's clone and
   * this run would not read them.
   *
   * Inherited cross-repository rows are deliberately not listed: a skill's rows
   * for some third repository are neither read nor detachable from the agent
   * editor, so naming them would cost a query per linked skill for a row the
   * user cannot act on.
   *
   * **`missing` means "the run's read would fail", not "absent from discovery".**
   * Discovery is capped at `MAX_LIST_DOCS` (AC-8), so an attachment sorting past
   * the 500th is simply not in the walk — while `resolveForRun` reads it from
   * the stored rows and injects it on every run. Deciding `missing` off the walk
   * therefore labelled a document that is present, read and billed as missing,
   * free, and un-previewable. So every *attached* path is probed through the
   * same confined reader the run uses — by `stat`, which answers existence
   * exactly as well as a read did — and its answer is the flag: the view and the
   * run cannot disagree, because they ask the same question of the same
   * confinement. The walk is still consulted, for the root segment and for
   * `discovered_count`.
   *
   * **Nothing here reads a document.** The set is the whole effective one, not
   * the capped walk result, so probing it with reads meant every checkbox tick
   * paid a full read plus a synchronous tokenizer pass over every attached
   * document — the same event-loop stall `listDocuments` was fixed to avoid, on
   * a view the PUT returns as well as the GET. The figures are therefore
   * `estimateTokensFromBytes` over the size `stat` reported, the same `≈`
   * estimate the document list shows; the exact tokenizer stays where the number
   * is billed, which is the run and its trace.
   */
  private async attachmentsView(
    workspaceId: string,
    repo: RepoRef,
    ownerKind: OwnerKind,
    ownerId: string,
    bundle: OrderInput,
    version: AttachmentsToken,
  ): Promise<ContextAttachmentsView> {
    const effective = orderAndDedupe(onlyRepo(bundle, repo.id));
    const roots = await this.deps.store.roots(workspaceId);
    const discovered =
      repo.clonePath === null
        ? []
        : (await this.deps.walker.walk(repo.clonePath, roots)).docs;

    const byPath = new Map<string, DiscoveredDoc>(discovered.map((doc) => [doc.path, doc]));
    // Bounded by the ATTACHED set, not by the 500-document cap, and every path
    // stat'ed at most once: the `missing` flag has to match what the run does.
    const onDisk = await this.readStats(
      repo.clonePath,
      effective.map((row) => row.path),
    );
    // The run reads the first `MAX_DOCS_PER_RUN` of this same ordered set and
    // names the rest unread with the `read_cap` reason (AC-25) — decided here by
    // that same helper, so the two cannot disagree about where the line falls.
    // Rows past it are stored, listed and removable, but inert: the footer must
    // not bill them, and the editor needs to be able to say so.
    const beyondCap = new Set(
      applyReadCap(effective, MAX_DOCS_PER_RUN).dropped.map((doc) => doc.path),
    );

    const rows: ContextAttachmentRow[] = effective.map((row) => {
      const found = byPath.get(row.path);
      const stats = onDisk.get(row.path);
      return {
        path: row.path,
        root: found?.root ?? rootLabel(row.path, roots),
        // The stat's own byte count is authoritative — the walk may not carry
        // this document at all, and when it does the two agree.
        size_bytes: stats?.bytes ?? found?.sizeBytes ?? 0,
        token_estimate: stats?.tokens ?? 0,
        repo_id: repo.id,
        source: row.source,
        skill_id: row.skillId,
        skill_name: row.skillName,
        // Attached but not readable from the clone: the row stays and stays
        // removable (AC-51).
        missing: stats === undefined,
        beyond_read_cap: beyondCap.has(row.path),
      };
    });

    // Keyed by repository AND path. `attachmentsFor(kind, id, null)` orders by
    // `order` then `path`, not by repo, so a path attached in two repositories
    // deduped on the path alone dropped whichever row happened to come second —
    // making it invisible in every editor view while it was still injected on
    // its own repository's runs.
    const seen = new Set(rows.map((row) => elsewhereKey(repo.id, row.path)));
    const elsewhere: ContextAttachmentRow[] = [];
    for (const record of await this.deps.store.attachmentsFor(ownerKind, ownerId, null)) {
      const path = toPosix(record.path);
      if (record.repoId === repo.id || seen.has(elsewhereKey(record.repoId, path))) continue;
      seen.add(elsewhereKey(record.repoId, path));
      elsewhere.push({
        path,
        root: rootLabel(path, roots),
        size_bytes: 0,
        token_estimate: 0,
        repo_id: record.repoId,
        source: 'direct',
        skill_id: null,
        skill_name: null,
        missing: false,
        // Not this repository's run at all, so the per-run cap does not describe
        // them; they are already outside every count.
        beyond_read_cap: false,
      });
    }

    return {
      direct_count: effective.filter((row) => row.source === 'direct').length,
      effective_count: effective.length,
      discovered_count: discovered.length,
      // Only the rows the run will actually read. Through the shared dedupe, so
      // the footer cannot disagree with the badge or with `specs_read` (AC-18,
      // AC-64, AC-66, AC-67) — and past the per-run cap it must not: the run
      // drops those documents with the `read_cap` reason and is never billed for
      // them, so a footer that added them up stated tokens nothing spends.
      token_estimate: sumTokens(rows.filter((row) => row.beyond_read_cap !== true)),
      version,
      rows: [...rows, ...elsewhere],
    };
  }

  /**
   * Read an ordered document set into the `specs` array plus the trace entries.
   * Shared by the run path and the skill preview so the preview cannot show
   * something the run would not inject.
   *
   * Both caps bind here, at read time: `MAX_DOCS_PER_RUN` before the reader is
   * even opened (so the 21st document is never touched), and `MAX_DOC_BYTES`
   * inside each read.
   */
  private async resolveDocuments(
    ordered: OrderedDoc[],
    clonePath: string | null,
  ): Promise<RunResolution> {
    const attached = ordered.length;

    // No clone: nothing is read, every attachment is named, `specs` is empty so
    // the section is omitted entirely (AC-30).
    if (clonePath === null) {
      return {
        specs: [],
        readEntries: [],
        unreadEntries: ordered.map((doc) =>
          formatSpecUnread(doc.path, UNREAD_REASON.no_clone),
        ),
        attached,
        notes: ordered.map(
          (doc): RunNote => ({ kind: 'unread', path: doc.path, reason: UNREAD_REASON.no_clone }),
        ),
      };
    }
    // Nothing attached: no reader, no entries, and an empty `specs` the executor
    // omits — which is what keeps the assembled prompt byte-identical to a
    // pre-feature one (AC-22).
    if (attached === 0) {
      return { specs: [], readEntries: [], unreadEntries: [], attached: 0, notes: [] };
    }

    const { read, dropped } = applyReadCap(ordered, MAX_DOCS_PER_RUN);
    const reader = await this.deps.reader.open(clonePath);

    const specs: string[] = [];
    const readEntries: string[] = [];
    const unreadEntries: string[] = [];
    const notes: RunNote[] = [];

    for (const doc of read) {
      const result = await this.readForPrompt(reader, doc.path);
      if (result.ok) {
        specs.push(result.text);
        readEntries.push(formatSpecRead(doc.path, result.tokens));
        if (result.truncated) notes.push({ kind: 'truncated', path: doc.path });
        continue;
      }
      unreadEntries.push(formatSpecUnread(doc.path, result.reason));
      notes.push({ kind: 'unread', path: doc.path, reason: result.reason });
    }
    for (const doc of dropped) {
      unreadEntries.push(formatSpecUnread(doc.path, UNREAD_REASON.read_cap));
      notes.push({ kind: 'unread', path: doc.path, reason: UNREAD_REASON.read_cap });
    }

    return { specs, readEntries, unreadEntries, attached, notes };
  }

  /**
   * One document, prompt-ready. The truncation marker is appended here — the
   * reader reports `truncated` and leaves the wording to whoever renders it —
   * and the token count is taken over the text that is actually injected,
   * marker included, so the trace entry and the editor's footer describe the
   * same string.
   */
  private async readForPrompt(
    reader: ContextFileReader,
    path: string,
  ): Promise<
    | { ok: true; text: string; tokens: number; bytes: number; truncated: boolean }
    | { ok: false; reason: UnreadReason }
  > {
    const result = await reader.read(path, MAX_DOC_BYTES);
    if (!result.ok) return { ok: false, reason: unreadReasonFor(result.reason) };
    const text = truncateForPrompt(result.text, result.bytes, MAX_DOC_BYTES);
    return {
      ok: true,
      text,
      tokens: this.deps.tokenCount(text),
      bytes: result.bytes,
      truncated: result.truncated,
    };
  }

  /**
   * Byte size and estimated tokens per **existing** path, through the same
   * confined reader the run uses — by `stat`, so **no document is read**.
   *
   * A path absent from the returned map is a path the run's read would fail on
   * too, because `stat` and `read` pass the same confinement in the same order;
   * that is what the attachment view's `missing` flag reports, and it is derived
   * per attached path rather than from the capped walk result (C1). One reader
   * for the whole set, one `stat` per path, sequentially: no unbounded fan-out of
   * file descriptors, and nothing quadratic.
   *
   * The token figure is `ceil(bytes / 4)` — the same estimate `listDocuments`
   * shows, labelled `≈` in both places. It is deliberately *not* the tokenizer:
   * the effective set has no 500-document cap on it, this map is rebuilt on every
   * checkbox tick (the PUT returns this view), and `js-tiktoken`'s BPE is
   * quadratic in one unbroken letter run and synchronous. The exact count still
   * runs where the tokens are actually spent — `readForPrompt`, for the run and
   * its trace.
   */
  private async readStats(
    clonePath: string | null,
    paths: string[],
  ): Promise<Map<string, { tokens: number; bytes: number }>> {
    const out = new Map<string, { tokens: number; bytes: number }>();
    if (clonePath === null || paths.length === 0) return out;
    const reader = await this.deps.reader.open(clonePath);
    for (const path of paths) {
      const result = await reader.stat(path);
      if (result.ok) {
        out.set(path, { tokens: estimateTokensFromBytes(result.bytes), bytes: result.bytes });
      }
    }
    return out;
  }

  /** Workspace-scoped, so a foreign repository is a 404 before anything else runs. */
  private async requireRepo(workspaceId: string, repoId: string): Promise<RepoRef> {
    const repo = await this.deps.store.getRepo(workspaceId, repoId);
    if (repo === undefined) throw new NotFoundError('Repository not found');
    return repo;
  }

  /** Workspace-scoped, and the only way an owner-scoped skill id is obtained. */
  private async requireSkill(
    workspaceId: string,
    skillId: string,
  ): Promise<{ id: string; name: string }> {
    const skill = await this.deps.store.skillOwner(workspaceId, skillId);
    if (skill === undefined) throw new NotFoundError('Skill not found');
    return skill;
  }
}

// ------------------------------------------------------------ module-local

/**
 * Turn a locked replace's outcome into the one HTTP answer it deserves, or fall
 * through when the body was applied.
 *
 * The `stale` arm is a **409, not a 404 and not a 422**: the request was well
 * formed and the owner exists — the state it described has moved, which is the
 * definition of a conflict and exactly what `ConflictError` carries (`app.ts`
 * sends an `AppError`'s own `statusCode`). The message names no path and no
 * token: the client already holds the fresh view one refetch away, and an error
 * body is not a place to reflect input.
 */
function requireWritten(outcome: ReplaceOutcome, notFoundMessage: string): void {
  if (outcome.status === 'not_found') throw new NotFoundError(notFoundMessage);
  if (outcome.status === 'stale') {
    throw new ConflictError(
      'This context set changed since it was loaded. Reload it and apply the change again.',
    );
  }
}

/**
 * The `specs` slot exactly as `assemblePrompt` emits it
 * (`reviewer-core/src/prompt.ts:101-103,121`): the heading, then each document
 * wrapped by the **same** `wrapUntrusted` with a zero-based label, joined by a
 * blank line. Empty in, empty out — an empty slot renders no section, which is
 * the contract that keeps a run with nothing attached byte-identical to a
 * pre-feature one (AC-22).
 *
 * `test/project-context-service.test.ts` asserts this against the real
 * `assemblePrompt`'s own output, so the two cannot drift.
 */
function serialiseSpecs(specs: string[]): string {
  if (specs.length === 0) return '';
  return `## Project context\n${specs
    .map((spec, index) => wrapUntrusted(`spec-${index}`, spec))
    .join('\n\n')}`;
}

/**
 * Keep only the attachments made against this repository (AC-19). Applied
 * before the dedupe, never after: a cross-repository row filtered *after*
 * `orderAndDedupe` could already have taken the first-occurrence slot of a path
 * that is legitimately attached for this repository, silently dropping it.
 */
function onlyRepo(bundle: OrderInput, repoId: string): OrderInput {
  return {
    direct: bundle.direct.filter((record) => record.repoId === repoId),
    skills: bundle.skills.map((skill) => ({
      ...skill,
      attachments: skill.attachments.filter((record) => record.repoId === repoId),
    })),
  };
}

/**
 * Map a reader failure onto one of the four fixed reasons. `UnreadReason` is a
 * closed union and stays that way — the `never` arm makes a new reader failure a
 * compile error here rather than a silent fall-through.
 *
 * **`not_markdown` maps to "not found in the repository clone".** `CloneReader`
 * confines the path lexically *before* it looks at the extension, so anything
 * that reaches `not_markdown` is provably **inside** the clone; reporting it as
 * `path resolves outside the repository` would put a false containment breach in
 * a trace an operator reads, and devalue the entries that describe a real one.
 * What actually happened is that the caller named something that is not one of
 * this feature's documents — discovery only ever offers `.md` files — which is
 * indistinguishable, to the user, from naming a document that is not there.
 */
function unreadReasonFor(reason: 'outside' | 'not_markdown' | 'not_found'): UnreadReason {
  switch (reason) {
    case 'outside':
      return UNREAD_REASON.outside;
    case 'not_found':
    case 'not_markdown':
      return UNREAD_REASON.not_found;
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

/**
 * The dedupe key for the "attached elsewhere" rows: a repository id and a path,
 * never a path alone. The two are joined by NUL, which `requireRelativePath`
 * refuses in a stored path, so no pair of distinct inputs can collide on it.
 */
function elsewhereKey(repoId: string, path: string): string {
  return `${repoId}\0${path}`;
}

/**
 * The root segment shown for a path that discovery did not return — a missing
 * document (AC-51) or a cross-repository one (AC-50), neither of which has a
 * walked `root` to copy. The configured roots decide it where they can; a path
 * under none of them falls back to its own first segment.
 */
function rootLabel(path: string, roots: string[]): string {
  const matched = isUnderRoots(path, roots);
  if (matched !== null) return matched;
  const first = path.split('/')[0];
  return first !== undefined && first.length > 0 ? first : path;
}

/**
 * A path is only ever *read* through the confined reader, so this is not the
 * containment check — it is a refusal to persist a path that could not name a
 * document inside the clone under any interpretation. `..`, `.`, an empty
 * segment, an absolute path, a drive-qualified path and any control character
 * all fail here rather than becoming a stored row that every future read has to
 * reject.
 *
 * The control-character arm is **hygiene, not a containment control**: a stored
 * path is echoed into the Live Log, the `specs_read` trace entries and this
 * module's own log lines, and every one of those sinks is structurally escaped
 * (SSE frames are `JSON.stringify`d, the persisted log is an array of objects,
 * and the path never reaches the prompt), so a `\n` or a `\r` forges nothing.
 * What it does do is distort a copied log. A path containing one cannot name a
 * document anyone committed on purpose, so there is nothing to lose by refusing
 * it at the write boundary. NUL is in the same class and is additionally the
 * separator `elsewhereKey` relies on.
 *
 * The message names no path: the input is client-supplied, and an error body is
 * not a place to reflect it.
 */
// The Unicode control category: C0 (NUL…US), DEL and C1. Written as a
// property escape so no literal control character ever sits in this source.
const CONTROL_CHARS = /\p{Cc}/u;

function requireRelativePath(path: string): string {
  const posix = toPosix(path);
  const invalid =
    posix.length === 0 ||
    posix.length > MAX_PATH_CHARS ||
    posix.startsWith('/') ||
    /^[a-zA-Z]:/.test(posix) ||
    CONTROL_CHARS.test(posix) ||
    posix.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..');
  if (invalid) throw new ValidationError('attachment path must be a repo-relative path');
  return posix;
}
