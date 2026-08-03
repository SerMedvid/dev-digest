# Conventions Extractor — Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One repo-scoped screen that runs a conventions scan, shows every candidate with its evidence, lets the user accept / reject / edit each one, and merges the accepted ones into a skill that can be linked to an agent on the spot.

**Architecture:** A client-side SPA route `/repos/:repoId/conventions`. Data flows component → hook in `src/lib/hooks/conventions.ts` → `api` from `src/lib/api.ts`, never `fetch` from a component. The screen polls `GET /repos/:id/conventions` every 2.5 s while the scan is in flight and not at all otherwise. Components are folders with their Tailwind strings in `styles.ts`.

**Tech Stack:** Next.js 15 App Router (client components only), React 19, TanStack Query 5.62, `next-intl`, the vendored `@devdigest/ui` design system, vitest + jsdom with `fetch` stubbed.

**Spec:** [`docs/superpowers/specs/2026-08-03-conventions-extractor-design.md`](../specs/2026-08-03-conventions-extractor-design.md) — §6 is this plan's scope.
**Depends on:** [`2026-08-03-conventions-extractor-server.md`](2026-08-03-conventions-extractor-server.md). Task 1 of that plan (the shared contracts) must be merged first — it edits the client's copy of `@devdigest/shared`, which every task here imports. The endpoints must exist before the screen can be exercised for real, though the tests here stub `fetch` and need no API.

## Global Constraints

- **Package manager is `pnpm`** in `client/`.
- **Never call `fetch` from a component.** One path only: component → hook in `src/lib/hooks/` → `api`. New endpoint → new hook file next to its siblings, with a `queryKey` matching the existing shape and explicit `invalidateQueries` on mutation.
- **Every component is a folder**: `Name/Name.tsx`, `Name.test.tsx`, `constants.ts`, `helpers.ts`, `styles.ts`, `index.ts`, `_components/`. Tailwind/inline style objects live in `styles.ts` as named consts, not inline in JSX.
- **Route files stay thin** — they compose, they hold no logic.
- **All user-facing strings go through `next-intl`**, in `client/messages/en/conventions.json`. The file already exists; extend it, never add a second catalogue.
- **Treat `src/vendor/ui` as third-party**: compose it, do not refactor it, do not fork a primitive into a feature folder. Adding a record to `src/vendor/ui/nav.ts` is allowed (it is a data registry); restructuring that file is not.
- **There is no `@testing-library/user-event` here.** Drive interactions with `fireEvent` from `@testing-library/react`.
- **A test asserting a *query* error state must build its QueryClient with `defaultOptions: { queries: { retry: false } }`** — the default 3 retries with backoff outlast `waitFor`'s 1 s window and the test reads as a broken error branch. Mutation errors need no such change.
- **Stub a failing response as** `{ ok: false, status, statusText, json: async () => ({ error: { message } }) }` — `apiFetch` reads `body.error.message`.
- **A `Textarea` inside a `FormField` has no accessible name** (the vendored `Textarea` forwards no props and `FormField` renders a bare `<label>`). Query it with `container.querySelector("textarea")` or by placeholder — do not add a second label or fork the primitive.
- **The vendored `Modal` gives its body zero padding** and `Tabs` defaults to `pad="0 28px"`. Inside a Modal, wrap the body in `<div style={{ padding: 24 }}>` and pass `pad="0 24px"` to any Tabs.
- **Poll interval: 2.5 s**, and only while `scan.status` is `queued` or `running`.
- **Gates before "done":** `cd client && pnpm typecheck` and `cd client && pnpm test`.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `client/src/lib/hooks/conventions.ts` | The five hooks + `isScanInFlight`. |
| `client/src/app/repos/[repoId]/conventions/page.tsx` | Thin route: crumbs + `ConventionsView`. |
| `client/src/app/repos/[repoId]/conventions/_components/ConventionsView/` | The screen: state machine over the six states. |
| `…/ConventionsView/_components/ScanHeader/` | Sample count, last-scan time, Re-scan with confirmation. |
| `…/ConventionsView/_components/SelectionBar/` | Accepted count, Deselect all, Create skill. |
| `…/ConventionsView/_components/ConventionCard/` | One candidate: rule, evidence, confidence, accept/reject, inline edit. |
| `…/ConventionsView/_components/CreateConventionSkillModal/` | Draft prefill, metadata, agent picker, create. |
| `client/specs/conventions.md` | The screen spec: journey, states, data sources, acceptance. |

**Modified**

| File | Change |
|---|---|
| `client/messages/en/conventions.json` | Extend the existing catalogue. |
| `client/src/vendor/ui/nav.ts` | One `NAV` entry + one `SHORTCUTS` row. |
| `client/src/lib/hooks/index.ts` | Re-export `./conventions`. |
| `client/README.md` | The route map. |

---

## Task 1: Hooks, the poll predicate, and the copy catalogue

**Files:**
- Create: `client/src/lib/hooks/conventions.ts`
- Modify: `client/src/lib/hooks/index.ts`
- Modify: `client/messages/en/conventions.json`
- Test: `client/src/lib/hooks/conventions.test.ts`

**Interfaces:**
- Consumes: `ConventionsView`, `ConventionCandidate`, `ConventionScan`, `ConventionSkillDraft`, `Skill`, `SkillType` from `@devdigest/shared` (server plan Task 1).
- Produces:
  - `isScanInFlight(scan: ConventionScan | null | undefined): boolean`
  - `useConventions(repoId: string | null | undefined)` — polls at 2.5 s while in flight
  - `useExtractConventions()` — `mutate(repoId)`
  - `usePatchConvention()` — `mutate({ repoId, id, patch })`
  - `useConventionSkillDraft(repoId, enabled)` 
  - `useCreateConventionSkill()` — `mutate({ repoId, input })` → `Skill`

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/hooks/conventions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ConventionScan } from "@devdigest/shared";
import { isScanInFlight, CONVENTIONS_POLL_MS } from "./conventions";

function scan(status: ConventionScan["status"]): ConventionScan {
  return {
    status,
    pool_count: 0,
    sample_count: 0,
    candidate_count: 0,
    dropped: {},
    provider: null,
    model: null,
    error: null,
    started_at: null,
    finished_at: null,
  };
}

describe("isScanInFlight", () => {
  it("is true while queued or running", () => {
    expect(isScanInFlight(scan("queued"))).toBe(true);
    expect(isScanInFlight(scan("running"))).toBe(true);
  });

  it("is false once the scan settled, so the screen stops polling", () => {
    expect(isScanInFlight(scan("done"))).toBe(false);
    expect(isScanInFlight(scan("failed"))).toBe(false);
  });

  it("is false for a repo that was never scanned", () => {
    expect(isScanInFlight(null)).toBe(false);
    expect(isScanInFlight(undefined)).toBe(false);
  });
});

describe("CONVENTIONS_POLL_MS", () => {
  it("polls at 2.5s", () => {
    expect(CONVENTIONS_POLL_MS).toBe(2500);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && pnpm exec vitest run src/lib/hooks/conventions.test.ts`
Expected: FAIL — cannot resolve `./conventions`.

- [ ] **Step 3: Write the hooks**

Create `client/src/lib/hooks/conventions.ts`:

```ts
/* hooks/conventions.ts — React Query hooks for the Conventions screen.
   The scan is asynchronous server-side, so the view query polls while it is in
   flight and stops the moment it settles. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionScan,
  ConventionSkillDraft,
  ConventionsView,
  Skill,
  SkillType,
} from "@devdigest/shared";

export const CONVENTIONS_POLL_MS = 2500;

/** Whether the server is still working on this repo's scan. */
export function isScanInFlight(scan: ConventionScan | null | undefined): boolean {
  return scan?.status === "queued" || scan?.status === "running";
}

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionsView>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
    // A settled scan never changes on its own — polling it forever would be
    // pure noise, so the interval is conditional on the data we already have.
    refetchInterval: (query) =>
      isScanInFlight(query.state.data?.scan) ? CONVENTIONS_POLL_MS : false,
  });
}

export function useExtractConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<{ status: string; jobId: string }>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (_data, repoId) => {
      // Refetch immediately so the queued status (and the poll it starts) lands
      // without waiting for the next interval.
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export interface ConventionPatch {
  status?: ConventionCandidate["status"];
  rule?: string;
  evidence_path?: string;
  evidence_line?: number;
  evidence_snippet?: string;
}

export function usePatchConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { repoId: string; id: string; patch: ConventionPatch }) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: (_data, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
      qc.invalidateQueries({ queryKey: ["convention-skill-draft", repoId] });
    },
  });
}

