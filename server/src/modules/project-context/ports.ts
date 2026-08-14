import type {
  AttachmentRecord,
  AttachmentsToken,
  OrderInput,
  OwnerKind,
  RepoRef,
  ReplaceOutcome,
  UnreadReason,
} from './domain.js';

/**
 * The service's whole view of the outside world. It takes this bundle, never
 * `Container`: the composition root imports every adapter, so taking it drags
 * Drizzle, Octokit and every LLM SDK into the type graph of a supposedly pure
 * use-case layer (`onion-architecture`, law 2).
 *
 * Every port here is declared **structurally** rather than by importing the
 * implementation's own types. That is deliberate: `walk.ts` and
 * `adapters/clone-reader/` both `import 'node:fs/promises'`, and a core file
 * that type-imports them puts the filesystem in this module's core dependency
 * graph — `tsPreCompilationDeps: true` makes a type-only edge a real edge. The
 * shapes are identical, so `new CloneWalker()` and `CloneReader.open` satisfy
 * these ports with no adapter and no cast; `test/project-context-service.test.ts`
 * asserts that conformance at the type level, and `platform/container.ts`
 * proves it again at the assignment site.
 */
export interface ProjectContextDeps {
  store: ProjectContextStore;
  walker: ContextWalkerPort;
  reader: ContextReaderPort;
  /** The shared `Tokenizer` port, narrowed to the one call this module makes. */
  tokenCount: (text: string) => number;
  logger?: Logger;
}

/**
 * Everything this module persists or reads from the database, implemented by
 * `repository.ts`. Declared here, in the core, and implemented outward — which
 * is the whole of the dependency rule.
 *
 * **Two of these methods are owner-scoped, not workspace-scoped.**
 * `attachmentsFor` and `resolveForRun` take no `workspaceId` and filter none:
 * they trust the ids they are handed. Containing that is the *service's* job —
 * see `service.ts`, which resolves every owner through `getRepo`, `agentBundle`
 * or `skillOwner` (all of which do filter `workspaceId`) before either method
 * sees an id. A caller that forwards a client-supplied id straight into
 * `attachmentsFor` has written an IDOR.
 */
export interface ProjectContextStore {
  /** Workspace-scoped. `undefined` ⇒ not this workspace's repository ⇒ 404. */
  getRepo(workspaceId: string, repoId: string): Promise<RepoRef | undefined>;
  /** The configured `context_roots`, already defaulted — never throws. */
  roots(workspaceId: string): Promise<string[]>;
  /** Usage count per attached path for one repository, in one round trip (AC-57). */
  usageCounts(workspaceId: string, repoId: string): Promise<Map<string, number>>;
  /** Owner-scoped. `repoId: null` ⇒ every repository (the "attached elsewhere" view). */
  attachmentsFor(
    ownerKind: OwnerKind,
    ownerId: string,
    repoId: string | null,
  ): Promise<AttachmentRecord[]>;
  /**
   * Workspace-scoped. `undefined` ⇒ not this workspace's agent ⇒ 404 (AC-14).
   *
   * Carries the agent's `version` because that **is** the agent view's
   * concurrency token: the view has to hand the client the token its next
   * replace must echo, and re-reading the agent row a second time to get it
   * would be a second chance to read a different number.
   */
  agentBundle(
    workspaceId: string,
    agentId: string,
    repoId: string,
  ): Promise<(OrderInput & { version: number }) | undefined>;
  /** Workspace-scoped. `undefined` ⇒ not this workspace's skill ⇒ 404 (AC-14). */
  skillOwner(
    workspaceId: string,
    skillId: string,
  ): Promise<{ id: string; name: string } | undefined>;
  /**
   * Replace an agent's set. `expectedVersion`, when given, is compared with the
   * agent's token **under the same `FOR UPDATE` lock the write already takes**;
   * a mismatch writes nothing and answers `stale`, which the service turns into
   * a 409. Omitting it keeps the previous last-writer-wins behaviour.
   */
  replaceAgentAttachments(
    workspaceId: string,
    agentId: string,
    repoId: string,
    paths: string[],
    expectedVersion?: AttachmentsToken,
  ): Promise<ReplaceOutcome>;
  /**
   * Replace a skill's set, under the same compare-and-set rule. A skill that is
   * not this workspace's yields `not_found` having written nothing — but the
   * caller must still resolve it through `skillOwner` first, because that is
   * where the 404 message comes from.
   */
  replaceSkillAttachments(
    workspaceId: string,
    skillId: string,
    repoId: string,
    paths: string[],
    expectedVersion?: AttachmentsToken,
  ): Promise<ReplaceOutcome>;
  /**
   * The run path's input: the agent's own rows plus its linked skills' rows for
   * this repository only. Cross-repository attachments are excluded in SQL
   * (AC-19), so the service never sees them.
   */
  resolveForRun(agentId: string, repoId: string): Promise<OrderInput>;
}

