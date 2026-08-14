/**
 * Project-context domain types. Imports nothing — `constants.ts`, `helpers.ts`,
 * `repository.ts` and `service.ts` all import downward from here, which is what
 * keeps `no-circular` quiet on a brand-new module (`tsPreCompilationDeps: true`
 * makes a type-only edge a real edge; see the onion-architecture skill).
 *
 * Everything here is camelCase. The snake_case wire shapes (`ContextDoc`,
 * `ContextAttachmentRow`, …) live in `@devdigest/shared` and are produced at the
 * boundary, so a Drizzle row type never reaches a service signature.
 */

/** Which side of the agent/skill split owns an attachment. */
export type OwnerKind = 'agent' | 'skill';

/** How a document reached an agent: attached to it, or to one of its skills. */
export type AttachmentSource = 'direct' | 'inherited';

/** `no_clone` — the repo row has no `clone_path`, or the directory is gone. */
export type DiscoveryStatus = 'ok' | 'no_clone';

/**
 * Why an attached document was not read on a run. The four strings are fixed by
 * the spec and asserted byte for byte; the values live in `constants.ts` as
 * `UNREAD_REASON`, and only `helpers.formatSpecUnread` renders them into a trace
 * entry. Declaring the union here (rather than deriving it from the constant)
 * is what lets `domain.ts` keep its zero imports.
 */
export type UnreadReason =
  | 'path resolves outside the repository'
  | 'not found in the repository clone'
  | 'no repository clone on disk'
  | 'only 20 documents are read per run';

/** The repository fields this module needs. `clonePath` is nullable on purpose. */
export interface RepoRef {
  id: string;
  fullName: string;
  clonePath: string | null;
}

/** One discovered document, before it is mapped onto the `ContextDoc` wire shape. */
export interface ContextDocRecord {
  /** Repo-relative POSIX path. */
  path: string;
  /** The configured root segment that matched, exactly as configured. */
  root: string;
  sizeBytes: number;
  tokenEstimate: number;
  /** How many agents read this document today — direct plus inherited. */
  usedByAgents: number;
}

/**
 * One stored `context_attachments` row, mapped off Drizzle by `repository.ts`.
 * `order` is the stored position; the *array* order is what the helpers honour,
 * because the repository does the `ORDER BY`.
 */
export interface AttachmentRecord {
  /** Repo-relative POSIX path. */
  path: string;
  repoId: string;
  order: number;
}

/** One linked skill and the documents it carries, in the skill's stored order. */
export interface OrderInputSkill {
  id: string;
  name: string;
  /** A disabled skill contributes nothing to any agent's prompt (AC-20). */
  enabled: boolean;
  attachments: AttachmentRecord[];
}

/**
 * Everything one agent's resolution starts from: its own attachments, then its
 * linked skills in link order. Produced by `repository.resolveForRun`.
 */
export interface OrderInput {
  direct: AttachmentRecord[];
  skills: OrderInputSkill[];
}

/**
 * The **concurrency token** for one owner's attachment set in one repository:
 * opaque, compared for equality and nothing else, and surfaced on the wire as
 * `ContextAttachmentsView.version`.
 *
 * It is a string rather than a number because the two owner kinds derive it from
 * different things and neither ordering nor arithmetic over it means anything.
 * An agent's is `agents.version`, which the replace already bumps inside its own
 * transaction; a skill has no such counter — `skills.version` tracks the skill's
 * *body*, and an attachment replace deliberately does not bump it, so it cannot
 * detect a concurrent attachment replace at all — and its token is therefore a
 * fingerprint of the stored set itself (`helpers.fingerprintAttachments`).
 */
export type AttachmentsToken = string;

/**
 * What a locked replace did. Three outcomes, because the route owes three
 * different answers and `undefined` can only carry one of them:
 *
 *  - `written` — the body was applied; `token` is the set's **new** token.
 *  - `not_found` — the owner is not this workspace's; nothing was written (404).
 *  - `stale` — the caller's `expectedVersion` no longer describes the stored
 *    state, so the body was **not** applied (409). `token` is what the state
 *    actually is now, so the caller could refetch or retry against it.
 *
 * Returned rather than thrown: nothing in `repository.ts` throws a domain error,
 * and mapping an outcome onto an HTTP status is the service's job.
 */
export type ReplaceOutcome =
  | { status: 'written'; token: AttachmentsToken }
  | { status: 'not_found' }
  | { status: 'stale'; token: AttachmentsToken };

/**
 * One document in the AC-17 order, after the AC-18 dedupe. The array position
 * *is* the order — there is no `order` field to disagree with it.
 */
export interface OrderedDoc {
  /** Normalised repo-relative POSIX path. */
  path: string;
  repoId: string;
  source: AttachmentSource;
  /** Both null for a `direct` row; both set for an `inherited` one. */
  skillId: string | null;
  skillName: string | null;
}

/** One row of an agent's effective attachment set, before token figures are added. */
export interface EffectiveRow {
  path: string;
  source: AttachmentSource;
  skillId: string | null;
  skillName: string | null;
}

/** A document that was read for a run. `text` is untrusted, author-controlled content. */
export interface ResolvedDoc {
  path: string;
  text: string;
  tokens: number;
  /** True ⇒ `text` already carries the truncation marker. */
  truncated: boolean;
}

/** A document that was attached but not read, with the reason for the trace. */
export interface UnreadDoc {
  path: string;
  reason: UnreadReason;
}