/** The merged body for the modal. 409s until something is accepted, so it is
    only fetched when the modal is open. */
export function useConventionSkillDraft(repoId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["convention-skill-draft", repoId],
    queryFn: () => api.get<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill-draft`),
    enabled: !!repoId && enabled,
    staleTime: 0,
  });
}

export interface CreateConventionSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
  agent_id?: string;
}

export function useCreateConventionSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, input }: { repoId: string; input: CreateConventionSkillInput }) =>
      api.post<Skill>(`/repos/${repoId}/conventions/skill`, input),
    onSuccess: () => {
      // The new skill shows up in the library, and linking bumped an agent.
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
```

- [ ] **Step 4: Re-export from the barrel**

In `client/src/lib/hooks/index.ts`, add `export * from "./conventions";` after the
`./skills` line.

- [ ] **Step 5: Replace the copy catalogue**

Overwrite `client/messages/en/conventions.json`. The existing keys' wording is
kept where it still applies — "house-rules" and "grounded against sampled files"
are the established terminology:

```json
{
  "page": {
    "crumbLab": "Skills Lab",
    "crumbConventions": "Conventions",
    "headingPrefix": "Conventions in ",
    "repoFallback": "repo",
    "subtitle": "Scan the cloned repo to surface house-rules — each backed by evidence you can turn into a Skill.",
    "scanning": "Scanning…",
    "rescan": "Re-scan",
    "runExtraction": "Run extraction",
    "extractionFailed": "Extraction failed",
    "loadError": "Could not load conventions.",
    "retry": "Retry",
    "empty": {
      "title": "No conventions extracted yet",
      "body": "Scan the repo to surface house-rules — naming, error handling, structure — each backed by evidence you can turn into a Skill.",
      "cta": "Run extraction"
    },
    "notIndexed": {
      "title": "This repo is not indexed yet",
      "body": "Without an index we can only read your config files. Re-sync the repo for a full scan across its most central code.",
      "cta": "Scan configs only"
    },
    "noneSurvived": {
      "title": "Nothing survived verification",
      "body": "The model proposed rules, but none cited evidence we could find in the sampled files. Re-scanning may do better.",
      "reasonsLabel": "Discarded"
    },
    "candidateCount": "{count, plural, one {# candidate} other {# candidates}} · grounded against sampled files"
  },
  "scan": {
    "detected": "Detected from {count, plural, one {# sample file} other {# sample files}}",
    "lastScan": "last scan {ago}",
    "never": "never scanned",
    "inFlight": "Scanning {sampled, plural, =0 {the repo} other {# files}}…",
    "model": "{provider} · {model}",
    "confirmTitle": "Re-scan this repo?",
    "confirmBody": "A re-scan replaces every candidate for this repo. This discards {accepted} accepted and {rejected} rejected {rejected, plural, one {convention} other {conventions}}. Skills you already created are unaffected.",
    "confirmCta": "Discard and re-scan",
    "confirmCancel": "Keep them",
    "dropReason": {
      "unknown_path": "cited a file we never showed the model",
      "missing_file": "cited a missing file",
      "line_out_of_range": "cited a line past the end of the file",
      "snippet_not_found": "quoted code we could not find",
      "low_confidence": "too low confidence",
      "duplicate": "duplicate of another rule",
      "over_quota": "over the per-category limit"
    }
  },
  "selection": {
    "count": "{accepted} of {total} accepted",
    "deselectAll": "Deselect all",
    "createSkill": "Create skill"
  },
  "card": {
    "confidence": "Confidence",
    "accepted": "Accepted",
    "accepting": "Accepting…",
    "acceptAsSkill": "Accept as Skill",
    "accept": "Accept",
    "reject": "Reject",
    "rejected": "Rejected",
    "edit": "Edit",
    "save": "Save",
    "cancel": "Cancel",
    "ruleLabel": "Rule",
    "pathLabel": "Evidence file",
    "lineLabel": "Line",
    "snippetLabel": "Evidence",
    "saveFailed": "Could not save this convention.",
    "category": {
      "naming": "naming",
      "structure": "structure",
      "error-handling": "error handling",
      "api-shape": "API shape",
      "testing": "testing",
      "imports": "imports",
      "typing": "typing",
      "tooling": "tooling"
    }
  },
  "modal": {
    "title": "Create skill from conventions",
    "mergedFrom": "Merged from {count, plural, one {# accepted convention} other {# accepted conventions}} in {repo}. Everything below is editable before you save.",
    "nameLabel": "Name",
    "descriptionLabel": "Description",
    "typeLabel": "Type",
    "enabledLabel": "Enabled",
    "enabledHint": "Whether this block is added to agents' prompts.",
    "bodyLabel": "Skill body",
    "unsaved": "unsaved",
    "tokens": "{count} tokens",
    "agentLabel": "Link to agent (optional)",
    "agentHint": "The skill lands in the agent's prompt on its next review.",
    "agentNone": "Don't link yet",
    "footerNote": "Saved as v1 · added to Skills Lab",
    "cancel": "Cancel",
    "create": "Create skill",
    "creating": "Creating…",
    "createFailed": "Could not create the skill.",
    "draftFailed": "Could not build the skill draft."
  }
}
```

- [ ] **Step 6: Run the test and typecheck**

Run: `cd client && pnpm exec vitest run src/lib/hooks/conventions.test.ts`
Expected: PASS (4 tests)

Run: `cd client && pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/hooks/conventions.ts client/src/lib/hooks/conventions.test.ts client/src/lib/hooks/index.ts client/messages/en/conventions.json
git commit -m "feat(conventions): hooks and copy for the conventions screen

The view query's refetchInterval is a function of its own data: it polls at
2.5s while the scan is queued or running and not at all once it settles."
```

---

## Task 2: `ConventionCard` — accept, reject, edit

**Files:**
- Create: `client/src/app/repos/[repoId]/conventions/_components/ConventionsView/_components/ConventionCard/ConventionCard.tsx`
- Create: `…/ConventionCard/styles.ts`, `…/ConventionCard/index.ts`
- Test: `…/ConventionCard/ConventionCard.test.tsx`

**Interfaces:**
- Consumes: `ConventionCandidate` from `@devdigest/shared`; `usePatchConvention` from `@/lib/hooks/conventions`.
- Produces: `<ConventionCard repoId={string} candidate={ConventionCandidate} />`.
  Self-contained: it owns its own mutation, its own edit-mode state, and needs no
  callbacks from the parent.

- [ ] **Step 1: Write the failing test**

Create `ConventionCard.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const candidate: ConventionCandidate = {
  id: "c1",
  category: "error-handling",
  rule: "Always use async/await instead of .then() chains",
  evidence_path: "src/api/users.ts",
  evidence_line: 23,
  evidence_snippet: "const user = await db.users.find(id);",
  confidence: 0.91,
  status: "pending",
};

/** Captures the PATCH so the test can assert what the card sent. */
function stubPatch(response: Partial<ConventionCandidate> = {}) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ ...candidate, ...response }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubFailure() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ error: { message: "boom" } }),
    })),
  );
}

function renderCard(over: Partial<ConventionCandidate> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <ConventionCard repoId="r1" candidate={{ ...candidate, ...over }} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function body(mock: ReturnType<typeof stubPatch>, call = 0) {
  return JSON.parse(String(mock.mock.calls[call]![1]!.body));
}

describe("ConventionCard", () => {
  it("shows the rule, its evidence location, the snippet and the confidence", () => {
    stubPatch();
    renderCard();
    expect(screen.getByText(candidate.rule)).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23")).toBeInTheDocument();
    expect(screen.getByText(candidate.evidence_snippet)).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("error handling")).toBeInTheDocument();
  });

  it("accepts the candidate", async () => {
    const mock = stubPatch({ status: "accepted" });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /^accept$/i }));
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(mock.mock.calls[0]![0]).toContain("/conventions/c1");
    expect(body(mock)).toEqual({ status: "accepted" });
  });

  it("rejects the candidate", async () => {
    const mock = stubPatch({ status: "rejected" });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(body(mock)).toEqual({ status: "rejected" });
  });

  it("marks an accepted candidate as accepted and offers to reject it", () => {
    stubPatch();
    renderCard({ status: "accepted" });
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
  });

  it("edits the rule and its evidence, sending only what changed", async () => {
    const mock = stubPatch();
    const { container } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    // The rule is a Textarea inside a FormField: no accessible name, so reach
    // for the node (see client/INSIGHTS.md).
    const textarea = container.querySelector("textarea")!;
    fireEvent.change(textarea, { target: { value: "Never chain .then()" } });
    fireEvent.change(screen.getByLabelText("Line"), { target: { value: "31" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(body(mock)).toEqual({ rule: "Never chain .then()", evidence_line: 31 });
  });

  it("leaves the candidate untouched when the edit is cancelled", () => {
    const mock = stubPatch();
    const { container } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(mock).not.toHaveBeenCalled();
    expect(screen.getByText(candidate.rule)).toBeInTheDocument();
  });

  it("does not send an empty rule", () => {
    const mock = stubPatch();
    const { container } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(mock).not.toHaveBeenCalled();
  });

  it("surfaces a failed save without losing the user's text", async () => {
    stubFailure();
    const { container } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "Never chain" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/Could not save this convention/)).toBeInTheDocument();
    expect(container.querySelector("textarea")!).toHaveValue("Never chain");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/conventions`
Expected: FAIL — cannot resolve `./ConventionCard`.

- [ ] **Step 3: Write `styles.ts`**

```ts
/* ConventionCard — one candidate and its evidence. */
export const s = {
  card: (status: string): React.CSSProperties => ({
    display: "flex",
    gap: 16,
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${
      status === "accepted" ? "var(--ok)" : status === "rejected" ? "var(--border)" : "var(--warn)"
    }`,
    background: "var(--bg-card)",
    opacity: status === "rejected" ? 0.55 : 1,
  }),
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 } as const,
  ruleRow: { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" } as const,
  rule: { fontSize: 14, fontWeight: 600, fontStyle: "italic", margin: 0 } as const,
  category: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "var(--text-muted)",
  } as const,
  evidence: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    overflow: "hidden",
  } as const,
  evidenceHead: {
    display: "flex",
    justifyContent: "space-between",
    padding: "6px 10px",
    fontSize: 12,
    color: "var(--text-muted)",
    background: "var(--bg-hover)",
  } as const,
  snippet: {
    margin: 0,
    padding: "10px 12px",
    fontSize: 12.5,
    overflowX: "auto",
    whiteSpace: "pre",
  } as const,
  confidenceRow: { display: "flex", alignItems: "center", gap: 10 } as const,
  confidenceLabel: { fontSize: 12, color: "var(--text-muted)" } as const,
  confidenceBar: { width: 140 } as const,
  actions: { display: "flex", flexDirection: "column", gap: 8, width: 150 } as const,
  editFields: { display: "flex", flexDirection: "column", gap: 10 } as const,
  editRow: { display: "flex", gap: 10 } as const,
  error: { fontSize: 12, color: "var(--danger)" } as const,
};
```

- [ ] **Step 4: Write `ConventionCard.tsx`**

```tsx
/* ConventionCard — one extracted candidate: the rule, the evidence it was
   grounded against, and the three things a user can do with it (accept, reject,
   edit). It owns its own mutation, so the list stays a dumb map. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Icon, ProgressBar, TextInput, Textarea } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { usePatchConvention, type ConventionPatch } from "@/lib/hooks/conventions";
import { s } from "./styles";

export function ConventionCard({
  repoId,
  candidate,
}: {
  repoId: string;
  candidate: ConventionCandidate;
}) {
  const t = useTranslations("conventions");
  const patch = usePatchConvention();

  const [editing, setEditing] = React.useState(false);
  const [rule, setRule] = React.useState(candidate.rule);
  const [line, setLine] = React.useState(String(candidate.evidence_line));
  const [path, setPath] = React.useState(candidate.evidence_path);

  function send(body: ConventionPatch) {
    patch.mutate({ repoId, id: candidate.id, patch: body });
  }

  /** Only changed fields go over the wire — an unchanged field is not an edit. */
  function save() {
    const next: ConventionPatch = {};
    if (rule.trim() && rule.trim() !== candidate.rule) next.rule = rule.trim();
    if (path.trim() && path.trim() !== candidate.evidence_path) next.evidence_path = path.trim();
    const parsed = Number(line);
    if (Number.isInteger(parsed) && parsed > 0 && parsed !== candidate.evidence_line) {
      next.evidence_line = parsed;
    }
    if (Object.keys(next).length === 0) {
      setEditing(false);
      return;
    }
    patch.mutate(
      { repoId, id: candidate.id, patch: next },
      { onSuccess: () => setEditing(false) },
    );
  }

  function cancel() {
    setRule(candidate.rule);
    setLine(String(candidate.evidence_line));
    setPath(candidate.evidence_path);
    setEditing(false);
  }

  return (
    <div style={s.card(candidate.status)}>
      <div style={s.main}>
        {editing ? (
          <div style={s.editFields}>
            <FormField label={t("card.ruleLabel")}>
              <Textarea value={rule} onChange={setRule} rows={3} />
            </FormField>
            <div style={s.editRow}>
              <FormField label={t("card.pathLabel")}>
                <TextInput value={path} onChange={setPath} aria-label={t("card.pathLabel")} />
              </FormField>
              <FormField label={t("card.lineLabel")}>
                <TextInput value={line} onChange={setLine} aria-label={t("card.lineLabel")} />
              </FormField>
            </div>
          </div>
        ) : (
          <>
            <div style={s.ruleRow}>
              <p style={s.rule}>{candidate.rule}</p>
              <span style={s.category}>{t(`card.category.${candidate.category}`)}</span>
            </div>

            <div style={s.evidence}>
              <div style={s.evidenceHead}>
                <span className="mono">
                  {candidate.evidence_path}:{candidate.evidence_line}
                </span>
              </div>
              <pre className="mono" style={s.snippet}>
                {candidate.evidence_snippet}
              </pre>
            </div>

            <div style={s.confidenceRow}>
              <span style={s.confidenceLabel}>{t("card.confidence")}</span>
              <div style={s.confidenceBar}>
                <ProgressBar
                  value={candidate.confidence}
                  color={candidate.confidence >= 0.85 ? "var(--ok)" : "var(--warn)"}
                />
              </div>
              <span className="mono tnum" style={s.confidenceLabel}>
                {Math.round(candidate.confidence * 100)}%
              </span>
            </div>
          </>
        )}

        {patch.isError && <div style={s.error}>{t("card.saveFailed")}</div>}
      </div>

      <div style={s.actions}>
        {editing ? (
          <>
            <Button kind="primary" size="sm" onClick={save} disabled={patch.isPending}>
              {t("card.save")}
            </Button>
            <Button kind="ghost" size="sm" onClick={cancel}>
              {t("card.cancel")}
            </Button>
          </>
        ) : (
          <>
            {candidate.status === "accepted" ? (
              <Button kind="primary" size="sm" disabled>
                <Icon.Check size={14} /> {t("card.accepted")}
              </Button>
            ) : (
              <Button
                kind="primary"
                size="sm"
                onClick={() => send({ status: "accepted" })}
                disabled={patch.isPending}
              >
                {t("card.accept")}
              </Button>
            )}
            <Button
              kind="ghost"
              size="sm"
              onClick={() => send({ status: "rejected" })}
              disabled={patch.isPending || candidate.status === "rejected"}
            >
              <Icon.X size={14} /> {t("card.reject")}
            </Button>
            <Button kind="ghost" size="sm" onClick={() => setEditing(true)}>
              {t("card.edit")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
```

Create `index.ts`: `export { ConventionCard } from "./ConventionCard";`

- [ ] **Step 5: Run the test**

Run: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/conventions`
Expected: PASS (8 tests). If `Button`'s props differ (`kind`/`size`), read
`client/src/vendor/ui/primitives/Button.tsx` and use its real API rather than
changing the test's accessible names.

- [ ] **Step 6: Commit**

```bash
git add "client/src/app/repos/[repoId]/conventions"
git commit -m "feat(conventions): candidate card with accept, reject and inline edit

Save sends only changed fields, so a no-op edit is not a write. The card owns
its mutation; the list is a plain map over candidates."
```

---

## Task 3: `ScanHeader` and `SelectionBar`

**Files:**
- Create: `…/ConventionsView/_components/ScanHeader/{ScanHeader.tsx,helpers.ts,styles.ts,index.ts}`
- Create: `…/ConventionsView/_components/SelectionBar/{SelectionBar.tsx,styles.ts,index.ts}`
- Test: `…/ScanHeader/ScanHeader.test.tsx`, `…/ScanHeader/helpers.test.ts`, `…/SelectionBar/SelectionBar.test.tsx`

**Interfaces:**
- Consumes: `ConventionScan` from `@devdigest/shared`.
- Produces:
  - `helpers.ts`: `relativeTime(iso: string | null, now: Date): string` → `"1h ago"` / `"just now"` / `""`.
  - `<ScanHeader scan={ConventionScan | null} accepted={number} rejected={number} busy={boolean} onRescan={() => void} />` — renders the sample-count line and a Re-scan button that confirms first **only when there are decisions to lose**.
  - `<SelectionBar accepted={number} total={number} busy={boolean} onDeselectAll={() => void} onCreateSkill={() => void} />`.

- [ ] **Step 1: Write the failing helper test**

Create `…/ScanHeader/helpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { relativeTime } from "./helpers";

const now = new Date("2026-08-03T12:00:00.000Z");

describe("relativeTime", () => {
  it("is empty for a scan that never finished", () => {
    expect(relativeTime(null, now)).toBe("");
  });

  it("reads as just now under a minute", () => {
    expect(relativeTime("2026-08-03T11:59:30.000Z", now)).toBe("just now");
  });

  it("counts whole minutes, hours and days", () => {
    expect(relativeTime("2026-08-03T11:45:00.000Z", now)).toBe("15m ago");
    expect(relativeTime("2026-08-03T11:00:00.000Z", now)).toBe("1h ago");
    expect(relativeTime("2026-08-01T12:00:00.000Z", now)).toBe("2d ago");
  });
});
```

- [ ] **Step 2: Write the failing component tests**

Create `…/ScanHeader/ScanHeader.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionScan } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/conventions.json";
import { ScanHeader } from "./ScanHeader";

afterEach(cleanup);

function scan(over: Partial<ConventionScan> = {}): ConventionScan {
  return {
    status: "done",
    pool_count: 40,
    sample_count: 84,
    candidate_count: 3,
    dropped: {},
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    error: null,
    started_at: "2026-08-03T10:00:00.000Z",
    finished_at: "2026-08-03T10:00:31.000Z",
    ...over,
  };
}

function renderHeader(props: Partial<React.ComponentProps<typeof ScanHeader>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ScanHeader
        scan={scan()}
        accepted={0}
        rejected={0}
        busy={false}
        onRescan={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("ScanHeader", () => {
  it("reports how many files were sampled", () => {
    renderHeader();
    expect(screen.getByText(/Detected from 84 sample files/)).toBeInTheDocument();
  });

  it("re-scans straight away when there is nothing to lose", () => {
    const onRescan = vi.fn();
    renderHeader({ onRescan });
    fireEvent.click(screen.getByRole("button", { name: /re-scan/i }));
    expect(onRescan).toHaveBeenCalledTimes(1);
  });

  it("names the decisions a re-scan would discard before running it", () => {
    const onRescan = vi.fn();
    renderHeader({ accepted: 2, rejected: 5, onRescan });
    fireEvent.click(screen.getByRole("button", { name: /re-scan/i }));
    expect(onRescan).not.toHaveBeenCalled();
    expect(screen.getByText(/discards 2 accepted and 5 rejected conventions/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /discard and re-scan/i }));
    expect(onRescan).toHaveBeenCalledTimes(1);
  });

  it("keeps the decisions when the confirmation is dismissed", () => {
    const onRescan = vi.fn();
    renderHeader({ accepted: 2, rejected: 5, onRescan });
    fireEvent.click(screen.getByRole("button", { name: /re-scan/i }));
    fireEvent.click(screen.getByRole("button", { name: /keep them/i }));
    expect(onRescan).not.toHaveBeenCalled();
  });

  it("shows progress and blocks a second scan while one is in flight", () => {
    renderHeader({ scan: scan({ status: "running" }), busy: true });
    expect(screen.getByText(/Scanning/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-scan/i })).toBeDisabled();
  });

  it("offers a first run for a repo that was never scanned", () => {
    const onRescan = vi.fn();
    renderHeader({ scan: null, onRescan });
    fireEvent.click(screen.getByRole("button", { name: /run extraction/i }));
    expect(onRescan).toHaveBeenCalledTimes(1);
  });
});
```

Create `…/SelectionBar/SelectionBar.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/conventions.json";
import { SelectionBar } from "./SelectionBar";

afterEach(cleanup);

function renderBar(props: Partial<React.ComponentProps<typeof SelectionBar>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <SelectionBar
        accepted={3}
        total={3}
        busy={false}
        onDeselectAll={() => {}}
        onCreateSkill={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("SelectionBar", () => {
  it("counts the accepted candidates", () => {
    renderBar();
    expect(screen.getByText("3 of 3 accepted")).toBeInTheDocument();
  });

  it("creates a skill from the accepted set", () => {
    const onCreateSkill = vi.fn();
    renderBar({ onCreateSkill });
    fireEvent.click(screen.getByRole("button", { name: /create skill/i }));
    expect(onCreateSkill).toHaveBeenCalled();
  });

  it("cannot create a skill with nothing accepted — the endpoint 409s", () => {
    renderBar({ accepted: 0 });
    expect(screen.getByRole("button", { name: /create skill/i })).toBeDisabled();
  });

  it("deselects everything", () => {
    const onDeselectAll = vi.fn();
    renderBar({ onDeselectAll });
    fireEvent.click(screen.getByRole("button", { name: /deselect all/i }));
    expect(onDeselectAll).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/conventions`
Expected: FAIL — neither component resolves.

- [ ] **Step 4: Write `ScanHeader/helpers.ts`**

```ts
/** "1h ago" style stamp for the last finished scan. `now` is injected so the
    test does not depend on the clock. */
export function relativeTime(iso: string | null, now: Date): string {
  if (!iso) return "";
  const seconds = Math.floor((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
```

- [ ] **Step 5: Write `ScanHeader/styles.ts` and `ScanHeader.tsx`**

`styles.ts`:

```ts
/* ScanHeader — the scan's provenance line and the Re-scan control. */
export const s = {
  row: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  } as const,
  meta: { fontSize: 13, color: "var(--text-muted)", margin: 0 } as const,
  model: { fontSize: 12, color: "var(--text-muted)" } as const,
  confirm: {
    marginTop: 12,
    padding: 14,
    borderRadius: 10,
    border: "1px solid var(--warn)",
    background: "var(--bg-card)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } as const,
  confirmTitle: { fontSize: 13, fontWeight: 600, margin: 0 } as const,
  confirmBody: { fontSize: 13, color: "var(--text-muted)", margin: 0 } as const,
  confirmActions: { display: "flex", gap: 8 } as const,
};
```

`ScanHeader.tsx`:

```tsx
/* ScanHeader — where the candidates came from, and the button that throws them
   away. A re-scan is replace-all, so it confirms and names the count first;
   losing hand-made decisions silently is worse than an extra click. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import type { ConventionScan } from "@devdigest/shared";
import { relativeTime } from "./helpers";
import { s } from "./styles";

export function ScanHeader({
  scan,
  accepted,
  rejected,
  busy,
  onRescan,
}: {
  scan: ConventionScan | null;
  accepted: number;
  rejected: number;
  busy: boolean;
  onRescan: () => void;
}) {
  const t = useTranslations("conventions");
  const [confirming, setConfirming] = React.useState(false);

  const decisions = accepted + rejected;
  const inFlight = busy || scan?.status === "queued" || scan?.status === "running";

  function requestRescan() {
    if (decisions === 0) {
      onRescan();
      return;
    }
    setConfirming(true);
  }

  function confirm() {
    setConfirming(false);
    onRescan();
  }

  return (
    <div>
      <div style={s.row}>
        <p style={s.meta}>
          {inFlight
            ? t("scan.inFlight", { sampled: scan?.sample_count ?? 0 })
            : scan
              ? [
                  t("scan.detected", { count: scan.sample_count }),
                  scan.finished_at
                    ? t("scan.lastScan", { ago: relativeTime(scan.finished_at, new Date()) })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : t("scan.never")}
          {scan?.model ? (
            <>
              {" · "}
              <span className="mono" style={s.model}>
                {t("scan.model", { provider: scan.provider ?? "", model: scan.model })}
              </span>
            </>
          ) : null}
        </p>

        <Button kind="ghost" size="sm" onClick={requestRescan} disabled={inFlight}>
          <Icon.RefreshCw size={14} />
          {scan ? t("page.rescan") : t("page.runExtraction")}
        </Button>
      </div>

      {confirming && (
        <div style={s.confirm} role="alertdialog" aria-label={t("scan.confirmTitle")}>
          <p style={s.confirmTitle}>{t("scan.confirmTitle")}</p>
          <p style={s.confirmBody}>{t("scan.confirmBody", { accepted, rejected })}</p>
          <div style={s.confirmActions}>
            <Button kind="primary" size="sm" onClick={confirm}>
              {t("scan.confirmCta")}
            </Button>
            <Button kind="ghost" size="sm" onClick={() => setConfirming(false)}>
              {t("scan.confirmCancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

`index.ts`: `export { ScanHeader } from "./ScanHeader";`

- [ ] **Step 6: Write `SelectionBar/styles.ts` and `SelectionBar.tsx`**

`styles.ts`:

```ts
/* SelectionBar — the accepted count and the path to a skill. */
export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 0",
  } as const,
  left: { display: "flex", alignItems: "center", gap: 12 } as const,
  count: { fontSize: 13, color: "var(--text-muted)" } as const,
};
```

`SelectionBar.tsx`:

```tsx
/* SelectionBar — how many candidates are accepted, and the one action that
   turns them into a skill. Disabled at zero: the endpoint 409s, and a button
   that always fails is worse than one that says it cannot run. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import { s } from "./styles";

export function SelectionBar({
  accepted,
  total,
  busy,
  onDeselectAll,
  onCreateSkill,
}: {
  accepted: number;
  total: number;
  busy: boolean;
  onDeselectAll: () => void;
  onCreateSkill: () => void;
}) {
  const t = useTranslations("conventions");
  return (
    <div style={s.row}>
      <div style={s.left}>
        <Button kind="ghost" size="sm" onClick={onDeselectAll} disabled={accepted === 0 || busy}>
          <Icon.X size={14} /> {t("selection.deselectAll")}
        </Button>
        <span style={s.count}>{t("selection.count", { accepted, total })}</span>
      </div>
      <Button kind="primary" size="sm" onClick={onCreateSkill} disabled={accepted === 0 || busy}>
        <Icon.Sparkles size={14} /> {t("selection.createSkill")}
      </Button>
    </div>
  );
}
```

`index.ts`: `export { SelectionBar } from "./SelectionBar";`

- [ ] **Step 7: Run the tests**

Run: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/conventions`
Expected: PASS (4 helper + 6 header + 4 bar + 8 card = 22 tests)

- [ ] **Step 8: Commit**

```bash
git add "client/src/app/repos/[repoId]/conventions"
git commit -m "feat(conventions): scan header with a confirming re-scan, and the selection bar

Re-scan is replace-all, so it names what it destroys — '2 accepted and 5
rejected' — and only asks when there is something to lose."
```

---

## Task 4: `CreateConventionSkillModal`

**Files:**
- Create: `…/ConventionsView/_components/CreateConventionSkillModal/{CreateConventionSkillModal.tsx,constants.ts,styles.ts,index.ts}`
- Test: `…/CreateConventionSkillModal/CreateConventionSkillModal.test.tsx`

**Interfaces:**
- Consumes: `useConventionSkillDraft`, `useCreateConventionSkill` from `@/lib/hooks/conventions`; `useAgents` from `@/lib/hooks/agents`; `SkillType` from `@devdigest/shared`.
- Produces: `<CreateConventionSkillModal repoId={string} repoName={string} acceptedCount={number} onClose={() => void} onCreated={(skillId: string) => void} />`.

- [ ] **Step 1: Write the failing test**

Create `CreateConventionSkillModal.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../../../../../../../messages/en/conventions.json";
import { CreateConventionSkillModal } from "./CreateConventionSkillModal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DRAFT = {
  name: "payments-api-conventions",
  description: "3 house conventions extracted from payments-api",
  type: "convention",
  body: "# payments-api-conventions\n\nAlways use async/await.",
  token_estimate: 187,
};

const AGENTS = [
  { id: "a1", name: "API Contract Reviewer", version: 3 },
  { id: "a2", name: "Security Reviewer", version: 1 },
];

/** Routes each stubbed request by URL: draft (GET), agents (GET), create (POST). */
function stubApi(opts: { draftFails?: boolean; createFails?: boolean } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/skill-draft")) {
      return opts.draftFails
        ? { ok: false, status: 409, statusText: "Conflict", json: async () => ({ error: { message: "nothing accepted" } }) }
        : { ok: true, status: 200, statusText: "OK", json: async () => DRAFT };
    }
    if (String(url).includes("/agents")) {
      return { ok: true, status: 200, statusText: "OK", json: async () => AGENTS };
    }
    if (init?.method === "POST") {
      return opts.createFails
        ? { ok: false, status: 500, statusText: "Internal Server Error", json: async () => ({ error: { message: "boom" } }) }
        : { ok: true, status: 201, statusText: "Created", json: async () => ({ id: "sk9" }) };
    }
    throw new Error(`unstubbed ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderModal(props: Partial<React.ComponentProps<typeof CreateConventionSkillModal>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <CreateConventionSkillModal
          repoId="r1"
          repoName="payments-api"
          acceptedCount={3}
          onClose={() => {}}
          onCreated={() => {}}
          {...props}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function postBody(mock: ReturnType<typeof stubApi>) {
  const call = mock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
  return JSON.parse(String((call[1] as RequestInit).body));
}

describe("CreateConventionSkillModal", () => {
  it("prefills name, description and body from the server draft", async () => {
    stubApi();
    const { container } = renderModal();
    expect(await screen.findByDisplayValue("payments-api-conventions")).toBeInTheDocument();
    expect(screen.getByDisplayValue(DRAFT.description)).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelector("textarea")).toHaveValue(DRAFT.body),
    );
  });

  it("says what the body was merged from and how big it is", async () => {
    stubApi();
    renderModal();
    expect(
      await screen.findByText(/Merged from 3 accepted conventions in payments-api/),
    ).toBeInTheDocument();
    expect(screen.getByText("187 tokens")).toBeInTheDocument();
  });

  it("creates the skill with the edited body", async () => {
    const mock = stubApi();
    const { container } = renderModal();
    await waitFor(() => expect(container.querySelector("textarea")).toHaveValue(DRAFT.body));
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "edited body" } });
    fireEvent.click(screen.getByRole("button", { name: /^create skill$/i }));

    await waitFor(() => expect(postBody(mock).body).toBe("edited body"));
    expect(postBody(mock).name).toBe("payments-api-conventions");
    expect(postBody(mock).type).toBe("convention");
  });

  it("links the chosen agent, and sends no agent when none is chosen", async () => {
    const mock = stubApi();
    renderModal();
    await screen.findByDisplayValue("payments-api-conventions");

    fireEvent.click(screen.getByRole("button", { name: /^create skill$/i }));
    await waitFor(() => expect(postBody(mock)).not.toHaveProperty("agent_id"));

    cleanup();
    const mock2 = stubApi();
    renderModal();
    await screen.findByDisplayValue("payments-api-conventions");
    fireEvent.change(await screen.findByLabelText(/Link to agent/), { target: { value: "a1" } });
    fireEvent.click(screen.getByRole("button", { name: /^create skill$/i }));
    await waitFor(() => expect(postBody(mock2).agent_id).toBe("a1"));
  });

  it("hands the new skill id back to the caller", async () => {
    stubApi();
    const onCreated = vi.fn();
    renderModal({ onCreated });
    await screen.findByDisplayValue("payments-api-conventions");
    fireEvent.click(screen.getByRole("button", { name: /^create skill$/i }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("sk9"));
  });

  it("cannot submit with an empty name", async () => {
    stubApi();
    renderModal();
    const name = await screen.findByDisplayValue("payments-api-conventions");
    fireEvent.change(name, { target: { value: "  " } });
    expect(screen.getByRole("button", { name: /^create skill$/i })).toBeDisabled();
  });

  it("explains a draft that could not be built", async () => {
    stubApi({ draftFails: true });
    renderModal();
    expect(await screen.findByText(/Could not build the skill draft/)).toBeInTheDocument();
  });

  it("surfaces a failed creation", async () => {
    stubApi({ createFails: true });
    renderModal();
    await screen.findByDisplayValue("payments-api-conventions");
    fireEvent.click(screen.getByRole("button", { name: /^create skill$/i }));
    expect(await screen.findByText(/Could not create the skill/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/conventions`
Expected: FAIL — the modal does not exist.

- [ ] **Step 3: Write `constants.ts` and `styles.ts`**

`constants.ts`:

```ts
import type { SkillType } from "@devdigest/shared";

/** Same order as the Skills library's own selector. */
export const SKILL_TYPES: SkillType[] = ["rubric", "convention", "security", "custom"];

/** Matches the server's body limit (specs/skills.md). */
export const MAX_SKILL_BODY_CHARS = 20_000;
```

`styles.ts`:

```ts
/* CreateConventionSkillModal. The vendored Modal gives its body ZERO padding —
   the 24px gutter has to come from here (see client/INSIGHTS.md). */
export const s = {
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 16 } as const,
  banner: {
    display: "flex",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-hover)",
    fontSize: 13,
  } as const,
  twoUp: { display: "flex", gap: 16, alignItems: "flex-start" } as const,
  toggleWrap: { display: "flex", flexDirection: "column", gap: 6 } as const,
  toggleHint: { fontSize: 12, color: "var(--text-muted)" } as const,
  bodyHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    fontSize: 12,
    color: "var(--text-muted)",
  } as const,
  unsaved: {
    fontSize: 11,
    padding: "1px 6px",
    borderRadius: 4,
    background: "var(--bg-hover)",
    color: "var(--text-muted)",
  } as const,
  footer: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 } as const,
  footerNote: { fontSize: 12, color: "var(--text-muted)" } as const,
  footerActions: { display: "flex", gap: 8 } as const,
  error: { fontSize: 12, color: "var(--danger)" } as const,
};
```

- [ ] **Step 4: Write `CreateConventionSkillModal.tsx`**

```tsx
/* CreateConventionSkillModal — the accepted candidates, merged server-side into
   one skill body, then handed to the user to edit before it is saved. That
   review step is the whole trust boundary for `source: 'extracted'` (design §7),
   so the full body is always visible and always editable here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  FormField,
  Icon,
  Modal,
  SelectInput,
  TextInput,
  Textarea,
  Toggle,
} from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useAgents } from "@/lib/hooks/agents";
import { useConventionSkillDraft, useCreateConventionSkill } from "@/lib/hooks/conventions";
import { MAX_SKILL_BODY_CHARS, SKILL_TYPES } from "./constants";
import { s } from "./styles";

export function CreateConventionSkillModal({
  repoId,
  repoName,
  acceptedCount,
  onClose,
  onCreated,
}: {
  repoId: string;
  repoName: string;
  acceptedCount: number;
  onClose: () => void;
  onCreated: (skillId: string) => void;
}) {
  const t = useTranslations("conventions");
  const draft = useConventionSkillDraft(repoId, true);
  const agents = useAgents();
  const create = useCreateConventionSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("convention");
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState("");
  const [agentId, setAgentId] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  // Adopt the draft once. After that the fields are the user's, and a refetch
  // must not overwrite what they typed.
  const adopted = React.useRef(false);
  React.useEffect(() => {
    if (adopted.current || !draft.data) return;
    adopted.current = true;
    setName(draft.data.name);
    setDescription(draft.data.description);
    setType(draft.data.type);
    setBody(draft.data.body);
  }, [draft.data]);

  const overLimit = body.length > MAX_SKILL_BODY_CHARS;
  const canSubmit = name.trim().length > 0 && body.trim().length > 0 && !overLimit;

  function submit() {
    if (!canSubmit) return;
    create.mutate(
      {
        repoId,
        input: {
          name: name.trim(),
          description: description.trim(),
          type,
          body,
          enabled,
          ...(agentId ? { agent_id: agentId } : {}),
        },
      },
      { onSuccess: (skill) => onCreated(skill.id) },
    );
  }

  return (
    <Modal
      title={t("modal.title")}
      subtitle={name || repoName}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <span style={s.footerNote}>{t("modal.footerNote")}</span>
          <div style={s.footerActions}>
            <Button kind="ghost" size="sm" onClick={onClose}>
              {t("modal.cancel")}
            </Button>
            <Button
              kind="primary"
              size="sm"
              onClick={submit}
              disabled={!canSubmit || create.isPending}
            >
              <Icon.Sparkles size={14} />
              {create.isPending ? t("modal.creating") : t("modal.create")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.banner}>
          <Icon.Sparkles size={15} />
          <span>{t("modal.mergedFrom", { count: acceptedCount, repo: repoName })}</span>
        </div>

        {draft.isError && <div style={s.error}>{t("modal.draftFailed")}</div>}

        <FormField label={t("modal.nameLabel")} required>
          <TextInput
            value={name}
            onChange={(v) => {
              setName(v);
              setTouched(true);
            }}
            aria-label={t("modal.nameLabel")}
          />
        </FormField>

        <FormField label={t("modal.descriptionLabel")}>
          <TextInput
            value={description}
            onChange={setDescription}
            aria-label={t("modal.descriptionLabel")}
          />
        </FormField>

        <div style={s.twoUp}>
          <FormField label={t("modal.typeLabel")}>
            <SelectInput
              value={type}
              onChange={(v) => setType(v as SkillType)}
              options={SKILL_TYPES.map((k) => ({ value: k, label: k }))}
            />
          </FormField>
          <div style={s.toggleWrap}>
            <FormField label={t("modal.enabledLabel")}>
              <Toggle on={enabled} onChange={setEnabled} />
            </FormField>
            <span style={s.toggleHint}>{t("modal.enabledHint")}</span>
          </div>
        </div>

        <FormField label={t("modal.agentLabel")} hint={t("modal.agentHint")}>
          <SelectInput
            value={agentId}
            onChange={setAgentId}
            aria-label={t("modal.agentLabel")}
            options={[
              { value: "", label: t("modal.agentNone") },
              ...(agents.data ?? []).map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
        </FormField>

        <FormField label={t("modal.bodyLabel")} required>
          <div style={s.bodyHead}>
            <span className="mono">
              {name || repoName}.md{" "}
              {touched || body !== (draft.data?.body ?? "") ? (
                <span style={s.unsaved}>{t("modal.unsaved")}</span>
              ) : null}
            </span>
            <span className="mono tnum">
              {t("modal.tokens", { count: draft.data?.token_estimate ?? 0 })}
            </span>
          </div>
          <Textarea value={body} onChange={setBody} rows={12} mono />
        </FormField>

        {create.isError && <div style={s.error}>{t("modal.createFailed")}</div>}
      </div>
    </Modal>
  );
}
```

The type options use the raw `SkillType` values as labels, which is what the
mockup shows (`convention`, lower-case). The Skills library localises them
instead, through the `skills` namespace's `listItem.type.*` keys — if you prefer
that, copy the pattern from
`client/src/app/skills/_components/SkillsListView/_components/CreateSkillModal/CreateSkillModal.tsx`
rather than adding duplicate keys to the `conventions` catalogue.

One thing to verify, because it is a guess about a vendored component: whether
`SelectInput` forwards `aria-label` to its `<select>` — the agent-picker test
queries it by label. Read `client/src/vendor/ui/kit/SelectInput.tsx`. If it does
not forward, query by role in the test or label it the way a neighbour does; do
not fork the primitive. `client/INSIGHTS.md` records three prior cases of exactly
this in `Textarea`, `MonoLink` and the badge primitives.

`index.ts`: `export { CreateConventionSkillModal } from "./CreateConventionSkillModal";`

- [ ] **Step 5: Run the test**

Run: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/conventions`
Expected: PASS (all 8 modal tests plus the earlier 22)

- [ ] **Step 6: Commit**

```bash
git add "client/src/app/repos/[repoId]/conventions"
git commit -m "feat(conventions): create-skill modal with a draft prefill and agent picker

The draft is adopted once; a refetch must not overwrite the user's edits. The
optional agent link closes the loop from extraction to a review prompt."
```

---

## Task 5: `ConventionsView`, the route, and the nav entry

**Files:**
- Create: `…/ConventionsView/{ConventionsView.tsx,helpers.ts,styles.ts,index.ts}`
- Create: `client/src/app/repos/[repoId]/conventions/page.tsx`
- Modify: `client/src/vendor/ui/nav.ts`
- Test: `…/ConventionsView/ConventionsView.test.tsx`

**Interfaces:**
- Consumes: every component from Tasks 2–4, `useConventions`/`useExtractConventions`/`usePatchConvention`/`isScanInFlight`, `useActiveRepo` from `@/lib/repo-context`.
- Produces: `<ConventionsView repoId={string} />` covering the six states, and the
  route that wraps it in `AppShell`.

- [ ] **Step 1: Write the failing test**

Create `ConventionsView.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConventionCandidate, ConventionScan, ConventionsView as View } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ConventionsView } from "./ConventionsView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const candidate: ConventionCandidate = {
  id: "c1",
  category: "naming",
  rule: "Always suffix repositories with Repository",
  evidence_path: "src/a.ts",
  evidence_line: 2,
  evidence_snippet: "class UserRepository {",
  confidence: 0.9,
  status: "pending",
};