/** One `.md` file discovery found under a configured root. `sizeBytes` is bytes (AC-6). */
export interface DiscoveredDoc {
  /** Repo-relative POSIX path. */
  path: string;
  /** The configured root segment that matched, exactly as configured. */
  root: string;
  sizeBytes: number;
}

/**
 * Discovery over a clone. Never throws: an absent clone yields an empty list
 * **and** `cloneMissing: true`.
 *
 * That flag is not decoration. `docs: []` alone is ambiguous — a clone with no
 * documents under the roots produces exactly the same value as a clone
 * directory that is not on disk — and only the walker can tell the two apart,
 * so AC-7's "or the directory is absent" arm is answerable here and nowhere
 * else in this module.
 */
export interface ContextWalkerPort {
  walk(
    clonePath: string,
    roots: string[],
  ): Promise<{ docs: DiscoveredDoc[]; omitted: number; cloneMissing: boolean }>;
}

/**
 * What one confined read returns. `bytes` is the file's **real** byte length,
 * not the length of `text`, so a caller that reports truncation knows the size
 * it truncated *from*; the marker text is the caller's to add.
 *
 * A failure carries a reason code and nothing else — no message, no absolute
 * path, no content. `not_markdown` exists because the reader confines the path
 * *before* it inspects the extension: reaching it means the path is provably
 * inside the clone but is not a document this feature reads.
 */
export type ContextReadResult =
  | { ok: true; text: string; bytes: number; truncated: boolean }
  | { ok: false; reason: 'outside' | 'not_markdown' | 'not_found' };

/**
 * What one confined `stat` returns: existence and size, through the *same*
 * confinement a read passes and with the same reason codes, so a caller may
 * treat "would this read succeed?" and "does this stat succeed?" as one
 * question. No bytes are transferred.
 */
export type ContextStatResult =
  | { ok: true; bytes: number }
  | { ok: false; reason: 'outside' | 'not_markdown' | 'not_found' };

/** One open reader, confined to a single clone root. */
export interface ContextFileReader {
  read(relPath: string, maxBytes: number): Promise<ContextReadResult>;
  /**
   * Existence and size without a read. The attachment view needs only those two
   * facts per attached path, and answering them with a read is what put a full
   * tokenizer pass over the whole attached set on every checkbox tick.
   */
  stat(relPath: string): Promise<ContextStatResult>;
}

/** Opens one confined reader per operation, not per document. */
export interface ContextReaderPort {
  open(clonePath: string): Promise<ContextFileReader>;
}

/** The narrow half of the platform logger — never the platform object itself. */
export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

/**
 * One thing worth saying in the run's Live Log about one document. The executor
 * turns these into log lines, so the service never touches the run bus and
 * nothing here decides an event kind.
 */
export interface RunNote {
  kind: 'truncated' | 'unread';
  /** Repo-relative POSIX path — never an absolute path, never content. */
  path: string;
  /** Set for `unread`, absent for `truncated`. */
  reason?: UnreadReason;
}

/**
 * What one run's document resolution yields. `specs` goes to `reviewPullRequest`
 * (omitted entirely when empty, AC-22); `readEntries` then `unreadEntries` is
 * the `specs_read` trace order; `attached` is the pre-cap effective count the
 * Live Log summary states.
 */
export interface RunResolution {
  specs: string[];
  readEntries: string[];
  unreadEntries: string[];
  attached: number;
  notes: RunNote[];
}
