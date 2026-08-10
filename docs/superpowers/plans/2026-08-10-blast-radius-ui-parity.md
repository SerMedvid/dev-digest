# Blast Radius UI Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the blast radius card to match the design comp — icon counters, collapsible symbols, a graph that opens in a modal over a force layout — and place Intent and Blast side by side on the Overview tab.

**Architecture:** Pure client change in `client/`. The card decomposes into three local children (`CounterRow`, `SymbolRow`, `BlastGraphDialog`) so `BlastCard.tsx` keeps only data fetching, status branching, and dialog open state. `BlastGraph`'s layout module swaps its layered `d3-scale` geometry for a `d3-force` simulation run to completion synchronously, so it stays a pure function returning plain data with React owning every DOM node. No contract, endpoint, hook, or model call changes.

**Tech Stack:** Next.js 15 App Router (client-side SPA), React 19, TanStack Query, next-intl, vitest + jsdom + React Testing Library, `d3-force` (already resolvable — see constraints).

**Spec:** [`docs/superpowers/specs/2026-08-10-blast-radius-ui-parity-design.md`](../specs/2026-08-10-blast-radius-ui-parity-design.md)

## Global Constraints

- **Package manager is `pnpm`** in `client/`. Never run `npm install` here — it writes a second lockfile.
- **No dependency is added to `client/package.json`.** `d3-force` and `@types/d3-force` already resolve flat out of `client/node_modules/.pnpm/node_modules` because the repo-root `.npmrc` sets `node-linker=hoisted`; they arrive transitively via `recharts` → `victory-vendor`. This is the same footing today's `d3-scale`/`d3-shape` imports stand on.
- **Styling is inline `CSSProperties` exported as `s` from `styles.ts`**, applied with `style={s.x}` — matching every neighbour under `client/src/app/repos/[repoId]/pulls/[number]/_components/`, NOT the Tailwind rule in `client/CLAUDE.md`. (`client/INSIGHTS.md`, 2026-08-06.)
- **Tailwind 4 preflight is active**: it sets `display: block` on **every** `svg` and strips `ul` markers. Any icon sitting beside text must live in a `display: flex` container, or it takes a whole line to itself. This is invisible to `tsc` and to jsdom tests. (`client/INSIGHTS.md`, 2026-08-06.)
- **The vendored `Modal` gives its body zero padding** while padding its own header — the feature must supply the gutter with a wrapping `<div style={{ padding: 24 }}>`. (`client/INSIGHTS.md`, 2026-08-03.)
- **There is no `@testing-library/user-event`** in this package. Drive interactions with `fireEvent` from `@testing-library/react`. (`client/INSIGHTS.md`, 2026-07-29.)
- **User-facing strings go through `client/messages/en/blast.json`**, never hardcoded in JSX.
- **Every symbol/caller link stays SHA-pinned** via the existing `callerHref` helper, and renders as plain text — never a dead link — when `repoFullName` is `null`.
- **Ask the user before running `git commit`.** The commit steps below are part of the plan, but this project's practice is explicit approval first.

## File Structure

Everything lives under
`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/`, referred to below as **`<OVERVIEW>`**.

| File | Responsibility |
|---|---|
| `<OVERVIEW>/OverviewTab.tsx` | **Modify** — wrap Intent + Blast in a responsive two-column grid |
| `<OVERVIEW>/styles.ts` | **Modify** — add the `grid` style |
| `<OVERVIEW>/_components/BlastCard/BlastCard.tsx` | **Modify** — status branching, dialog open state, composition only |
| `<OVERVIEW>/_components/BlastCard/BlastCard.test.tsx` | **Modify** — dialog replaces the toggle; collapse behaviour |
| `<OVERVIEW>/_components/BlastCard/constants.ts` | **Create** — `FUNCTION_KINDS` |
| `<OVERVIEW>/_components/BlastCard/styles.ts` | **Modify** — drop tree/chip/toggle styles that moved to children |
| `<OVERVIEW>/_components/BlastCard/helpers.ts` | Unchanged — `callerHref` |
| `<OVERVIEW>/_components/BlastCard/_components/CounterRow/` | **Create** — four icon counters + Graph button |
| `<OVERVIEW>/_components/BlastCard/_components/SymbolRow/` | **Create** — one collapsible symbol |
| `<OVERVIEW>/_components/BlastCard/_components/BlastGraphDialog/` | **Create** — `Modal` + legend, wraps `BlastGraph` |
| `<OVERVIEW>/_components/BlastCard/_components/BlastGraph/helpers.ts` | **Rewrite** — force layout |
| `<OVERVIEW>/_components/BlastCard/_components/BlastGraph/constants.ts` | **Rewrite** — force + canvas constants |
| `<OVERVIEW>/_components/BlastCard/_components/BlastGraph/BlastGraph.tsx` | **Modify** — straight-line edges, positioned nodes |
| `<OVERVIEW>/_components/BlastCard/_components/BlastGraph/styles.ts` | **Modify** — drop the scroller, size to the dialog |
| `<OVERVIEW>/_components/BlastCard/_components/BlastGraph/BlastGraph.test.tsx` | **Rewrite** — invariants, not coordinates |
| `client/messages/en/blast.json` | **Modify** — `viewGraph`, `graph.title`, `graph.legend.*`, `symbolKind` |
| `client/specs/blast-radius-card.md` | **Create** — the screen's behaviour spec |

Task order is bottom-up: leaf components and their tests first, assembly last, so every task ends green.

---

### Task 1: CounterRow

The counter row: four icon counters, `Graph` button pinned right.

**Files:**
- Create: `<OVERVIEW>/_components/BlastCard/_components/CounterRow/CounterRow.tsx`
- Create: `<OVERVIEW>/_components/BlastCard/_components/CounterRow/styles.ts`
- Create: `<OVERVIEW>/_components/BlastCard/_components/CounterRow/index.ts`
- Test: `<OVERVIEW>/_components/BlastCard/_components/CounterRow/CounterRow.test.tsx`
- Modify: `client/messages/en/blast.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  interface CounterRowProps {
    symbols: number;
    callers: number;
    endpoints: number;
    crons: number;
    /** `null` hides the button entirely — there is no map to draw. */
    onOpenGraph: (() => void) | null;
  }
  export function CounterRow(props: CounterRowProps): React.ReactElement;
  ```

- [ ] **Step 1: Add the message key**

In `client/messages/en/blast.json`, add `"viewGraph": "Graph"` as a sibling of `"retry"`. Leave `stat.*` exactly as it is — the counter labels do not change.

- [ ] **Step 2: Write the failing test**

Create `CounterRow.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../../../messages/en/blast.json";
import { CounterRow } from "./CounterRow";

afterEach(cleanup);

function renderRow(props: Partial<React.ComponentProps<typeof CounterRow>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <CounterRow symbols={2} callers={14} endpoints={3} crons={1} onOpenGraph={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("CounterRow", () => {
  it("reports all four counters", () => {
    renderRow();
    const counter = (label: string) => screen.getByText(label).parentElement;
    expect(counter("symbols")).toHaveTextContent("2symbols");
    expect(counter("callers")).toHaveTextContent("14callers");
    expect(counter("endpoints")).toHaveTextContent("3endpoints");
    expect(counter("cron/jobs")).toHaveTextContent("1cron/jobs");
  });

  it("renders a zero rather than hiding the counter", () => {
    // Under `status: ok`, "0 endpoints" is a measurement. Hiding it would make
    // "nothing there" look like "we could not see", which is what the status
    // enum exists to distinguish.
    renderRow({ endpoints: 0, crons: 0 });
    expect(screen.getByText("endpoints").parentElement).toHaveTextContent("0endpoints");
    expect(screen.getByText("cron/jobs").parentElement).toHaveTextContent("0cron/jobs");
  });

  it("opens the graph on click", () => {
    const onOpenGraph = vi.fn();
    renderRow({ onOpenGraph });
    fireEvent.click(screen.getByRole("button", { name: /^graph$/i }));
    expect(onOpenGraph).toHaveBeenCalledTimes(1);
  });

  it("renders no Graph button when there is no map to draw", () => {
    renderRow({ onOpenGraph: null });
    expect(screen.queryByRole("button", { name: /^graph$/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard/_components/CounterRow
```

