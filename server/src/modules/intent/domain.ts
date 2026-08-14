import type { Intent, IntentConfidence } from '@devdigest/shared';

/** The PR fields the intent derivation needs — no Drizzle row escapes the repository. */
export interface IntentPullRef {
  id: string;
  number: number;
  title: string;
  body: string | null;
  headSha: string;
  repoId: string;
}

export interface IntentRepoRef {
  id: string;
  owner: string;
  name: string;
  clonePath: string | null;
}

/** One resolved piece of evidence, ready to be delimiter-wrapped. */
export interface IntentDoc {
  label: string;
  content: string;
}

/**
 * A linked issue's metadata, as persisted on `pr_intent.linked_issue`.
 *
 * A structural mirror of `@devdigest/shared`'s `IssueMeta`, declared here for
 * the same reason `IntentStoreUpsert` below is: the reviews aggregate owns the
 * column, and importing its repository would be a `no-cross-module-internals`
 * violation. `IssueMeta` satisfies this interface, so the adapter assigns with
 * no cast.
 *
 * `body` is the RAW issue body, not the `title\n\nbody` fusion `IntentDoc`
 * carries: the brief renders title and body separately (L05).
 */
export interface IssueMetaShape {
  number: number;
  title: string;
  body?: string | null;
  state: string;
}

/** What the service produces before it becomes a `PrIntentRecord`. */
export interface DerivedIntent {
  intent: Intent;
  confidence: IntentConfidence;
  sources: string[];
  missingContext: string[];
  provider: string;
  model: string;
  headSha: string;
}

/**
 * The `pr_intent` row shapes, declared STRUCTURALLY rather than imported from
 * `modules/reviews/repository.ts` — importing another module's repository is a
 * `no-cross-module-internals` violation, and `db/rows.ts` is closed to the core
 * ring too. `ReviewRepository`'s `IntentUpsert`/`StoredIntent` satisfy these
 * interfaces, so the container wires them with no cast.
 */
export interface IntentStoreUpsert {
  intent: Intent;
  headSha: string;
  confidence: IntentConfidence;
  sources: string[];
  missingContext: string[];
  /** The first linked issue, or null. Replaced wholesale on re-derivation. */
  linkedIssue: IssueMetaShape | null;
  provider: string;
  model: string;
}

export interface IntentStoreRecord extends Intent {
  headSha: string;
  confidence: IntentConfidence;
  sources: string[];
  missingContext: string[];
  linkedIssue: IssueMetaShape | null;
  provider: string;
  model: string;
  createdAt: Date;
}
