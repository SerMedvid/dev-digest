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
  provider: string;
  model: string;
}

export interface IntentStoreRecord extends Intent {
  headSha: string;
  confidence: IntentConfidence;
  sources: string[];
  missingContext: string[];
  provider: string;
  model: string;
  createdAt: Date;
}