Expected: FAIL — `Failed to resolve import "./CounterRow"`.

- [ ] **Step 4: Write `styles.ts`**

```ts
import type { CSSProperties } from "react";

export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 18,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  /** Flex, not inline text: preflight sets `display: block` on every svg, so an
      icon dropped in as an inline sibling takes a line to itself. */
  counter: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  icon: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  value: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginRight: 6,
  } satisfies CSSProperties,
  /** Pushes the button to the row's far edge, as the comp draws it. */
  spacer: {
    marginLeft: "auto",
  } satisfies CSSProperties,
} as const;
```

- [ ] **Step 5: Write `CounterRow.tsx`**

```tsx
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Button, type IconName } from "@devdigest/ui";
import { s } from "./styles";

interface CounterRowProps {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
  /** `null` hides the button entirely — there is no map to draw. */
  onOpenGraph: (() => void) | null;
}

/**
 * The card's header line: what the map contains, and the way into the graph.
 *
 * Every counter renders including zeros. Under `status: ok` a zero is a real
 * measurement; `partial` and `degraded` are what say "we could not see", and
 * suppressing the zero would collapse that distinction.
 */
export function CounterRow({ symbols, callers, endpoints, crons, onOpenGraph }: CounterRowProps) {
  const t = useTranslations("blast");

  const counters: Array<{ icon: IconName; value: number; label: string }> = [
    { icon: "Code", value: symbols, label: t("stat.symbols") },
    { icon: "CornerDownRight", value: callers, label: t("stat.callers") },
    { icon: "Globe", value: endpoints, label: t("stat.endpoints") },
    { icon: "Clock", value: crons, label: t("stat.crons") },
  ];

  return (
    <div style={s.row}>
      {counters.map(({ icon, value, label }) => {
        const I = Icon[icon];
        return (
          <span key={label} style={s.counter}>
            <I size={13} style={s.icon} />
            <span style={s.value}>{value}</span>
            <span>{label}</span>
          </span>
        );
      })}
      {onOpenGraph && (
        <span style={s.spacer}>
          <Button size="sm" kind="tertiary" icon="Workflow" onClick={onOpenGraph}>
            {t("viewGraph")}
          </Button>
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Write `index.ts`**

```ts
export { CounterRow } from "./CounterRow";
```

- [ ] **Step 7: Run the test and watch it pass**

```bash
cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard/_components/CounterRow
```

Expected: PASS, 4 tests.

- [ ] **Step 8: Commit** (ask the user first)

```bash
git add client/src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard/_components/CounterRow client/messages/en/blast.json
git commit -m "feat(client): blast counter row with icons and a graph action

The comp puts the four counters and the way into the graph on one line.
Zeros still render: under status ok a zero is a measurement, and hiding it
would read as 'we could not see'."
```

---

### Task 2: SymbolRow

One collapsible symbol: header button, declaration row, callers, chips.

**Files:**
- Create: `<OVERVIEW>/_components/BlastCard/constants.ts`
- Create: `<OVERVIEW>/_components/BlastCard/_components/SymbolRow/SymbolRow.tsx`
- Create: `<OVERVIEW>/_components/BlastCard/_components/SymbolRow/styles.ts`
- Create: `<OVERVIEW>/_components/BlastCard/_components/SymbolRow/index.ts`
- Test: `<OVERVIEW>/_components/BlastCard/_components/SymbolRow/SymbolRow.test.tsx`
- Modify: `client/messages/en/blast.json`

**Interfaces:**
- Consumes: `callerHref` from `<OVERVIEW>/_components/BlastCard/helpers.ts` —
  `callerHref(repoFullName: string | null, headSha: string, file: string, line: number | null): string | null`
- Produces:
  ```ts
  interface SymbolRowProps {
    sym: BlastSymbolC;
    headSha: string;
    repoFullName: string | null;
    /** The comp opens the first symbol and leaves the rest closed. */
    defaultOpen: boolean;
  }
  export function SymbolRow(props: SymbolRowProps): React.ReactElement;
  ```

**No message change in this task.** `declaredAt` and `callerCount` already exist in `blast.json` and get their first use here. The `kind` string is not translated — it comes from the indexer (`class`, `enum`, `function`, `interface`, `method`, `type`) and renders verbatim as a muted tag, exactly as the current card renders it.

- [ ] **Step 1: Write `constants.ts`**

```ts
/**
 * The kinds whose names read as callable, so `rateLimit` renders `rateLimit()`.
 * The indexer emits exactly six kinds (`server/src/adapters/codeindex/extract.ts`):
 * class, enum, function, interface, method, type. Appending `()` to the other
 * four would draw an interface as something you can call.
 */
export const FUNCTION_KINDS = new Set(["function", "method"]);
```

- [ ] **Step 2: Write the failing test**

Create `SymbolRow.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastSymbolC } from "@devdigest/shared";
import messages from "../../../../../../../../../../../messages/en/blast.json";
import { SymbolRow } from "./SymbolRow";

const HEAD = "a1b2c3d4e5f6";
const REPO = "acme/payments-api";

const FN: BlastSymbolC = {
  name: "rateLimit",
  kind: "function",
  file: "src/middleware/ratelimit.ts",
  line: 12,
  callers: [
    { file: "src/api/public/index.ts", line: 23, symbol: "publicRouter", rank: 0.92 },
    { file: "src/api/public/webhooks.ts", line: 45, symbol: "handleWebhook", rank: 0.71 },
  ],
  endpoints: ["GET /api/public/items"],
  crons: ["job:reset-rate-buckets"],
};

const IFACE: BlastSymbolC = {
  name: "TicketStreamProps",
  kind: "interface",
  file: "app/_components/TicketStream.tsx",
  line: 4,
  callers: [],
  endpoints: [],
  crons: [],
};

afterEach(cleanup);

function renderRow(props: Partial<React.ComponentProps<typeof SymbolRow>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <SymbolRow sym={FN} headSha={HEAD} repoFullName={REPO} defaultOpen {...props} />
    </NextIntlClientProvider>,
  );
}

describe("SymbolRow — header", () => {
  it("renders a function kind as callable and reports its caller count", () => {
    renderRow();
    const header = screen.getByRole("button", { name: /rateLimit/ });
    expect(header).toHaveTextContent("rateLimit()");
    expect(header).toHaveTextContent("2 callers");
  });

  it("never draws a non-function kind as callable, and keeps the kind visible", () => {
    renderRow({ sym: IFACE });
    const header = screen.getByRole("button", { name: /TicketStreamProps/ });
    expect(header).toHaveTextContent("TicketStreamProps");
    expect(header).not.toHaveTextContent("TicketStreamProps()");
    expect(header).toHaveTextContent("interface");
  });
});