function scan(over: Partial<ConventionScan> = {}): ConventionScan {
  return {
    status: "done",
    pool_count: 40,
    sample_count: 14,
    candidate_count: 1,
    dropped: {},
    provider: "openrouter",
    model: "cheap",
    error: null,
    started_at: "2026-08-03T10:00:00.000Z",
    finished_at: "2026-08-03T10:00:31.000Z",
    ...over,
  };
}

function stubView(view: View) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return { ok: true, status: 202, statusText: "Accepted", json: async () => ({ jobId: "j1" }) };
    }
    if (String(url).includes("/agents")) {
      return { ok: true, status: 200, statusText: "OK", json: async () => [] };
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => view };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubFailure() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ error: { message: "boom" } }),
    })),
  );
}

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <ConventionsView repoId="r1" repoName="payments-api" indexed />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ConventionsView", () => {
  it("invites a first scan for a repo that was never scanned", async () => {
    stubView({ scan: null, candidates: [] });
    renderView();
    expect(await screen.findByText("No conventions extracted yet")).toBeInTheDocument();
  });

  it("starts a scan from the empty state", async () => {
    const mock = stubView({ scan: null, candidates: [] });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /run extraction/i }));
    await waitFor(() =>
      expect(
        mock.mock.calls.some(
          (c) =>
            String(c[0]).includes("/conventions/extract") &&
            (c[1] as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("shows progress while the scan runs", async () => {
    stubView({ scan: scan({ status: "running", candidate_count: 0 }), candidates: [] });
    renderView();
    expect(await screen.findByText(/Scanning/)).toBeInTheDocument();
  });

  it("explains a scan that found nothing that survived verification", async () => {
    stubView({
      scan: scan({ candidate_count: 0, dropped: { snippet_not_found: 4, duplicate: 1 } }),
      candidates: [],
    });
    renderView();
    expect(await screen.findByText("Nothing survived verification")).toBeInTheDocument();
    expect(screen.getByText(/quoted code we could not find/)).toBeInTheDocument();
  });

  it("lists the candidates with the selection bar", async () => {
    stubView({ scan: scan(), candidates: [candidate] });
    renderView();
    expect(await screen.findByText(candidate.rule)).toBeInTheDocument();
    expect(screen.getByText("0 of 1 accepted")).toBeInTheDocument();
  });

  it("counts accepted candidates and opens the modal", async () => {
    stubView({ scan: scan(), candidates: [{ ...candidate, status: "accepted" }] });
    renderView();
    expect(await screen.findByText("1 of 1 accepted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /create skill/i }));
    expect(await screen.findByText(/Merged from 1 accepted convention/)).toBeInTheDocument();
  });

  it("surfaces a failed scan with its reason", async () => {
    stubView({ scan: scan({ status: "failed", error: "OPENROUTER_API_KEY is not configured" }), candidates: [] });
    renderView();
    expect(await screen.findByText(/Extraction failed/)).toBeInTheDocument();
    expect(screen.getByText(/OPENROUTER_API_KEY is not configured/)).toBeInTheDocument();
  });

  it("offers a retry when the view itself cannot load", async () => {
    stubFailure();
    renderView();
    expect(await screen.findByText("Could not load conventions.")).toBeInTheDocument();
  });

  it("says an unindexed repo can only be scanned for configs", async () => {
    stubView({ scan: null, candidates: [] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
          <ConventionsView repoId="r1" repoName="payments-api" indexed={false} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("This repo is not indexed yet")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/conventions`
Expected: FAIL — `ConventionsView` does not exist.

- [ ] **Step 3: Write `helpers.ts`**

```ts
import type { ConventionCandidate, ConventionDropCounts } from "@devdigest/shared";

/** Accepted / rejected tallies for the selection bar and the re-scan warning. */
export function tally(candidates: ConventionCandidate[]) {
  return {
    accepted: candidates.filter((c) => c.status === "accepted").length,
    rejected: candidates.filter((c) => c.status === "rejected").length,
    total: candidates.length,
  };
}

/** Drop reasons worth showing, most common first. */
export function dropEntries(dropped: ConventionDropCounts): [string, number][] {
  return Object.entries(dropped)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .sort((a, b) => b[1] - a[1]);
}
```

- [ ] **Step 4: Write `styles.ts`**

```ts
/* ConventionsView — the screen. */
export const s = {
  header: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 } as const,
  title: { fontSize: 24, fontWeight: 650, margin: 0 } as const,
  titleRepo: { color: "var(--accent)" } as const,
  subtitle: { fontSize: 13.5, color: "var(--text-muted)", margin: 0 } as const,
  list: { display: "flex", flexDirection: "column", gap: 14 } as const,
  failed: {
    padding: 14,
    borderRadius: 10,
    border: "1px solid var(--danger)",
    background: "var(--bg-card)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 16,
  } as const,
  failedTitle: { fontSize: 13, fontWeight: 600, margin: 0 } as const,
  failedBody: { fontSize: 12.5, color: "var(--text-muted)", margin: 0 } as const,
  reasons: { display: "flex", flexDirection: "column", gap: 4, marginTop: 10 } as const,
  reason: { fontSize: 12.5, color: "var(--text-muted)" } as const,
};
```

- [ ] **Step 5: Write `ConventionsView.tsx`**

```tsx
/* ConventionsView — the Conventions screen. Six states, one query: never
   scanned, scanning, done-with-nothing, done-with-candidates, failed, and
   "cannot load". The scan is server-side and asynchronous, so the query polls
   itself while it is in flight (see hooks/conventions.ts). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import {
  isScanInFlight,
  useConventions,
  useExtractConventions,
  usePatchConvention,
} from "@/lib/hooks/conventions";
import { ConventionCard } from "./_components/ConventionCard";
import { CreateConventionSkillModal } from "./_components/CreateConventionSkillModal";
import { ScanHeader } from "./_components/ScanHeader";
import { SelectionBar } from "./_components/SelectionBar";
import { dropEntries, tally } from "./helpers";
import { s } from "./styles";

export function ConventionsView({
  repoId,
  repoName,
  indexed,
}: {
  repoId: string;
  repoName: string;
  indexed: boolean;
}) {
  const t = useTranslations("conventions");
  const view = useConventions(repoId);
  const extract = useExtractConventions();
  const patch = usePatchConvention();
  const [modalOpen, setModalOpen] = React.useState(false);

  const scan = view.data?.scan ?? null;
  const candidates = view.data?.candidates ?? [];
  const counts = tally(candidates);
  const busy = extract.isPending || isScanInFlight(scan);

  function startScan() {
    extract.mutate(repoId);
  }

  /** Reject every accepted candidate — "deselect all" in the mockup. */
  function deselectAll() {
    for (const c of candidates.filter((x) => x.status === "accepted")) {
      patch.mutate({ repoId, id: c.id, patch: { status: "rejected" } });
    }
  }

  const header = (
    <div style={s.header}>
      <h1 style={s.title}>
        {t("page.headingPrefix")}
        <span className="mono" style={s.titleRepo}>
          {repoName}
        </span>
      </h1>
      <ScanHeader
        scan={scan}
        accepted={counts.accepted}
        rejected={counts.rejected}
        busy={busy}
        onRescan={startScan}
      />
    </div>
  );

  if (view.isLoading) {
    return (
      <>
        {header}
        <Skeleton />
      </>
    );
  }

  if (view.isError) {
    return (
      <>
        {header}
        <ErrorState title={t("page.loadError")} onRetry={() => view.refetch()} />
      </>
    );
  }

  return (
    <>
      {header}

      {scan?.status === "failed" && (
        <div style={s.failed}>
          <p style={s.failedTitle}>{t("page.extractionFailed")}</p>
          <p style={s.failedBody}>{scan.error}</p>
        </div>
      )}

      {candidates.length === 0 ? (
        scan && scan.status === "done" ? (
          <EmptyState
            icon="AlertTriangle"
            title={t("page.noneSurvived.title")}
            body={t("page.noneSurvived.body")}
          >
            <div style={s.reasons}>
              {dropEntries(scan.dropped).map(([reason, count]) => (
                <span key={reason} style={s.reason}>
                  {count} × {t(`scan.dropReason.${reason}`)}
                </span>
              ))}
            </div>
          </EmptyState>
        ) : indexed ? (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
          >
            <Button kind="primary" size="sm" onClick={startScan} disabled={busy}>
              {t("page.empty.cta")}
            </Button>
          </EmptyState>
        ) : (
          <EmptyState
            icon="AlertTriangle"
            title={t("page.notIndexed.title")}
            body={t("page.notIndexed.body")}
          >
            <Button kind="ghost" size="sm" onClick={startScan} disabled={busy}>
              {t("page.notIndexed.cta")}
            </Button>
          </EmptyState>
        )
      ) : (
        <>
          <SelectionBar
            accepted={counts.accepted}
            total={counts.total}
            busy={busy}
            onDeselectAll={deselectAll}
            onCreateSkill={() => setModalOpen(true)}
          />
          <div style={s.list}>
            {candidates.map((c) => (
              <ConventionCard key={c.id} repoId={repoId} candidate={c} />
            ))}
          </div>
        </>
      )}

      {modalOpen && (
        <CreateConventionSkillModal
          repoId={repoId}
          repoName={repoName}
          acceptedCount={counts.accepted}
          onClose={() => setModalOpen(false)}
          onCreated={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
```

Check two vendored APIs while writing this: whether `EmptyState` accepts
`children` (the drop-reason list and the CTA are rendered as children above) and
what `ErrorState`'s retry prop is actually called — read
`client/src/vendor/ui/primitives/{EmptyState,ErrorState}.tsx` and adapt. If
`EmptyState` takes no children, render the CTA and reasons as siblings beneath it.

`index.ts`: `export { ConventionsView } from "./ConventionsView";`

- [ ] **Step 6: Write the route**

Create `client/src/app/repos/[repoId]/conventions/page.tsx`:

```tsx
/* Route: /repos/:repoId/conventions — extract house conventions from the clone
   and turn the accepted ones into a Skill. Thin by convention: the screen's
   logic lives in _components/ConventionsView. */
"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useIndexState } from "@/lib/hooks/repo-intel";
import { ConventionsView } from "./_components/ConventionsView";

export default function ConventionsPage() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const notFound = useRepoNotFound(repoId);
  const indexState = useIndexState(repoId);

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  if (notFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <ConventionsView
        repoId={repoId}
        repoName={activeRepo?.name ?? t("page.repoFallback")}
        indexed={(indexState.data?.filesIndexed ?? 0) > 0}
      />
    </AppShell>
  );
}
```

`useIndexState` and the field it exposes are a guess — read
`client/src/lib/hooks/repo-intel.ts` and use its real hook name and the field that
says whether the repo has an index. If nothing suitable exists, pass
`indexed={true}` and delete the unindexed branch's trigger rather than inventing
an endpoint.

- [ ] **Step 7: Add the nav entry**

In `client/src/vendor/ui/nav.ts`, add to the `SKILLS LAB` group's `items`, after
`agents`:

```ts
      { key: "conventions", label: "Conventions", icon: "ListChecks", href: "/repos/:repoId/conventions", gKey: "c" },
```

and to `SHORTCUTS`, after the `g a` row:

```ts
  { keys: "g c", label: "Go to Conventions", group: "Navigation" },
```

Then check `client/src/components/app-shell/helpers.ts` for how a pathname maps
to a nav key (the skills design notes it already maps `/skills`); add the
`conventions` mapping there if that function needs one to highlight the item.

- [ ] **Step 8: Run the whole client suite**

Run: `cd client && pnpm test`
Expected: PASS — the new files plus every pre-existing test.

Run: `cd client && pnpm typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add "client/src/app/repos/[repoId]/conventions" client/src/vendor/ui/nav.ts client/src/components/app-shell
git commit -m "feat(conventions): the Conventions screen and its route

Six states over one polling query. A zero-candidate scan shows the drop reasons
rather than a blank slate — that is the difference between 'found nothing' and
'found twenty and threw them all away'."
```

---

## Task 6: The screen spec and the route map

**Files:**
- Create: `client/specs/conventions.md`
- Modify: `client/README.md`

**Interfaces:**
- Consumes: the finished screen.
- Produces: no code.

- [ ] **Step 1: Write `client/specs/conventions.md`**

Follow `client/specs/skills-library.md`'s structure. Per `client/CLAUDE.md`,
specs describe **behaviour, never markup** — a spec that pins class names goes
stale immediately. Cover: the journey (scan → review → accept/edit → create skill
→ optionally link an agent); each of the six states and what the user sees in it;
the data sources (which hook hits which endpoint, and that polling is conditional
on `scan.status`); the re-scan confirmation and why it names the counts; and an
acceptance checklist matching the tests written in Tasks 2–5.

- [ ] **Step 2: Add the route to the README map**

In `client/README.md`'s mermaid route map, add the node and its API edge:

```
  CONV["/repos/:repoId/conventions<br/>extract · accept/reject/edit · create skill"]
  CONV -->|"GET/POST /repos/:id/conventions(/extract|/skill-draft|/skill)<br/>PATCH /conventions/:id"| API
```

- [ ] **Step 3: Record what this session learned**

Invoke the `engineering-insights` skill for `client/INSIGHTS.md`. Offer only
entries that are non-obvious, durable and actionable cold — for example whichever
vendored primitive's real API differed from what this plan assumed
(`EmptyState` children, `ErrorState`'s retry prop, `SelectInput`'s `aria-label`
forwarding), since that is the same family as the existing `Textarea`/`FormField`
and `MonoLink` entries and will bite the next feature the same way. Do not record
what the code or `CLAUDE.md` already says.

- [ ] **Step 4: Commit**

```bash
git add client/specs/conventions.md client/README.md client/INSIGHTS.md
git commit -m "docs(conventions): spec the screen and add it to the route map"
```

---

## Self-Review

**Spec coverage.** Design §6 walked against the tasks: repo-scoped route → Task 5;
the nav entry and shortcut → Task 5; the four-component tree → Tasks 2–5, one task
each for the pieces with real behaviour; the hook path with a conditional 2.5 s
poll → Task 1; all six states → Task 5's tests, one case each; the confirming
Re-scan that names the counts → Task 3; the modal matching the mockup plus the
agent picker → Task 4; extending the existing `conventions.json` rather than
adding a catalogue → Task 1. Design §7's consequence for the UI — the body must
be visible and editable before saving — is enforced by Task 4's prefill and
edited-body tests.

One gap found and closed: nothing exercised **editing** a candidate, which is an
explicit user story ("едитувати конкретний інсайт"). Task 2 gained four cases for
it — save, cancel, empty-rule guard, and a failed save that keeps the text.

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N".
Four places deliberately send the implementer to read a vendored component
instead of trusting this plan: `Button`'s props (Task 2), `SelectInput` option
labels and `aria-label` forwarding (Task 4), `EmptyState`/`ErrorState` APIs
(Task 5), and `repo-intel`'s index-state hook (Task 5). Each says what to do if
reality differs. `client/INSIGHTS.md` records three separate cases of a vendored
primitive not forwarding what a feature assumed — guessing these would produce
code that does not compile.

**Type consistency.** `ConventionCandidate` (snake_case wire shape) is what the
hooks return, what `ConventionCard` takes, and what `tally`/`dropEntries` read.
`ConventionPatch` is the same interface in `usePatchConvention`, in the card's
`send`/`save`, and in the assertions on the request body. `ConventionScan` flows
from `useConventions` into `isScanInFlight` and `ScanHeader` unchanged.
`CreateConventionSkillInput` matches the server plan's `CreateSkillBody` field
for field, including `agent_id` being absent rather than empty when no agent is
chosen — which is what Task 4's fourth test asserts.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-03-conventions-extractor-client.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.
