# Report format

Three artifacts, all fixed in shape: the report file, the PR draft appended to
it, and the console block. Copy them verbatim and fill the placeholders.

## The report — `.devdigest/pr-self-review/<head-sha>.md`

```markdown
# PR self review — <branch>

base `<base-sha>` → head `<head-sha>`
generated <iso-8601>
working tree: clean | **dirty (uncommitted changes were NOT reviewed)**

## Verdict: BLOCKED | PASS

critical N · high N · medium N

<!-- present only when overrides exist -->
## ⚠️ Overridden

| ID | Finding | Reason |
|---|---|---|
| CRIT-1 | `path:line` — summary | <reason> |

## Critical

### CRIT-1 · B4 · `server/src/modules/pulls/routes.ts:42`
lane: drizzle-orm-patterns

> `const rows = await db.select().from(pulls).where(eq(pulls.repoId, repoId));`

No `workspaceId` in the predicate, so this returns rows from every workspace.

**Fix:** add `and(eq(pulls.workspaceId, workspaceId), …)`.

## High

## Medium

## Phase 1 — deterministic checks

| Package | Command | Result |
|---|---|---|
| server | `pnpm typecheck` | ✅ |
| server | `pnpm arch:check` | ✅ 24 known violations ignored |

## Coverage

| Lane | Skill | Files |
|---|---|---|

**Unrouted** (changed, matched no glob — routing.md may need a row):

**Excluded** (lock files, generated SQL, snapshots):
```

Every finding entry follows the `CRIT-1` shape above: heading carries the ID,
the blocker ID from [`blockers.md`](blockers.md), and `` `path:line` ``; then the
lane that raised it; then the quoted source line; then the explanation; then a
concrete **Fix:**. `HIGH` and `MEDIUM` sections use the same shape with their
own ID prefixes, minus the blocker ID — only `CRITICAL` findings carry one,
because only they come from a closed list.

## The PR draft — appended to the same file

Generated **only when the verdict is not `BLOCKED`.**

```markdown
## PR draft

### Title
`feat(reviews): <one line>`

### Body

<what changed and why, from the commit bodies and the diff>

**Risk:** <what could break, or "low — additive only">

**Test plan:**
- `cd server && pnpm typecheck` ✅
- `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` ✅
- manual: <what a human still needs to click>

**CI that will run:** <workflows, from the path-filter table in routing.md>

**Reviewer checklist** (non-blocking findings from this self-review):
- [ ] HIGH-1 `path:line` — summary

<!-- present only when overrides exist -->
> ⚠️ **Self-review overridden.** CRIT-1 `path:line` — <reason>
```

## The console block

Printed **verbatim in this shape**, so it stays greppable across runs:

```
PR-SELF-REVIEW: BLOCKED
base 5a21cc5 → head 9e81b60
critical 2 · high 4 · medium 7
report .devdigest/pr-self-review/9e81b60.md
```

Four lines, in this order, no extra decoration:

1. `PR-SELF-REVIEW: ` followed by `BLOCKED` or `PASS`;
2. `base <short> → head <short>` — short SHAs here, for reading;
3. the counts, separated by ` · `;
4. `report ` followed by the path.

The short SHA is for the console only. [`SKILL.md`](SKILL.md) writes the **full**
SHA into `latest.json`, because the gate compares it exactly.