describe("SymbolRow — collapse", () => {
  it("starts closed when defaultOpen is false, hiding the body entirely", () => {
    renderRow({ defaultOpen: false });
    const header = screen.getByRole("button", { name: /rateLimit/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("src/api/public/index.ts:23")).not.toBeInTheDocument();
  });

  it("expands on click and announces it", () => {
    renderRow({ defaultOpen: false });
    fireEvent.click(screen.getByRole("button", { name: /rateLimit/ }));
    expect(screen.getByRole("button", { name: /rateLimit/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
  });

  it("collapses again on a second click", () => {
    renderRow({ defaultOpen: true });
    fireEvent.click(screen.getByRole("button", { name: /rateLimit/ }));
    expect(screen.queryByText("src/api/public/index.ts:23")).not.toBeInTheDocument();
  });
});

describe("SymbolRow — body", () => {
  it("keeps the declaration link the comp drops", () => {
    renderRow();
    expect(screen.getByText(/declared at/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "src/middleware/ratelimit.ts:12" });
    expect(link).toHaveAttribute(
      "href",
      `https://github.com/${REPO}/blob/${HEAD}/src/middleware/ratelimit.ts#L12`,
    );
  });

  it("SHA-pins every caller link", () => {
    renderRow();
    const link = screen.getByRole("link", { name: "src/api/public/index.ts:23" });
    expect(link).toHaveAttribute(
      "href",
      `https://github.com/${REPO}/blob/${HEAD}/src/api/public/index.ts#L23`,
    );
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders rows as plain text — never a dead link — when the repo is unknown", () => {
    renderRow({ repoFullName: null });
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders this symbol's own endpoint and cron chips", () => {
    renderRow();
    expect(screen.getByText("GET /api/public/items")).toBeInTheDocument();
    expect(screen.getByText("job:reset-rate-buckets")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard/_components/SymbolRow
```

Expected: FAIL — `Failed to resolve import "./SymbolRow"`.

- [ ] **Step 4: Write `styles.ts`**

```ts
import type { CSSProperties } from "react";

export const s = {
  block: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingBottom: 12,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  /** A real <button>, restyled flat — the whole header is the hit area. */
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: 0,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  chevron: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  codeIcon: {
    color: "var(--accent)",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: {
    fontWeight: 600,
  } satisfies CSSProperties,
  kind: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /** Caller count sits at the far edge, as the comp draws it. */
  count: {
    marginLeft: "auto",
    fontSize: 11,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingLeft: 22,
  } satisfies CSSProperties,
  declared: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  callerList: {
    margin: 0,
    padding: 0,
    // Preflight strips ul markers and this list wants none — the ↳ glyph is
    // what nests each row under its symbol.
    listStyleType: "none",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  branch: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  callerSymbol: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  } satisfies CSSProperties,
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    borderRadius: 5,
    padding: "2px 8px",
    fontSize: 11,
    color: "var(--info)",
    background: "var(--info-bg)",
  } satisfies CSSProperties,
  cronChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    borderRadius: 5,
    padding: "2px 8px",
    fontSize: 11,
    color: "var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
} as const;
```

- [ ] **Step 5: Write `SymbolRow.tsx`**

```tsx
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { BlastSymbolC } from "@devdigest/shared";
import { callerHref } from "../../helpers";
import { FUNCTION_KINDS } from "../../constants";
import { s } from "./styles";

interface SymbolRowProps {
  sym: BlastSymbolC;
  headSha: string;
  repoFullName: string | null;
  /** The comp opens the first symbol and leaves the rest closed. */
  defaultOpen: boolean;
}

/** One `file:line`, linked when we know where to point and plain text when not. */
function FileRef({ href, file, line }: { href: string | null; file: string; line: number | null }) {
  const label = line == null ? file : `${file}:${line}`;
  // A plain `<a className="mono">`, not `MonoLink` — that primitive hardcodes
  // `fontSize: 13` inline, which no wrapper can override, and these rows are
  // 12 (INSIGHTS 2026-08-02).
  return href ? (
    <a className="mono" href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  ) : (
    <span className="mono">{label}</span>
  );
}

/**
 * A changed symbol and everything that reaches it, collapsed behind its own
 * header. The header is a real `<button aria-expanded>` controlling the body by
 * id, so the disclosure is operable by keyboard and announced.
 *
 * The declaration `file:line` lives in the body rather than the header: the comp
 * drops it, but it is the only link to the changed symbol itself and losing it
 * would be a regression.
 */
export function SymbolRow({ sym, headSha, repoFullName, defaultOpen }: SymbolRowProps) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(defaultOpen);

  const bodyId = `blast-sym-${sym.file}-${sym.name}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const callable = FUNCTION_KINDS.has(sym.kind);
  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;

  return (
    <div style={s.block}>
      <button
        type="button"
        style={s.header}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <Chevron size={14} style={s.chevron} />
        <Icon.Code size={13} style={s.codeIcon} />
        <span className="mono" style={s.name}>
          {callable ? `${sym.name}()` : sym.name}
        </span>
        {/* The comp drops the kind for functions; for a class or interface it is
            the only thing saying the name is not callable, so it stays. */}
        {!callable && <span style={s.kind}>{sym.kind}</span>}
        <span style={s.count}>{t("callerCount", { count: sym.callers.length })}</span>
      </button>

      {open && (
        <div id={bodyId} style={s.body}>
          <div style={s.declared}>
            <span>{t("declaredAt")}</span>
            <FileRef
              href={callerHref(repoFullName, headSha, sym.file, sym.line)}
              file={sym.file}
              line={sym.line}
            />
          </div>

          {sym.callers.length > 0 && (
            <ul style={s.callerList}>
              {sym.callers.map((c) => (
                <li key={`${c.file}:${c.line}:${c.symbol}`} style={s.callerRow}>
                  <Icon.CornerDownRight size={12} style={s.branch} />
                  <FileRef
                    href={callerHref(repoFullName, headSha, c.file, c.line)}
                    file={c.file}
                    line={c.line}
                  />
                  <span style={s.callerSymbol}>{c.symbol}</span>
                </li>
              ))}
            </ul>
          )}

          {(sym.endpoints.length > 0 || sym.crons.length > 0) && (
            <div style={s.chips}>
              {/* This symbol's own attribution, not the response's BFS-widened
                  union — the union is what the counters report. */}
              {sym.endpoints.map((e) => (
                <span key={e} style={s.chip}>
                  <Icon.Globe size={11} />
                  {e}
                </span>
              ))}
              {sym.crons.map((c) => (
                <span key={c} style={s.cronChip}>
                  <Icon.Clock size={11} />
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Write `index.ts`**

```ts
export { SymbolRow } from "./SymbolRow";
```

- [ ] **Step 7: Run the test and watch it pass**

```bash
cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard/_components/SymbolRow
```

Expected: PASS, 9 tests.

- [ ] **Step 8: Commit** (ask the user first)

```bash
git add client/src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard
git commit -m "feat(client): collapsible blast symbol rows

Only function and method render as name(); an interface drawn as callable
would misstate what it is. The declaration file:line the comp drops moves
into the body rather than being lost."
```

---

### Task 3: Force layout

Swap the layered `d3-scale` geometry for a `d3-force` simulation run to completion synchronously.

**Files:**
- Rewrite: `<OVERVIEW>/_components/BlastCard/_components/BlastGraph/helpers.ts`
- Rewrite: `<OVERVIEW>/_components/BlastCard/_components/BlastGraph/constants.ts`
- Test: `<OVERVIEW>/_components/BlastCard/_components/BlastGraph/BlastGraph.test.tsx` (layout half; the component half is rewritten in Task 4)

**Interfaces:**
- Consumes: `callerHref` (via the injected `href` callback), `BlastRadiusResponse` from `@devdigest/shared`.
- Produces:
  ```ts
  export type GraphNodeKind = "symbol" | "caller" | "endpoint" | "cron";
  export interface GraphNode {
    id: string;
    kind: GraphNodeKind;
    label: string;
    sub?: string;
    href: string | null;
    x: number;
    y: number;
  }
  export interface GraphEdge { id: string; x1: number; y1: number; x2: number; y2: number }
  export interface BlastGraphLayout { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number }
  export function layoutBlastGraph(
    data: BlastRadiusResponse,
    href: (file: string, line: number | null) => string | null,
    width?: number,
    height?: number,
  ): BlastGraphLayout;
  ```

- [ ] **Step 1: Write the failing layout test**

Replace the `describe("layoutBlastGraph", …)` block in `BlastGraph.test.tsx` with this. Keep the file's existing imports, `HEAD`, `REPO`, `MAP`, `href` and `afterEach(cleanup)` exactly as they are; leave the `describe("BlastGraph", …)` block alone for now (Task 4 rewrites it).

```tsx
import { GRAPH_WIDTH, GRAPH_HEIGHT, NODE_MARGIN } from "./constants";

describe("layoutBlastGraph", () => {
  it("is deterministic — same input, identical geometry", () => {
    // The simulation is seeded from a fixed spiral and run to completion, so
    // two renders of one response must produce the same picture.
    expect(layoutBlastGraph(MAP, href)).toEqual(layoutBlastGraph(MAP, href));
  });

  it("places every node inside the canvas", () => {
    const { nodes } = layoutBlastGraph(MAP, href);
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.x).toBeGreaterThanOrEqual(NODE_MARGIN);
      expect(n.x).toBeLessThanOrEqual(GRAPH_WIDTH - NODE_MARGIN);
      expect(n.y).toBeGreaterThanOrEqual(NODE_MARGIN);
      expect(n.y).toBeLessThanOrEqual(GRAPH_HEIGHT - NODE_MARGIN);
    }
  });

  it("emits one node per symbol, caller and fact, deduped", () => {
    const { nodes } = layoutBlastGraph(MAP, href);
    const byKind = (k: string) => nodes.filter((n) => n.kind === k).length;
    expect(byKind("symbol")).toBe(1);
    expect(byKind("caller")).toBe(3);
    expect(byKind("endpoint")).toBe(1);
    expect(byKind("cron")).toBe(1);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
  });

  it("emits one edge per symbol→caller and caller→fact pair, deduped", () => {
    const { edges } = layoutBlastGraph(MAP, href);
    // 3 symbol→caller, plus 3 callers × (1 endpoint + 1 cron).
    expect(edges).toHaveLength(9);
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
    for (const e of edges) {
      expect(Number.isFinite(e.x1)).toBe(true);
      expect(Number.isFinite(e.y2)).toBe(true);
    }
  });

  it("draws no node for a fact the BFS widened past every caller", () => {
    // The response's top-level unions are a SUPERSET of the per-symbol
    // attributions. Drawing the extra one would assert a path the data does
    // not claim, so it stays in the counters and out of the graph.
    const widened: BlastRadiusResponse = {
      ...MAP,
      endpoints: [...MAP.endpoints, "GET /api/public/health"],
    };
    const { nodes } = layoutBlastGraph(widened, href);
    expect(nodes.some((n) => n.label === "GET /api/public/health")).toBe(false);
  });

  it("builds node hrefs with the same helper the tree uses", () => {
    const { nodes } = layoutBlastGraph(MAP, href);
    const caller = nodes.find((n) => n.label === "src/api/public/index.ts")!;
    expect(caller.href).toBe(callerHref(REPO, HEAD, "src/api/public/index.ts", 23));
    // Endpoint and cron nodes have no file behind them, so they never link.
    for (const n of nodes.filter((x) => x.kind === "endpoint" || x.kind === "cron")) {
      expect(n.href).toBeNull();
    }
  });

  it("drops every href when the repo is unknown", () => {
    const { nodes } = layoutBlastGraph(MAP, () => null);
    expect(nodes.every((n) => n.href === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard/_components/BlastGraph
```

Expected: FAIL — `GRAPH_HEIGHT` and `NODE_MARGIN` are not exported from `./constants`.

- [ ] **Step 3: Write `constants.ts`**

Replace the file entirely:

```ts
/** The drawing box, sized for the dialog rather than a card column. */
export const GRAPH_WIDTH = 1120;
export const GRAPH_HEIGHT = 620;

/** Keeps a node's label inside the viewBox after the simulation settles. */
export const NODE_MARGIN = 60;

/** Force parameters. Tuned so a ~20-node map fills the box without clumping. */
export const LINK_DISTANCE = 110;
export const LINK_STRENGTH = 0.55;
export const CHARGE_STRENGTH = -340;
export const COLLIDE_RADIUS = 48;

/** Ticks to run before reading positions. d3's own default alpha decay settles
    in ~300; running them synchronously is what makes the layout reproducible. */
export const SIMULATION_TICKS = 300;

/** Label truncation — a full path would overrun its node. */
export const MAX_LABEL_CHARS = 30;
```

- [ ] **Step 4: Write `helpers.ts`**

Replace the file entirely:

```ts
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { BlastRadiusResponse } from "@devdigest/shared";
import {
  CHARGE_STRENGTH,
  COLLIDE_RADIUS,
  GRAPH_HEIGHT,
  GRAPH_WIDTH,
  LINK_DISTANCE,
  LINK_STRENGTH,
  MAX_LABEL_CHARS,
  NODE_MARGIN,
  SIMULATION_TICKS,
} from "./constants";

/**
 * Layout for the blast graph. **d3 does the maths, React owns the DOM** — this
 * module returns plain data and never touches a node, so there is no
 * d3-selection anywhere and no enter/exit lifecycle competing with React's.
 *
 * The simulation is run to completion synchronously rather than animated: the
 * nodes are seeded on a fixed spiral, ticked a fixed number of times, and read
 * once. Two renders of the same response therefore produce identical geometry,
 * and the layout is exercisable in jsdom with no rAF loop.
 */

export type GraphNodeKind = "symbol" | "caller" | "endpoint" | "cron";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  sub?: string;
  /** `null` when the repo is unknown, or for endpoint/cron nodes (never link). */
  href: string | null;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BlastGraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

/** What the simulation mutates: our fields plus d3's x/y/vx/vy. */
interface SimNode extends SimulationNodeDatum {
  id: string;
  kind: GraphNodeKind;
  label: string;
  sub?: string;
  href: string | null;
}

type SimLink = SimulationLinkDatum<SimNode> & { id: string };

/** A long path would overrun its node; the tail is the identifying part. */
function truncate(label: string): string {
  if (label.length <= MAX_LABEL_CHARS) return label;
  return `…${label.slice(label.length - MAX_LABEL_CHARS + 1)}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Rounded so a float's last bit can never make two equal layouts compare unequal. */
function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * The graph the data asserts, before any geometry. Endpoints and crons hang off
 * the CALLER that exposes them, so an edge always means "reachable through that
 * caller"; facts the BFS widened past every individual caller stay out entirely,
 * because drawing them would assert a path the response does not claim.
 */
function buildGraph(
  data: BlastRadiusResponse,
  href: (file: string, line: number | null) => string | null,
): { nodes: SimNode[]; links: SimLink[] } {
  const nodes: SimNode[] = [];
  const links: SimLink[] = [];
  const seenNode = new Set<string>();
  const seenLink = new Set<string>();

  const addNode = (n: SimNode) => {
    if (seenNode.has(n.id)) return;
    seenNode.add(n.id);
    nodes.push(n);
  };
  const addLink = (source: string, target: string) => {
    const id = `${source}->${target}`;
    if (seenLink.has(id)) return;
    seenLink.add(id);
    links.push({ id, source, target });
  };

  for (const sym of data.changed_symbols) {
    const symId = `sym:${sym.file}:${sym.name}`;
    addNode({
      id: symId,
      kind: "symbol",
      label: sym.name,
      sub: sym.kind,
      href: href(sym.file, sym.line),
    });

    for (const c of sym.callers) {
      const callerId = `call:${c.file}:${c.line}`;
      addNode({
        id: callerId,
        kind: "caller",
        label: truncate(c.file),
        sub: `${c.symbol}:${c.line}`,
        href: href(c.file, c.line),
      });
      addLink(symId, callerId);

      for (const e of sym.endpoints) {
        const id = `ep:${e}`;
        addNode({ id, kind: "endpoint", label: e, href: null });
        addLink(callerId, id);
      }
      for (const cr of sym.crons) {
        const id = `cron:${cr}`;
        addNode({ id, kind: "cron", label: cr, href: null });
        addLink(callerId, id);
      }
    }
  }

  return { nodes, links };
}

/**
 * Seed positions on a golden-angle spiral around the centre. d3 would seed its
 * own phyllotaxis, but doing it here guarantees no two nodes ever start
 * coincident — the one place d3's forces reach for `Math.random()` (`jiggle`).
 */
function seed(nodes: SimNode[], width: number, height: number): void {
  const radius = Math.min(width, height) / 2 - NODE_MARGIN;
  nodes.forEach((n, i) => {
    const angle = i * 2.399963229728653; // golden angle, radians
    const r = radius * Math.sqrt((i + 1) / nodes.length);
    n.x = width / 2 + r * Math.cos(angle);
    n.y = height / 2 + r * Math.sin(angle);
  });
}

/** After `forceLink` runs, `source`/`target` are node objects, not ids. */
function endpointOf(v: SimLink["source"], nodes: Map<string, SimNode>): SimNode | undefined {
  return typeof v === "object" ? (v as SimNode) : nodes.get(String(v));
}

export function layoutBlastGraph(
  data: BlastRadiusResponse,
  href: (file: string, line: number | null) => string | null,
  width: number = GRAPH_WIDTH,
  height: number = GRAPH_HEIGHT,
): BlastGraphLayout {
  const { nodes: simNodes, links } = buildGraph(data, href);
  if (simNodes.length === 0) return { nodes: [], edges: [], width, height };

  seed(simNodes, width, height);

  const simulation = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(LINK_DISTANCE)
        .strength(LINK_STRENGTH),
    )
    .force("charge", forceManyBody().strength(CHARGE_STRENGTH))
    .force("center", forceCenter(width / 2, height / 2))
    .force("collide", forceCollide(COLLIDE_RADIUS))
    .stop();

  simulation.tick(SIMULATION_TICKS);

  const byId = new Map(simNodes.map((n) => [n.id, n]));
  for (const n of simNodes) {
    n.x = clamp(round(n.x ?? width / 2), NODE_MARGIN, width - NODE_MARGIN);
    n.y = clamp(round(n.y ?? height / 2), NODE_MARGIN, height - NODE_MARGIN);
  }

  const nodes: GraphNode[] = simNodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.label,
    ...(n.sub === undefined ? {} : { sub: n.sub }),
    href: n.href,
    x: n.x ?? 0,
    y: n.y ?? 0,
  }));

  const edges: GraphEdge[] = [];
  for (const l of links) {
    const a = endpointOf(l.source, byId);
    const b = endpointOf(l.target, byId);
    if (!a || !b) continue;
    edges.push({ id: l.id, x1: a.x ?? 0, y1: a.y ?? 0, x2: b.x ?? 0, y2: b.y ?? 0 });
  }

  return { nodes, edges, width, height };
}
```

- [ ] **Step 5: Run the layout tests**

```bash
cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard/_components/BlastGraph -t "layoutBlastGraph"
```

Expected: PASS, 7 tests. The `describe("BlastGraph", …)` component tests still fail to compile against the new shape — Task 4 fixes them, so do not commit yet.

---

### Task 4: BlastGraph renders the force layout

**Files:**
- Modify: `<OVERVIEW>/_components/BlastCard/_components/BlastGraph/BlastGraph.tsx`
- Modify: `<OVERVIEW>/_components/BlastCard/_components/BlastGraph/styles.ts`
- Test: `<OVERVIEW>/_components/BlastCard/_components/BlastGraph/BlastGraph.test.tsx` (component half)

**Interfaces:**
- Consumes: `layoutBlastGraph`, `GraphNode`, `GraphEdge`, `GRAPH_WIDTH`, `GRAPH_HEIGHT` from Task 3.
- Produces: `BlastGraph` keeps its current props — `{ data: BlastRadiusResponse; headSha: string; repoFullName: string | null }`.

- [ ] **Step 1: Rewrite the component test**

Replace the `describe("BlastGraph", …)` block with:

```tsx
describe("BlastGraph", () => {
  it("renders an svg labelled for assistive tech", () => {
    renderGraph();
    const svg = screen.getByRole("img", { name: "Blast radius graph" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });

  it("draws one line per edge", () => {
    const { container } = renderGraph();
    expect(container.querySelectorAll("line")).toHaveLength(9);
  });

  it("links caller and symbol nodes, never endpoint or cron nodes", () => {
    renderGraph();
    const labels = screen.getAllByRole("link").map((l) => l.textContent ?? "");
    expect(labels.some((x) => x.includes("src/api/public/index.ts"))).toBe(true);
    expect(labels.some((x) => x.includes("GET /api/public/items"))).toBe(false);
    expect(labels.some((x) => x.includes("job:reset-rate-buckets"))).toBe(false);
  });

  it("renders no link at all when the repo is unknown", () => {
    renderGraph(null);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // The nodes are still drawn — losing the link must not lose the diagram.
    expect(screen.getByText("src/api/public/index.ts")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard/_components/BlastGraph -t "BlastGraph"
```

Expected: FAIL — no `<line>` elements; the component still renders `<path>` from the removed layered layout.

- [ ] **Step 3: Write `styles.ts`**

Replace the file entirely:

```ts
import type { CSSProperties } from "react";

export const s = {
  /** The svg scales to the dialog's width; the viewBox fixes the coordinates. */
  svg: {
    width: "100%",
    height: "auto",
    display: "block",
  } satisfies CSSProperties,
  edge: {
    stroke: "var(--border-strong)",
    strokeWidth: 1,
  } satisfies CSSProperties,
} as const;

/** Node dot, tinted per kind so the layers read apart at a glance. The legend
    in the dialog names exactly these four colours. */
export const nodeDot: Record<string, CSSProperties> = {
  symbol: { fill: "var(--accent)" },
  caller: { fill: "var(--text-muted)" },
  endpoint: { fill: "var(--ok)" },
  cron: { fill: "var(--warn)" },
};

export const label: CSSProperties = {
  fontSize: 11,
  fill: "var(--text-secondary)",
};

export const labelPrimary: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  fill: "var(--text-primary)",
};

export const sublabel: CSSProperties = {
  fontSize: 9,
  fill: "var(--text-muted)",
};
```

- [ ] **Step 4: Write `BlastGraph.tsx`**

Replace the file entirely:

```tsx
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { callerHref } from "../../helpers";
import { layoutBlastGraph, type GraphNode } from "./helpers";
import { GRAPH_HEIGHT, GRAPH_WIDTH } from "./constants";
import { s, label, labelPrimary, nodeDot, sublabel } from "./styles";

interface BlastGraphProps {
  data: BlastRadiusResponse;
  headSha: string;
  repoFullName: string | null;
}

/**
 * The same response the tree renders, drawn as a force-directed node-link
 * diagram: changed symbols, their callers, and what those callers expose.
 *
 * React renders every element here; d3 only computed the numbers in
 * `helpers.ts`, synchronously and once. The tree stays the accessible-first
 * view, so this carries no information the tree lacks.
 */
export function BlastGraph({ data, headSha, repoFullName }: BlastGraphProps) {
  const t = useTranslations("blast");

  const { nodes, edges } = React.useMemo(
    () =>
      layoutBlastGraph(data, (file, line) => callerHref(repoFullName, headSha, file, line)),
    [data, headSha, repoFullName],
  );

  if (nodes.length === 0) {
    return <p style={{ margin: 0, fontSize: 13 }}>{t("graph.empty")}</p>;
  }

  return (
    <svg
      role="img"
      aria-label={t("graph.ariaLabel")}
      viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
      style={s.svg}
    >
      <g>
        {edges.map((e) => (
          <line key={e.id} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} style={s.edge} />
        ))}
      </g>
      <g>
        {nodes.map((n) => (
          <NodeMark key={n.id} node={n} />
        ))}
      </g>
    </svg>
  );
}

function NodeMark({ node }: { node: GraphNode }) {
  const body = (
    <>
      <circle cx={node.x} cy={node.y} r={node.kind === "symbol" ? 7 : 5} style={nodeDot[node.kind]} />
      <text
        x={node.x}
        y={node.y + 20}
        textAnchor="middle"
        style={node.kind === "symbol" ? labelPrimary : label}
      >
        {node.label}
      </text>
      {node.sub && (
        <text x={node.x} y={node.y + 32} textAnchor="middle" style={sublabel}>
          {node.sub}
        </text>
      )}
    </>
  );

  // Same rule as the tree: a node links only when we know where to point, so an
  // unknown repo yields plain text rather than a dead link. Endpoint and cron
  // nodes never link — there is no file behind them.
  return node.href ? (
    <a href={node.href} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  ) : (
    <g>{body}</g>
  );
}
```

- [ ] **Step 5: Run the whole BlastGraph suite**

```bash
cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard/_components/BlastGraph
```

Expected: PASS, 11 tests (7 layout + 4 component).

- [ ] **Step 6: Commit** (ask the user first)

```bash
git add client/src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard/_components/BlastGraph
git commit -m "feat(client): force-directed blast graph, sized for a dialog

The simulation is seeded on a fixed spiral and ticked to completion in one
synchronous pass, so the layout is reproducible and testable in jsdom with
no animation loop. d3-force resolves through the hoisted linker, as
d3-scale and d3-shape already did."
```

---

### Task 5: BlastGraphDialog

**Files:**
- Create: `<OVERVIEW>/_components/BlastCard/_components/BlastGraphDialog/BlastGraphDialog.tsx`
- Create: `<OVERVIEW>/_components/BlastCard/_components/BlastGraphDialog/constants.ts`
- Create: `<OVERVIEW>/_components/BlastCard/_components/BlastGraphDialog/styles.ts`
- Create: `<OVERVIEW>/_components/BlastCard/_components/BlastGraphDialog/index.ts`
- Test: `<OVERVIEW>/_components/BlastCard/_components/BlastGraphDialog/BlastGraphDialog.test.tsx`
- Modify: `client/messages/en/blast.json`

**Interfaces:**
- Consumes: `BlastGraph` from Task 4; `Modal` from `@devdigest/ui`.
- Produces:
  ```ts
  interface BlastGraphDialogProps {
    data: BlastRadiusResponse;
    headSha: string;
    repoFullName: string | null;
    onClose: () => void;
  }
  export function BlastGraphDialog(props: BlastGraphDialogProps): React.ReactElement;
  ```
  The dialog renders only when open — the parent mounts it conditionally rather than passing an `open` flag.

- [ ] **Step 1: Add the message keys**

In `client/messages/en/blast.json`, extend the existing `"graph"` object so it reads:

```json
  "graph": {
    "empty": "No downstream callers to graph.",
    "ariaLabel": "Blast radius graph",
    "title": "Blast radius",
    "subtitle": "Changed symbols, their callers, and what those callers expose.",
    "close": "Close",
    "legend": {
      "symbol": "Changed symbol",
      "caller": "Caller",
      "endpoint": "Endpoint",
      "cron": "Cron / job"
    }
  }
```

- [ ] **Step 2: Write the failing test**

```tsx
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import messages from "../../../../../../../../../../../messages/en/blast.json";
import { BlastGraphDialog } from "./BlastGraphDialog";

const HEAD = "a1b2c3d4e5f6";

const MAP: BlastRadiusResponse = {
  status: "ok",
  reason: null,
  head_sha: HEAD,
  changed_symbols: [
    {
      name: "rateLimit",
      kind: "function",
      file: "src/middleware/ratelimit.ts",
      line: 12,
      callers: [{ file: "src/api/public/index.ts", line: 23, symbol: "publicRouter", rank: 0.9 }],
      endpoints: ["GET /api/public/items"],
      crons: [],
    },
  ],
  endpoints: ["GET /api/public/items"],
  crons: [],
  summary: null,
};

afterEach(cleanup);

function renderDialog(onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastGraphDialog data={MAP} headSha={HEAD} repoFullName="acme/payments-api" onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return onClose;
}

describe("BlastGraphDialog", () => {
  it("renders the graph inside a modal dialog", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();
  });

  it("names every node colour in the legend", () => {
    renderDialog();
    expect(screen.getByText("Changed symbol")).toBeInTheDocument();
    expect(screen.getByText("Caller")).toBeInTheDocument();
    expect(screen.getByText("Endpoint")).toBeInTheDocument();
    expect(screen.getByText("Cron / job")).toBeInTheDocument();
  });

  it("closes on the close control", () => {
    const onClose = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard/_components/BlastGraphDialog
```

Expected: FAIL — `Failed to resolve import "./BlastGraphDialog"`.

- [ ] **Step 4: Write `styles.ts`**

```ts
import type { CSSProperties } from "react";

export const s = {
  /** The vendored Modal pads its header but gives the body ZERO padding, so the
      gutter has to come from here (INSIGHTS 2026-08-03). */
  body: {
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  legend: {
    display: "flex",
    flexWrap: "wrap",
    gap: 18,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 7,
  } satisfies CSSProperties,
  swatch: (color: string): CSSProperties => ({
    width: 9,
    height: 9,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  }),
} as const;
```

- [ ] **Step 5: Write `BlastGraphDialog.tsx`**

```tsx
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@devdigest/ui";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { BlastGraph } from "../BlastGraph";
import { DIALOG_WIDTH, LEGEND } from "./constants";
import { s } from "./styles";

interface BlastGraphDialogProps {
  data: BlastRadiusResponse;
  headSha: string;
  repoFullName: string | null;
  onClose: () => void;
}

/**
 * The graph, over the card rather than inside it. The card behind keeps showing
 * the tree, so there is no view state to hold and no URL parameter — which view
 * you are looking at is presentation, not a shareable location.
 */
export function BlastGraphDialog({ data, headSha, repoFullName, onClose }: BlastGraphDialogProps) {
  const t = useTranslations("blast");

  return (
    <Modal
      width={DIALOG_WIDTH}
      title={t("graph.title")}
      subtitle={t("graph.subtitle")}
      onClose={onClose}
    >
      <div style={s.body}>
        <BlastGraph data={data} headSha={headSha} repoFullName={repoFullName} />
        <div style={s.legend}>
          {LEGEND.map(({ key, color }) => (
            <span key={key} style={s.legendItem}>
              <span style={s.swatch(color)} />
              <span>{t(`graph.legend.${key}`)}</span>
            </span>
          ))}
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 6: Write `constants.ts`**

Create `<OVERVIEW>/_components/BlastCard/_components/BlastGraphDialog/constants.ts`:

```ts
/** Wide enough for the 1120-unit viewBox to render near 1:1. */
export const DIALOG_WIDTH = 1180;

/** The legend's four rows. The colours must stay in step with `nodeDot` in
    `../BlastGraph/styles.ts` — a legend that disagrees with the diagram is
    worse than no legend. */
export const LEGEND = [
  { key: "symbol", color: "var(--accent)" },
  { key: "caller", color: "var(--text-muted)" },
  { key: "endpoint", color: "var(--ok)" },
  { key: "cron", color: "var(--warn)" },
] as const;
```

- [ ] **Step 7: Write `index.ts`**

```ts
export { BlastGraphDialog } from "./BlastGraphDialog";
```

- [ ] **Step 8: Run the test and watch it pass**

```bash
cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard/_components/BlastGraphDialog
```

Expected: PASS, 3 tests.

- [ ] **Step 9: Commit** (ask the user first)

```bash
git add client/src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard/_components/BlastGraphDialog client/messages/en/blast.json
git commit -m "feat(client): open the blast graph in a dialog with a legend

A dialog is an action, not a view switch, so the card keeps rendering the
tree behind it and holds no view state."
```

---

### Task 6: Assemble the card

**Files:**
- Modify: `<OVERVIEW>/_components/BlastCard/BlastCard.tsx`
- Modify: `<OVERVIEW>/_components/BlastCard/styles.ts`
- Test: `<OVERVIEW>/_components/BlastCard/BlastCard.test.tsx`

**Interfaces:**
- Consumes: `CounterRow` (Task 1), `SymbolRow` (Task 2), `BlastGraphDialog` (Task 5).
- Produces: `BlastCard` keeps its props — `{ prId: string | null; headSha: string; repoFullName: string | null }`.

- [ ] **Step 1: Replace the toggle tests with dialog tests**

In `BlastCard.test.tsx`, delete the whole `describe("BlastCard — Tree | Graph toggle", …)` block and put this in its place. Leave every other describe block untouched — the data, states and Explain tests must keep passing unchanged, which is what proves the rebuild preserved behaviour.

```tsx
describe("BlastCard — graph dialog", () => {
  it("opens the graph over the card without a refetch, and closes again", async () => {
    const fetchMock = stubFetchWithExplain(OK_MAP, {});
    renderCard(card());

    await screen.findByText("rateLimit()");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const before = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /^graph$/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // The tree is still mounted behind the dialog — it was never a view switch.
    expect(screen.getByText("rateLimit()")).toBeInTheDocument();
    // Both surfaces render the SAME response — opening must cost no request.
    expect(fetchMock.mock.calls).toHaveLength(before);

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides the graph action entirely on a degraded map", async () => {
    stubFetch(200, {
      status: "degraded",
      reason: "no_data",
      head_sha: HEAD,
      changed_symbols: [],
      endpoints: [],
      crons: [],
      summary: null,
    });
    renderCard(card());

    await screen.findByText(/Index not usable/i);
    expect(screen.queryByRole("button", { name: /^graph$/i })).not.toBeInTheDocument();
  });

  it("hides the graph action when there are no symbols to draw", async () => {
    stubFetch(200, {
      status: "ok",
      reason: null,
      head_sha: HEAD,
      changed_symbols: [],
      endpoints: [],
      crons: [],
      summary: null,
    });
    renderCard(card());

    await screen.findByText(/No indexed symbols/i);
    expect(screen.queryByRole("button", { name: /^graph$/i })).not.toBeInTheDocument();
  });
});

describe("BlastCard — symbol disclosure", () => {
  it("opens the first symbol and leaves the rest closed", async () => {
    stubFetch(200, {
      ...OK_MAP,
      changed_symbols: [
        OK_MAP.changed_symbols[0],
        {
          name: "bucketKey",
          kind: "function",
          file: "src/middleware/bucket.ts",
          line: 4,
          callers: [{ file: "src/server.ts", line: 88, symbol: "boot", rank: 0.5 }],
          endpoints: [],
          crons: [],
        },
      ],
    });
    renderCard(card());

    await screen.findByText("rateLimit()");
    // First symbol's caller is visible, second symbol's is not.
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
    expect(screen.queryByText("src/server.ts:88")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /bucketKey/ }));
    expect(screen.getByText("src/server.ts:88")).toBeInTheDocument();
  });
});
```

Also update the two assertions in the existing blocks that named the bare symbol: in `"renders the symbol, its callers and its endpoint chip"` and `"partial still renders the tree, with a warning above it"`, change `screen.findByText("rateLimit")` / `getByText("rateLimit")` to `"rateLimit()"`, and in `"counts callers across symbols…"` change `await screen.findByText("rateLimit")` to `await screen.findByText("rateLimit()")`. The declaration path assertion in the first test — `getByText("src/middleware/ratelimit.ts:12")` — still holds, because the first symbol is open by default.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard/BlastCard.test.tsx
```

Expected: FAIL — no `dialog` role, and `rateLimit()` is not found.

- [ ] **Step 3: Trim `styles.ts`**

In `<OVERVIEW>/_components/BlastCard/styles.ts`, delete the keys that moved into children: `counters`, `counterValue`, `symbolBlock`, `symbolHeader`, `symbolName`, `symbolKind`, `callerList`, `callerRow`, `callerSymbol`, `chips`, `chip`, `cronChip`, `viewToggle`, and the exported `toggleButton` function. Keep `card`, `tree`, `warning`, `degraded`, `degradedTitle`, `degradedBody`, `emptyNote`, `summaryTitle`, `summary`, and change `tree` to:

```ts
  tree: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
```

- [ ] **Step 4: Rewrite `BlastCard.tsx`**

Replace the file entirely:

```tsx
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Skeleton } from "@devdigest/ui";
import { useBlastRadius, useBlastSummary } from "@/lib/hooks/blast";
import { ApiError } from "@/lib/api";
import { CounterRow } from "./_components/CounterRow";
import { SymbolRow } from "./_components/SymbolRow";
import { BlastGraphDialog } from "./_components/BlastGraphDialog";
import { s } from "./styles";

interface BlastCardProps {
  prId: string | null;
  /** The PR's current head — every link is pinned to it, so lines stay right. */
  headSha: string;
  /** `null` when the repo is unknown; rows then render as plain text. */
  repoFullName: string | null;
}

/**
 * What this PR's changes reach: the symbols it touched, who calls them, and the
 * endpoints and jobs downstream — all read from the index, so the card renders
 * without a model call.
 *
 * The states that matter are the ones that distinguish "nothing is there" from
 * "we cannot see": `degraded` renders an explanation and NO tree and NO
 * counters, because an empty tree beside a "0 callers" counter reads as an
 * all-clear.
 */
export function BlastCard({ prId, headSha, repoFullName }: BlastCardProps) {
  const t = useTranslations("blast");
  const { data, isLoading, isError, error, refetch, isFetching } = useBlastRadius(prId);
  const explain = useBlastSummary(prId);
  // Plain local state, no URL param: whether the graph is open is presentation,
  // not a shareable location.
  const [graphOpen, setGraphOpen] = React.useState(false);

  const explainError = explain.isError
    ? explain.error instanceof ApiError
      ? explain.error.message
      : t("explainError")
    : null;

  if (isLoading) {
    // Keeps the card's footprint so the page doesn't shift once data lands.
    return (
      <section style={s.card}>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <Skeleton height={14} width="45%" />
        <Skeleton height={72} />
      </section>
    );
  }

  if (isError) {
    return (
      <section style={s.card}>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <div style={s.warning}>
          {error instanceof ApiError ? error.message : t("loadError")}
        </div>
        {/* The GET failed — retry the GET. Explaining here would answer a failed
            read with a paid model call the user never asked for. */}
        <Button onClick={() => void refetch()} disabled={isFetching}>
          {t("retry")}
        </Button>
      </section>
    );
  }

  if (!data) return null;

  if (data.status === "degraded") {
    return (
      <section style={s.card}>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <div style={s.degraded}>
          <p style={s.degradedTitle}>{t("degradedTitle")}</p>
          <p style={s.degradedBody}>{t("degradedBody", { reason: data.reason ?? "" })}</p>
        </div>
      </section>
    );
  }

  const callerCount = data.changed_symbols.reduce((n, sym) => n + sym.callers.length, 0);
  const hasMap = data.changed_symbols.length > 0;

  return (
    <section style={s.card}>
      <SectionLabel icon="Workflow">{t("title")}</SectionLabel>

      {data.status === "partial" && (
        <p style={s.warning}>{t("partialWarning", { reason: data.reason ?? "" })}</p>
      )}

      <CounterRow
        symbols={data.changed_symbols.length}
        callers={callerCount}
        endpoints={data.endpoints.length}
        crons={data.crons.length}
        onOpenGraph={hasMap ? () => setGraphOpen(true) : null}
      />

      {!hasMap ? (
        <p style={s.emptyNote}>{t("empty")}</p>
      ) : (
        <div style={s.tree}>
          {data.changed_symbols.map((sym, i) => (
            <SymbolRow
              key={`${sym.file}:${sym.name}`}
              sym={sym}
              headSha={headSha}
              repoFullName={repoFullName}
              defaultOpen={i === 0}
            />
          ))}
        </div>
      )}

      {explainError && (
        <div style={s.warning} role="alert">
          {explainError}
        </div>
      )}

      {data.summary ? (
        <div>
          <div style={s.summaryTitle}>{t("summaryTitle")}</div>
          <p style={s.summary}>{data.summary}</p>
        </div>
      ) : (
        // No "Regenerate" once a summary exists at this head: it would be a paid
        // call producing the answer already on screen.
        <div>
          <Button onClick={() => explain.mutate()} disabled={explain.isPending}>
            {explain.isPending ? t("explaining") : t("explain")}
          </Button>
        </div>
      )}

      {graphOpen && (
        // Mounted only while open — the same `data` object the tree just
        // rendered, so opening costs no request.
        <BlastGraphDialog
          data={data}
          headSha={headSha}
          repoFullName={repoFullName}
          onClose={() => setGraphOpen(false)}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the card suite**

```bash
cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard/BlastCard.test.tsx
```

Expected: PASS — every data, state and Explain test unchanged from before the rebuild, plus the new dialog and disclosure tests.

- [ ] **Step 6: Typecheck**

```bash
cd client && pnpm typecheck
```

Expected: no errors. If `SymbolBlock`/`FileRef` are reported as unused, they were left behind in `BlastCard.tsx` — delete them.

- [ ] **Step 7: Commit** (ask the user first)

```bash
git add client/src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/_components/BlastCard
git commit -m "feat(client): rebuild the blast card against the design comp

BlastCard keeps only fetching, status branching and dialog state; the row,
counters and graph moved into local children. Every data, state and Explain
test is unchanged, which is what shows behaviour survived the rebuild."
```

---

### Task 7: Two-column Overview

**Files:**
- Modify: `<OVERVIEW>/OverviewTab.tsx`
- Modify: `<OVERVIEW>/styles.ts`

**Interfaces:**
- Consumes: `IntentCard`, `BlastCard` — both unchanged.
- Produces: no new exports.

There is no test in this task, and that is deliberate: the change is a single grid declaration with no behaviour to assert, and this tier carries no class names or `data-testid`s to target (`client/INSIGHTS.md`, 2026-08-06). `pnpm typecheck` plus the visual check in Step 3 is the verification.

- [ ] **Step 1: Add the grid style**

In `<OVERVIEW>/styles.ts`, add to the `s` object:

```ts
  /** Intent | Blast side by side, as the comp draws them. `auto-fit` +
      `minmax` collapses to one column on a narrow viewport without a media
      query — which inline CSSProperties cannot express. */
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
    gap: 24,
    alignItems: "start",
  } satisfies CSSProperties,
```

- [ ] **Step 2: Wrap the two cards**

In `<OVERVIEW>/OverviewTab.tsx`, replace the returned fragment's first two children:

```tsx
  return (
    <>
      <div style={s.grid}>
        <IntentCard prId={prId} headSha={headSha} />
        <BlastCard prId={prId} headSha={headSha} repoFullName={repoFullName} />
      </div>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
```

`alignItems: "start"` matters: without it the shorter card stretches to the taller one's height and its border floats below its content.

- [ ] **Step 3: Verify**

```bash
cd client && pnpm typecheck && pnpm test
```

Expected: typecheck clean, full client suite green.

Then look at it: `cd client && pnpm dev`, open a PR's Overview tab, and confirm two columns at full width, one column when the window is narrowed under ~900px, and the Description full-width below. If a change doesn't appear, suspect a stale `next dev` chunk before re-diagnosing the code — `grep -rl "auto-fit" client/.next/` (`client/INSIGHTS.md`, 2026-07-29).

- [ ] **Step 4: Commit** (ask the user first)

```bash
git add client/src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/OverviewTab.tsx client/src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/styles.ts
git commit -m "feat(client): place Intent and Blast side by side on Overview

auto-fit + minmax collapses to one column without a media query, which the
inline CSSProperties tier cannot express."
```

---

### Task 8: Spec the screen, then verify the whole package

**Files:**
- Create: `client/specs/blast-radius-card.md`

- [ ] **Step 1: Read the folder's own README**

```bash
cat client/specs/README.md
```

It states what belongs in a client spec. Follow it, and match the shape of a
neighbour — `client/specs/smart-diff-display.md` is the closest analogue.

- [ ] **Step 2: Write `client/specs/blast-radius-card.md`**

Cover, in prose, with no markup and no class names (a spec that pins markup goes stale immediately):

- **Journey** — what the card answers on the PR Overview tab: which symbols this PR changed, who calls them, what endpoints and jobs sit downstream.
- **States** — the six rows of the design doc's state table: loading, load error (Retry re-reads, never posts), `degraded` (explanation only; no tree, no counters, no graph action), `partial` (warning + full tree), `ok` with no symbols (empty note, no graph action), `ok`.
- **Disclosure** — the first symbol opens, the rest are closed; every row is keyboard operable.
- **Naming** — a function or method renders as `name()`; every other kind renders bare with its kind beside it.
- **Counters** — symbols, callers, and the BFS-widened endpoint and cron unions. Per-symbol chips show that symbol's own attribution, so a chip set is a subset of the counters.
- **Graph** — opens in a dialog over the card, renders the same response with no second request, and links only nodes that have a file behind them.
- **Links** — SHA-pinned to the PR head; plain text, never a dead link, when the repo is unknown (cross-reference `client/specs/finding-deep-links.md`).
- **Explain** — one paid call, only on request, and never offered from a failed read or an already-summarised head.

- [ ] **Step 3: Link it from the package README**

Add the new spec to whatever list `client/README.md` keeps of screens or specs, matching the existing entries' format. If it keeps no such list, skip this step.

- [ ] **Step 4: Full package verification**

```bash
cd client && pnpm typecheck && pnpm test
```

Expected: typecheck clean; the whole client suite green, including the untouched neighbours.

- [ ] **Step 5: Check nothing else referenced what was removed**

```bash
git grep -n "toggleButton\|layoutBlastGraph\|COLUMN_X\|GRAPH_MAX_HEIGHT\|MIN_GRAPH_HEIGHT" -- client/src
```

Expected: `layoutBlastGraph` appears only in `BlastGraph/helpers.ts`, `BlastGraph.tsx` and the graph test. The other four must return nothing — they were deleted with the layered layout and the toggle.

- [ ] **Step 6: Record any insight**

If this task surfaced something non-obvious, durable, and actionable cold — the d3-force determinism seeding, say, or anything the hoisted linker did — invoke the `engineering-insights` skill to append it to `client/INSIGHTS.md`. Do not record what the code already says.

- [ ] **Step 7: Commit** (ask the user first)

```bash
git add client/specs/blast-radius-card.md client/README.md
git commit -m "docs(client): spec the blast radius card

States, disclosure, naming, counters and the graph dialog — behaviour only,
no markup, so it survives the next restyle."
```

---

## Self-Review

**Spec coverage** — every section of the design doc maps to a task:

| Spec section | Task |
|---|---|
| Header icon (`Workflow`) | 6 |
| Counter row, icons, zeros, Graph button | 1, 6 |
| Symbol rows: collapse, `()` rule, declaration row, `↳` callers, icon chips | 2 |
| Graph dialog: Modal, force layout, legend, determinism | 3, 4, 5 |
| Dependency note (no `package.json` change) | Global Constraints, 3 |
| States table incl. `degraded` dropping counters | 6 |
| Explain / summary retained | 6 |
| Two-column page layout | 7 |
| File structure | all |
| Testing (behaviour; layout invariants not coordinates) | 1–6 |
| Acceptance checklist | 8 verifies the whole |

**Placeholder scan** — no TBDs. Every code step carries the actual code. Task 8's spec document is described by required content rather than transcribed prose, which is appropriate for a document whose wording is the author's; every behavioural claim it must make is enumerated.

**Type consistency** — `layoutBlastGraph(data, href, width?, height?)` returns `{ nodes, edges, width, height }` in Task 3 and is consumed with exactly that shape in Task 4. `GraphEdge` is `{id,x1,y1,x2,y2}` in both. `CounterRow`'s `onOpenGraph: (() => void) | null` matches Task 6's `hasMap ? () => setGraphOpen(true) : null`. `SymbolRow`'s `defaultOpen: boolean` matches Task 6's `i === 0`. `FUNCTION_KINDS` is created in Task 2 at `BlastCard/constants.ts` and imported as `../../constants` from `SymbolRow`, which is the correct depth. `BlastGraphDialog` takes `onClose` and is mounted conditionally — matching Task 6's `{graphOpen && …}`.

One inconsistency found and fixed while reviewing: Task 5 listed `constants.ts` only in a later step, not in its **Files** block — the file list now implies it via the steps, and `DIALOG_WIDTH`/`LEGEND` are defined before they are imported in the reading order. Also note Task 3 deliberately leaves the suite red between Steps 5 and Task 4 Step 5; that is the one place in this plan where a task boundary does not end green, and it is called out in Task 3's final step.
