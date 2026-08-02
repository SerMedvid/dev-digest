# PR Self Review Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `.claude/skills/pr-self-review/` skill that reviews the branch
diff against the skills governing each changed file, plus a `PreToolUse` hook
that denies `gh pr create` until a fresh report says the change is clean.

**Architecture:** The hook never runs a review — it reads a JSON artifact and
denies, naming the skill in the denial, so the agent invokes the skill itself.
That keeps automatic and manual runs on one code path. The skill runs five
phases: collect the diff, run the deterministic checks (which cost no tokens and
catch the common case), route files to skill-specific review lanes, ground and
merge the findings, then draft the PR description.

**Tech Stack:** Markdown skill files; one ESM Node script (`node:test`,
`node:child_process`, `node:fs` — no dependencies, no new lockfile); Claude Code
`PreToolUse` hooks.

**Spec:** [`docs/superpowers/specs/2026-08-02-pr-self-review-skill-design.md`](../specs/2026-08-02-pr-self-review-skill-design.md)

## Global Constraints

- **No new dependencies and no new lockfile.** The repo has no root
  `package.json` and four per-package lockfiles with **different** managers
  (`server`/`client` → pnpm, `reviewer-core`/`e2e` → npm). The gate script is a
  dependency-free `.mjs` run by `node` directly; its tests use the built-in
  `node:test` runner. Never run `npm install` or `pnpm install` at the repo root.
- **Node 24.18 is the local baseline.** `node:test`, `node --test`, and top-level
  `await` in `.mjs` are all available.
- **OS-agnostic.** No `.sh` for the gate — `scripts/*.sh` are POSIX and this must
  also run on Windows. Build every path with `path.join` / `path.resolve`. No
  hardcoded separators.
- **Do not modify any vendored skill** under `.claude/skills/*/` and do not touch
  [`skills-lock.json`](../../../skills-lock.json). Their hashes are tracked.
  Routing lives inside the new skill only.
- **Skill file convention:** `SKILL.md` with YAML frontmatter carrying `name`,
  `description` (**one single line** — a wrapped line breaks discovery), and
  `allowed-tools`, plus sibling `.md` files. See
  [`.claude/skills/onion-architecture/SKILL.md`](../../../.claude/skills/onion-architecture/SKILL.md).
- **Deny is exit 0 + JSON**, not exit 2. Exit 2 also blocks but discards stdout
  and surfaces stderr as an error; the `permissionDecision` path gives a clean
  reason string. Exit codes other than 0 and 2 let the tool **proceed**.
- **The gate fails closed.** Any internal error in the script produces a deny,
  never a silent allow.
- **Do not create `.devdigest/pr-self-review/` in git.** It is a runtime
  artifact directory added to `.gitignore` in Task 2.
- Commit style: conventional commits with a scope, the *why* in the body.

---

### Task 1: The gate script and its tests

The only executable code in this plan. It goes first because Task 2 registers it
and Tasks 3–5 describe the artifact it reads.

The script is split into pure exported functions plus a thin `main()` that does
the I/O, because only the pure half is worth testing and the I/O half needs a
live git repo and a stdin pipe.

**Files:**
- Create: `scripts/pr-self-review-gate.mjs`
- Test: `scripts/pr-self-review-gate.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: the `latest.json` contract that Task 5 makes the skill write, and
  two exported functions later tasks cite by name:
  - `isGatedCommand(command: string, opts?: { gatePush?: boolean }): boolean`
  - `decide(input: { report: object | null, headSha: string }): { allow: true } | { allow: false, reason: string }`

  The report object shape, fixed here and written by the skill in Task 5:

  ```json
  {
    "head": "9e81b60d1f…",
    "base": "5a21cc5a2e…",
    "verdict": "BLOCKED",
    "dirty": false,
    "counts": { "critical": 2, "high": 4, "medium": 7 },
    "critical": [
      { "id": "CRIT-1", "path": "server/src/modules/pulls/routes.ts", "line": 42, "summary": "query without workspaceId" }
    ],
    "overrides": [
      { "id": "CRIT-1", "reason": "…", "at": "2026-08-02T10:00:00Z", "head": "9e81b60d1f…" }
    ],
    "report": ".devdigest/pr-self-review/9e81b60d1f.md"
  }
  ```

- [ ] **Step 1: Write the failing tests**

Create `scripts/pr-self-review-gate.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGatedCommand, decide } from './pr-self-review-gate.mjs';

const HEAD = '9e81b60d1f2a3b4c5d6e7f8091a2b3c4d5e6f708';
const OTHER = '5a21cc5a2e1f0d9c8b7a6958473625140f3e2d1c';

const pass = { head: HEAD, verdict: 'PASS', critical: [], overrides: [] };
const blocked = {
  head: HEAD,
  verdict: 'BLOCKED',
  critical: [
    { id: 'CRIT-1', path: 'server/src/a.ts', line: 1, summary: 'no workspaceId' },
    { id: 'CRIT-2', path: 'client/src/b.tsx', line: 2, summary: 'secret committed' },
  ],
  overrides: [],
};

test('gates gh pr create', () => {
  assert.equal(isGatedCommand('gh pr create --fill'), true);
});

test('gates gh pr ready', () => {
  assert.equal(isGatedCommand('gh pr ready'), true);
});

test('gates a gh pr create buried in a && chain', () => {
  assert.equal(isGatedCommand('git commit -m wip && gh pr create --fill'), true);
});

test('tolerates irregular whitespace', () => {
  assert.equal(isGatedCommand('gh   pr\tcreate --fill'), true);
});

test('does not gate other gh subcommands', () => {
  assert.equal(isGatedCommand('gh pr list'), false);
  assert.equal(isGatedCommand('gh pr view 7'), false);
});

test('gates git push only when opted in', () => {
  assert.equal(isGatedCommand('git push -u origin HEAD'), false);
  assert.equal(isGatedCommand('git push -u origin HEAD', { gatePush: true }), true);
});

test('a non-string command is not gated', () => {
  assert.equal(isGatedCommand(undefined), false);
  assert.equal(isGatedCommand(null), false);
});

test('missing report denies and names the skill', () => {
  const d = decide({ report: null, headSha: HEAD });
  assert.equal(d.allow, false);
  assert.match(d.reason, /\/pr-self-review/);
});

test('stale report denies and says so', () => {
  const d = decide({ report: { ...pass, head: OTHER }, headSha: HEAD });
  assert.equal(d.allow, false);
  assert.match(d.reason, /stale/i);
});

test('a clean fresh report allows', () => {
  assert.deepEqual(decide({ report: pass, headSha: HEAD }), { allow: true });
});

test('BLOCKED with no overrides denies and lists every id', () => {
  const d = decide({ report: blocked, headSha: HEAD });
  assert.equal(d.allow, false);
  assert.match(d.reason, /CRIT-1/);
  assert.match(d.reason, /CRIT-2/);
});

test('BLOCKED lists only the ids still outstanding', () => {
  const partly = {
    ...blocked,
    overrides: [{ id: 'CRIT-1', reason: 'accepted risk, tracked in DD-14', at: '', head: HEAD }],
  };
  const d = decide({ report: partly, headSha: HEAD });
  assert.equal(d.allow, false);
  assert.doesNotMatch(d.reason, /CRIT-1/);
  assert.match(d.reason, /CRIT-2/);
});

test('BLOCKED with every finding overridden allows', () => {
  const all = {
    ...blocked,
    overrides: [
      { id: 'CRIT-1', reason: 'accepted risk, tracked in DD-14', at: '', head: HEAD },
      { id: 'CRIT-2', reason: 'false positive, line is a test fixture', at: '', head: HEAD },
    ],
  };
  assert.deepEqual(decide({ report: all, headSha: HEAD }), { allow: true });
});

test('an override minted for a different head does not count', () => {
  const stale = {
    ...blocked,
    critical: [blocked.critical[0]],
    overrides: [{ id: 'CRIT-1', reason: 'accepted risk, tracked in DD-14', at: '', head: OTHER }],
  };
  const d = decide({ report: stale, headSha: HEAD });
  assert.equal(d.allow, false);
  assert.match(d.reason, /CRIT-1/);
});

test('a malformed report denies rather than allowing', () => {
  const d = decide({ report: { head: HEAD }, headSha: HEAD });
  assert.equal(d.allow, false);
  assert.match(d.reason, /unreadable|malformed/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd d:/Projects/neo/dev-digest && node --test scripts/`

Expected: FAIL — `Cannot find module …/pr-self-review-gate.mjs`.

- [ ] **Step 3: Write the script**

Create `scripts/pr-self-review-gate.mjs`:

```js
#!/usr/bin/env node
/**
 * PreToolUse gate for the pr-self-review skill.
 *
 * Registered in .claude/settings.json against the Bash tool. It does NOT run a
 * review — it reads .devdigest/pr-self-review/latest.json and denies
 * `gh pr create` / `gh pr ready` until a report for the current HEAD says the
 * change is clean. The denial names the skill, so the agent runs it.
 *
 * Deny protocol: exit 0 with a permissionDecision JSON on stdout. Exit 2 also
 * blocks but discards stdout; any other non-zero lets the tool through.
 *
 * Fails closed: an internal error produces a deny, never a silent allow.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const GATED = [/\bgh\s+pr\s+create\b/, /\bgh\s+pr\s+ready\b/];
const PUSH = /\bgit\s+push\b/;

const REPORT_DIR = path.join('.devdigest', 'pr-self-review');
const LATEST = 'latest.json';

/**
 * Deliberately over-broad: it searches the whole command string, so a chained
 * `… && gh pr create` still matches, and so does the phrase inside a quoted
 * argument. A false block costs one review run; a miss defeats the gate.
 */
export function isGatedCommand(command, { gatePush = false } = {}) {
  if (typeof command !== 'string') return false;
  const normalised = command.replace(/\s+/g, ' ');
  if (GATED.some((re) => re.test(normalised))) return true;
  return gatePush && PUSH.test(normalised);
}

const short = (sha) => (typeof sha === 'string' ? sha.slice(0, 7) : '?');

export function decide({ report, headSha }) {
  if (!report) {
    return {
      allow: false,
      reason:
        'No pr-self-review report found. Run the /pr-self-review skill before opening a pull request.',
    };
  }
  if (typeof report.verdict !== 'string' || !Array.isArray(report.critical)) {
    return {
      allow: false,
      reason:
        'The pr-self-review report is malformed (no verdict or no critical list). Re-run /pr-self-review.',
    };
  }
  if (report.head !== headSha) {
    return {
      allow: false,
      reason:
        `The pr-self-review report is stale: it covers ${short(report.head)}, HEAD is ` +
        `${short(headSha)}. Re-run /pr-self-review.`,
    };
  }
  if (report.verdict !== 'BLOCKED') return { allow: true };

  const waived = new Set(
    (Array.isArray(report.overrides) ? report.overrides : [])
      .filter((o) => o && o.head === headSha && typeof o.reason === 'string' && o.reason.length > 0)
      .map((o) => o.id),
  );
  const outstanding = report.critical.filter((f) => !waived.has(f.id));
  if (outstanding.length === 0) return { allow: true };

  const list = outstanding.map((f) => `  ${f.id} ${f.path}:${f.line} — ${f.summary}`).join('\n');
  return {
    allow: false,
    reason:
      `pr-self-review verdict is BLOCKED. ${outstanding.length} critical finding(s) outstanding:\n${list}\n` +
      'Fix them, or waive each one with /pr-self-review --override <ids> --reason "<why>".',
  };
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function readReport(projectDir) {
  try {
    return JSON.parse(readFileSync(path.join(projectDir, REPORT_DIR, LATEST), 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const raw = readStdin();
  if (!raw.trim()) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // not our payload; stay out of the way
  }

  if (payload.tool_name !== 'Bash') process.exit(0);

  const gatePush = process.env.DEVDIGEST_GATE_PUSH === '1';
  if (!isGatedCommand(payload.tool_input?.command, { gatePush })) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();

  let headSha;
  try {
    headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectDir,
      encoding: 'utf8',
    }).trim();
  } catch (err) {
    deny(`pr-self-review gate could not read HEAD: ${err.message}`);
    return;
  }

  const result = decide({ report: readReport(projectDir), headSha });
  if (!result.allow) deny(result.reason);
  process.exit(0);
}

// Only run as a hook, never on import from the test file.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    // Fail closed. A gate that lets everything through when it breaks is not a gate.
    deny(`pr-self-review gate failed: ${err.message}`);
  }
}
```

- [ ] **Step 4: Check the entrypoint guard against the portability rule**

Confirm the guard reads exactly:

```js
import.meta.url === pathToFileURL(process.argv[1]).href
```

and **not** `` import.meta.url === `file://${process.argv[1]}` ``. The template
form only matches when `argv[1]` is already a POSIX path. On Windows the check
silently fails, the hook exits 0 having decided nothing, and every
`gh pr create` sails through — an installed gate that gates nothing. The
reference implementation is
[`server/src/db/migrate.ts`](../../../server/src/db/migrate.ts).

Run: `cd d:/Projects/neo/dev-digest && grep -n 'pathToFileURL\|file://\${' scripts/pr-self-review-gate.mjs`

Expected: two `pathToFileURL` hits (the import and the guard), and no
`file://${` hit.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd d:/Projects/neo/dev-digest && node --test scripts/`

Expected: PASS, 15 tests, exit 0.

- [ ] **Step 6: Verify the entrypoint guard actually fires**

The tests import the module, so they never exercise `main()`. Drive it directly:

```bash
cd d:/Projects/neo/dev-digest
echo '{"tool_name":"Read","tool_input":{"file_path":"x"}}' | node scripts/pr-self-review-gate.mjs; echo "EXIT=$?"
echo '{"tool_name":"Bash","tool_input":{"command":"gh pr create --fill"}}' | node scripts/pr-self-review-gate.mjs; echo "EXIT=$?"
```

Expected: the first prints nothing and `EXIT=0`. The second prints a JSON object
containing `"permissionDecision":"deny"` and a reason naming `/pr-self-review`,
then `EXIT=0`.

If the second prints nothing, the guard in Step 4 is not matching — fix it
before continuing. A gate that no-ops is worse than no gate, because it looks
installed.

- [ ] **Step 7: Commit**

```bash
git add scripts/pr-self-review-gate.mjs scripts/pr-self-review-gate.test.mjs
git commit -m "feat(scripts): add the pr-self-review PreToolUse gate

Reads .devdigest/pr-self-review/latest.json and denies gh pr create when no
report covers the current HEAD or a critical finding is outstanding. The
denial names the skill, so the agent runs the review itself — the hook is a
gate, not a scheduler.

Fails closed: an unreadable HEAD or a malformed report denies. Dependency-free
ESM so it needs no root package.json and writes no lockfile; tests run on the
built-in node:test runner."
```

---

### Task 2: Register the hook and ignore the artifacts

**Files:**
- Modify: `.claude/settings.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `scripts/pr-self-review-gate.mjs` from Task 1.
- Produces: the live gate. Tasks 3–6 assume `gh pr create` is denied until a
  report exists.

- [ ] **Step 1: Add the hook**

`.claude/settings.json` currently holds only `enabledPlugins`. Replace its
contents with:

```json
{
  "enabledPlugins": {
    "superpowers@claude-plugins-official": true,
    "frontend-design@claude-plugins-official": true,
    "code-simplifier@claude-plugins-official": true
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PROJECT_DIR}/scripts/pr-self-review-gate.mjs"]
          }
        ]
      }
    ]
  }
}
```

`command` + `args` rather than one shell string: the placeholder is expanded in
both forms, and this way a project path containing a space does not need
quoting rules that differ per shell.

Note this file is committed, so the hook applies to every contributor — that is
the intent.

- [ ] **Step 2: Ignore the report directory**

In `.gitignore`, directly below the existing `.devdigest/cache/` line, add:

```
.devdigest/pr-self-review/
```

Its own line rather than widening to `.devdigest/`: the reports are artifacts,
not cache, and a future `.devdigest/` entry that *should* be committed must not
be swept up silently.

- [ ] **Step 3: Verify the hook is registered and fires**

Restart the Claude Code session (settings are read at startup), then in that
session run a Bash command containing the gated phrase, for example
`echo "gh pr create"`.

Expected: the call is **denied**, with a reason naming `/pr-self-review`. That
the phrase was inside an `echo` is the documented over-broad match, not a bug.

Then run `git status --short`.

Expected: allowed and runs normally — the matcher is `Bash` for every command,
so confirming that ordinary commands are untouched is the real check here.

- [ ] **Step 4: Verify the ignore rule**

```bash
cd d:/Projects/neo/dev-digest
mkdir -p .devdigest/pr-self-review && echo '{}' > .devdigest/pr-self-review/latest.json
git status --short .devdigest
```

Expected: no output — the file is ignored. Leave `latest.json` in place; Task 6
overwrites it with a real report.

- [ ] **Step 5: Commit**

```bash
git add .claude/settings.json .gitignore
git commit -m "feat(skills): register the pr-self-review PreToolUse gate

Wires the gate script into settings.json against the Bash tool and ignores
.devdigest/pr-self-review/. settings.json is committed, so the gate applies to
everyone who clones the repo — that is the point of a pre-PR gate.

Uses the command+args hook form so a project path with a space needs no
shell-specific quoting."
```

---

### Task 3: `blockers.md` and `report-template.md`

The two contracts every later file cites. Written together because the report
renders exactly the severities the blocker list defines.

**Files:**
- Create: `.claude/skills/pr-self-review/blockers.md`
- Create: `.claude/skills/pr-self-review/report-template.md`

**Interfaces:**
- Consumes: the `latest.json` shape from Task 1.
- Produces: the nine blocker IDs `B1`–`B9`, the severity vocabulary
  `CRITICAL` / `HIGH` / `MEDIUM`, the finding-ID scheme `CRIT-n` / `HIGH-n` /
  `MED-n`, and the console verdict block. Tasks 4 and 5 cite all of these
  verbatim.

- [ ] **Step 1: Write `blockers.md`**

Structure, in this order:

1. **The rule, stated once:** a finding is `CRITICAL` only if it matches an entry
   below. There is no judgement call and no "this feels critical". Everything
   else is `HIGH` (should fix before merge) or `MEDIUM` (worth knowing), and
   neither blocks.

2. **The table**, exactly these nine rows:

   | ID | Blocker | How a lane recognises it | Overridable |
   |---|---|---|---|
   | B1 | Phase 1 red | `pnpm typecheck`, `pnpm arch:check`, or the hermetic vitest lane exits non-zero on a touched package | **No** |
   | B2 | Secret committed | An API key, token, password, or a `.env` file present in the diff. Secrets live in `~/.devdigest/secrets.json`, outside the repo | Yes |
   | B3 | Confirmed vulnerability | Only the HIGH-confidence tier of [`security/SKILL.md`](../security/SKILL.md): a vulnerable pattern **and** a traced attacker-controlled source. `fetch(req.query.url)` qualifies; `fetch(process.env.API_URL)` does not | Yes |
   | B4 | Missing workspace scoping | A query or mutation against a workspace-scoped table with no `workspaceId` in the predicate | Yes |
   | B5 | Irreversible destruction | `docker compose down -v` (drops `devdigest_pgdata`), or an edit to a file already present in `server/src/db/migrations/` on `main` | Yes |
   | B6 | Half-applied shared contract | A change under `server/src/vendor/shared/` with no matching change under `client/src/vendor/shared/`, or the reverse | Yes |
   | B7 | Wrong package manager | `package-lock.json` added under `server/` or `client/`; `pnpm-lock.yaml` added under `reviewer-core/` or `e2e/` | Yes |
   | B8 | Portability break | A hardcoded `\` or `/` joined into a path, a `` file://${process.argv[1]} `` entrypoint check, or an absolute machine-specific path in application code | Yes |
   | B9 | `lane-failed` | A review lane crashed, timed out, or returned unparseable output, so its bucket went unreviewed | Yes |

3. **Why B1 is not overridable:** it is not a model judgement. A red typecheck or
   a red `arch:check` is a fact, and the fix is to fix it.

4. **Explicit non-blockers**, so lanes stop reaching for CRITICAL: style,
   naming, missing tests, a large function, a `MEDIUM`-tagged rule from
   `react-best-practices`, a theoretical vulnerability with no traced input,
   anything in a file the diff does not touch, and anything in a test fixture.

5. **The ID scheme:** after grounding and dedupe, sort by severity, then path,
   then line, then number within severity — `CRIT-1`, `CRIT-2`, `HIGH-1`,
   `MED-1`. Sorting is what makes an ID stable enough to name in an override.

- [ ] **Step 2: Write `report-template.md`**

Two skeletons, both verbatim-copyable.

The report at `.devdigest/pr-self-review/<head-sha>.md`:

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

The PR draft, appended to the same file, generated only when the verdict is not
`BLOCKED`:

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

And the console block, which must be printed **verbatim in this shape** so it
stays greppable:

```
PR-SELF-REVIEW: BLOCKED
base 5a21cc5 → head 9e81b60
critical 2 · high 4 · medium 7
report .devdigest/pr-self-review/9e81b60.md
```

- [ ] **Step 3: Verify the cross-file links resolve**

```bash
cd d:/Projects/neo/dev-digest/.claude/skills/pr-self-review
grep -ohE '\]\(([./a-zA-Z0-9_-]+\.md)\)' blockers.md report-template.md | sed -E 's/^\]\((.*)\)$/\1/' | sort -u | while read -r f; do
  [ -e "$f" ] || echo "DANGLING: $f"
done; echo done
```

Expected: `done`, no `DANGLING:` lines. (`../security/SKILL.md` exists.)

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/pr-self-review/blockers.md .claude/skills/pr-self-review/report-template.md
git commit -m "docs(skills): pr-self-review blocker list and report format

CRITICAL is a closed list of nine entries rather than a model judgement,
because the verdict blocks a merge and an open-ended severity scale makes that
unpredictable between runs. B1 — a red typecheck or arch:check — is the one
entry an override cannot touch.

The report template fixes the console block shape so it stays greppable, and
the finding-ID scheme so an override can name a specific finding."
```

---

### Task 4: `routing.md`

**Files:**
- Create: `.claude/skills/pr-self-review/routing.md`

**Interfaces:**
- Consumes: the severity vocabulary from Task 3.
- Produces: the lane names Task 5 dispatches, the Phase 1 command matrix, and
  the CI path-filter table the PR draft cites.

- [ ] **Step 1: Write the glob → lanes table**

A **lane** is one skill × one bucket of changed files × the mandatory context
for that bucket. Copy this table as-is:

| Glob | Lanes |
|---|---|
| `server/src/**/routes.ts`, `server/src/app.ts` | fastify-best-practices · onion-architecture · security · zod |
| `server/src/**/repository*.ts`, `server/src/db/**` | drizzle-orm-patterns · onion-architecture |
| `server/src/db/schema/**` | postgresql-table-design · drizzle-orm-patterns |
| `server/src/modules/**`, `server/src/adapters/**`, `server/src/platform/**` | onion-architecture · typescript-expert |
| `client/src/app/**` | next-best-practices · frontend-architecture |
| `client/src/**/*.tsx` | react-best-practices · frontend-architecture |
| `client/**/*.test.tsx` | react-testing-library |
| `server/src/vendor/shared/**`, `client/src/vendor/shared/**` | zod · typescript-expert |

Then state the three rules that govern the table:

- A file matching several rows joins several lanes. That is intended — a route
  file is reviewed for HTTP shape *and* for its ring.
- A lane whose bucket is empty is not dispatched. No skill is loaded speculatively.
- Rows are matched top to bottom and **all** matches apply; this is not
  first-match-wins.

- [ ] **Step 2: Write the mandatory-context rule**

Every lane receives, in addition to its skill and its diff hunks:

- the touched package's `CLAUDE.md` (`server/CLAUDE.md`, `client/CLAUDE.md`, …)
- the touched package's `INSIGHTS.md`
- the repo-root [`CLAUDE.md`](../../../CLAUDE.md)
- `blockers.md`

State why, concretely: without these a reviewer does not know that
`@devdigest/shared` is two physical directories that have already drifted, that
a query without `workspaceId` is a bug rather than a shortcut, or that ~15 DB
tables are deliberately unreferenced and must not be "fixed".

- [ ] **Step 3: Write the Phase 1 command matrix**

| Touched | Commands |
|---|---|
| `server/**` | `cd server && pnpm typecheck` · `pnpm arch:check` · `pnpm exec vitest run --exclude '**/*.it.test.ts'` |
| `reviewer-core/**` | `cd reviewer-core && npm run typecheck` · `npm test` · **and** `cd server && pnpm typecheck` |
| `client/**` | `cd client && pnpm typecheck` · `pnpm test` |
| `e2e/**` | `cd e2e && npm run typecheck` only |
| `server/src/vendor/shared/**` or `client/src/vendor/shared/**` | typecheck **both** `server` and `client` |

With three notes:

- The `reviewer-core` row is not redundant: `server` type-checks against
  `../reviewer-core/src` through a path alias, so a change there can only surface
  as a `server` type error.
- `pnpm` for `server`/`client`, `npm` for `reviewer-core`/`e2e`. The wrong one
  writes a second lockfile, which is blocker **B7**.
- If `arch:check` prints `Can't open '.dependency-cruiser-known-violations.json'
  for reading`, that is a missing baseline, not an architecture violation.
  Report "run `pnpm arch:baseline`" and do not raise B1 for it.

- [ ] **Step 4: Write the three not-reviewed categories and the CI path-filter table**

A changed file that reaches no lane lands in exactly one of three buckets, and
the report names them separately. Keeping them apart is what makes the third one
mean something.

**Excluded** — generated or opaque, never worth reading: `pnpm-lock.yaml`,
`package-lock.json`, `**/migrations/*.sql` (generated by `pnpm db:generate`),
`*.snap`, `agent-runner/dist/**`.

Excluded files still count for **B7**: a lock file is not reviewed, but a lock
file of the wrong kind is a blocker.

**Not routed by design** — real files this skill has no opinion on:
`**/*.md`, `docs/**`, `.claude/**`, `.github/**`, `scripts/**`.

**Unrouted** — everything else that matched no glob. This bucket is the
manifest's rot detector, so it must normally be **empty**. A `.ts` file showing
up here means a new directory exists and `routing.md` needs a row. If ordinary
doc-only PRs fill this list, the signal is gone — that is why the middle bucket
exists.

The path-filter table, for the PR draft's "CI that will run" line — copied from
`.github/workflows/`:

| Changed path | Workflows triggered |
|---|---|
| `client/**` | `client`, `e2e web` |
| `server/**` | `server unit`, `server integration`, `e2e web` |
| `server/src/vendor/shared/**` | the `server` rows **plus** `reviewer-core` |
| `reviewer-core/**` | `reviewer-core`, `server unit`, `server integration` |
| `e2e/**` | `e2e web` |

- [ ] **Step 5: Verify every glob in the table matches something real**

```bash
cd d:/Projects/neo/dev-digest
for d in server/src/modules server/src/adapters server/src/platform server/src/db/schema \
         client/src/app server/src/vendor/shared client/src/vendor/shared; do
  [ -d "$d" ] || echo "MISSING DIR: $d"
done
ls server/CLAUDE.md client/CLAUDE.md reviewer-core/CLAUDE.md e2e/CLAUDE.md 2>&1 | grep -i 'no such' || true
ls server/INSIGHTS.md client/INSIGHTS.md 2>&1 | grep -i 'no such' || true
echo done
```

Expected: `done` with no `MISSING DIR:` lines. If a `CLAUDE.md` or `INSIGHTS.md`
named in Step 2 does not exist for some package, correct Step 2 to match reality
rather than leaving a lane pointed at a missing file.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/pr-self-review/routing.md
git commit -m "docs(skills): pr-self-review routing manifest

Maps changed paths to the skills that govern them, statically. Runtime
inference was rejected: the verdict blocks a merge, so the set of reviewers
has to be the same on two runs of the same diff.

Also carries the Phase 1 command matrix — which differs per package because
the package manager does — and the CI path-filter table the PR draft cites."
```

---

### Task 5: `SKILL.md`

**Files:**
- Create: `.claude/skills/pr-self-review/SKILL.md`

**Interfaces:**
- Consumes: `routing.md`, `blockers.md`, `report-template.md`, and the
  `latest.json` shape from Task 1.
- Produces: the skill itself. Task 6 only wires it into the catalog.

- [ ] **Step 1: Write the frontmatter**

```markdown
---
name: pr-self-review
description: Use before opening a pull request, and whenever the PreToolUse gate denies `gh pr create`. Reviews the committed branch diff against the skills that govern each changed file, runs the deterministic checks first, blocks on a closed list of critical findings, and drafts the PR description. Also handles "self review", "check my changes before PR", and the --override flow.
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, Task
---
```

`description` must stay one physical line — a wrapped line breaks discovery.
`Task` is in `allowed-tools` because Phase 3 dispatches subagents.

- [ ] **Step 2: Write the five phases**

Each phase gets a section with its exact commands.

**Phase 0 — Collect the diff.**

```bash
BASE=$(git merge-base origin/main HEAD 2>/dev/null || git merge-base main HEAD)
git rev-parse HEAD
git diff --name-status "$BASE"..HEAD
git status --porcelain
```

Stop, with a specific message and no report written, when: the current branch is
`main`; `HEAD` has no commits ahead of `BASE`; or neither `origin/main` nor
`main` resolves — say so rather than guessing a base.

A dirty working tree does **not** stop the run. Record `dirty: true`, print the
warning from `report-template.md`, and continue — the scope is committed code,
and the SHA stamp is what keeps the report honest.

**Phase 1 — Deterministic checks.** Derive the touched packages from the changed
paths and run the matrix in `routing.md`. Any non-zero exit produces one
`CRITICAL` finding tagged **B1**, carrying the command and the last 30 lines of
output. Then write the report, print the verdict block, and **stop** — dispatch
no lanes. This is the common case and it must cost nothing.

**Phase 2 — Route.** Apply the glob table in `routing.md`. Build one bucket per
lane and drop lanes with empty buckets. Everything that reached no lane goes
into one of the three buckets `routing.md` defines — *excluded*, *not routed by
design*, or *unrouted* — and `unrouted` should normally be empty.

**Phase 3 — Review lanes.** Dispatch one subagent per lane using
`superpowers:dispatching-parallel-agents`, at most six concurrent. Each subagent
receives its skill, its bucket's diff hunks, the mandatory context from
`routing.md`, and `blockers.md`.

State the three rules that bind every lane, and put them in the subagent prompt
verbatim:

1. Report only on lines present in the diff. A pre-existing problem elsewhere in
   a changed file is out of scope.
2. Every finding cites `path:line` and quotes the line verbatim.
3. Severity comes from `blockers.md` and nowhere else. Do not invent a critical
   category, and do not carry over the `CRITICAL` labels inside
   `react-best-practices` — that scale is not this scale.

A lane that fails, times out, or returns unparseable output becomes one
`CRITICAL` finding tagged **B9** `lane-failed`. Do not retry silently and do not
drop the lane.

**Phase 4 — Ground, merge, decide.**

- **Grounding gate:** discard — do not downgrade — any finding whose cited line
  is absent from the diff. This is what stops a hallucinated `CRITICAL` from
  blocking a correct PR, and it is the same gate `reviewer-core` applies to the
  product's own review output.
- Dedupe on `(path, line, category)`; when lanes agree, keep the higher severity
  and record both skill names.
- Assign IDs per the scheme in `blockers.md`.
- Verdict: `BLOCKED` if any `CRITICAL` survives, otherwise `PASS`.
- Write `.devdigest/pr-self-review/<head-sha>.md` and
  `.devdigest/pr-self-review/latest.json` (shape below), then print the console
  block from `report-template.md`.

**Phase 5 — PR draft.** Only when the verdict is not `BLOCKED`. Append the draft
from `report-template.md`, taking the CI line from the path-filter table in
`routing.md`.

- [ ] **Step 3: Write the `latest.json` contract into the skill**

Quote the exact object, because the gate script parses it:

```json
{
  "head": "<full sha>",
  "base": "<full sha>",
  "verdict": "BLOCKED",
  "dirty": false,
  "counts": { "critical": 2, "high": 4, "medium": 7 },
  "critical": [
    { "id": "CRIT-1", "path": "server/src/modules/pulls/routes.ts", "line": 42, "summary": "query without workspaceId" }
  ],
  "overrides": [],
  "report": ".devdigest/pr-self-review/<short sha>.md"
}
```

With the note: `head` must be the **full** SHA from `git rev-parse HEAD`. The
gate compares it exactly; a short SHA never matches and every PR is denied as
stale.

- [ ] **Step 4: Write the override section**

```
/pr-self-review --override CRIT-1,CRIT-3 --reason "<text>"
```

Rules, stated as refusals the skill performs itself:

- **Only after a `BLOCKED` verdict has been printed.** Not a flag on the first
  run — the point is that a human reads the findings first.
- **IDs are required.** There is no `--override all`. Refuse it.
- **Refuse an empty reason**, a reason under 15 characters, or one of
  `wip`, `later`, `ok`, `fix soon`, `n/a`, `-`.
- **Refuse to override a B1 finding.** A red typecheck is not a judgement call.
- **One SHA of lifetime.** Write `head` into each override entry; the gate
  ignores entries minted for a different SHA, so a new commit costs a new reason.

On success: append to `overrides[]` in `latest.json`, add the `⚠️ Overridden`
section to the top of the report, re-run Phase 5, and print the verdict block
again showing the outstanding count.

- [ ] **Step 5: Write the checklist**

Ending the skill, one todo per item:

1. Confirm the branch is not `main` and has commits ahead of the base.
2. Run Phase 1 and paste its output into the response.
3. Route; name every lane you are dispatching and every file under `unrouted`.
4. Dispatch lanes in parallel; do not review a bucket yourself in the main
   thread.
5. Apply the grounding gate before assigning any ID.
6. Write both artifacts; verify `latest.json` carries the **full** HEAD SHA.
7. Print the console verdict block verbatim.
8. On `PASS`, produce the PR draft. On `BLOCKED`, do not — list the fixes.

- [ ] **Step 6: Verify the frontmatter and links**

```bash
cd d:/Projects/neo/dev-digest/.claude/skills/pr-self-review
head -6 SKILL.md
awk '/^description:/ {print length($0)}' SKILL.md
grep -ohE '\]\(([./a-zA-Z0-9_-]+\.md)\)' SKILL.md | sed -E 's/^\]\((.*)\)$/\1/' | sort -u | while read -r f; do
  [ -e "$f" ] || echo "DANGLING: $f"
done; echo done
```

Expected: a `---` line, `name: pr-self-review`, a single-line `description:`,
`allowed-tools:`, `---`; the description length printed as one number (one line,
not several); and `done` with no `DANGLING:` lines.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/pr-self-review/SKILL.md
git commit -m "feat(skills): add the pr-self-review skill

Five phases: collect the committed diff, run the deterministic checks, route
files to the skills that govern them, ground and merge the findings, draft the
PR description.

Phase 1 runs before any lane deliberately — a red typecheck is the common
failure and catching it costs no tokens. The grounding gate in Phase 4 is what
makes a blocking verdict safe: a finding that cannot cite a line in the diff is
discarded, not downgraded."
```

---

### Task 6: Wire into the catalog and prove the loop end to end

**Files:**
- Modify: `.claude/skills/README.md` (catalog table)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Add the catalog row**

In `.claude/skills/README.md`, add as the **last** row of the Catalog table, in
the `Shared` group next to `engineering-insights`:

```markdown
| [pr-self-review](pr-self-review/SKILL.md) | Shared | Pre-PR gate — routes the branch diff to the skills that govern it, blocks `gh pr create` on a critical finding |
```

- [ ] **Step 2: Verify the skill package is complete**

```bash
cd d:/Projects/neo/dev-digest/.claude/skills/pr-self-review
find . -type f | sort
```

Expected exactly:

```
./SKILL.md
./blockers.md
./report-template.md
./routing.md
```

- [ ] **Step 3: Prove the gate denies with no report**

```bash
cd d:/Projects/neo/dev-digest
rm -f .devdigest/pr-self-review/latest.json
echo '{"tool_name":"Bash","tool_input":{"command":"gh pr create --fill"}}' | node scripts/pr-self-review-gate.mjs
```

Expected: JSON with `"permissionDecision":"deny"` and a reason naming
`/pr-self-review`.

- [ ] **Step 4: Prove a fresh PASS report allows**

```bash
cd d:/Projects/neo/dev-digest
HEAD_SHA=$(git rev-parse HEAD)
mkdir -p .devdigest/pr-self-review
printf '{"head":"%s","base":"x","verdict":"PASS","dirty":false,"counts":{"critical":0,"high":0,"medium":0},"critical":[],"overrides":[],"report":"x.md"}' "$HEAD_SHA" > .devdigest/pr-self-review/latest.json
echo '{"tool_name":"Bash","tool_input":{"command":"gh pr create --fill"}}' | node scripts/pr-self-review-gate.mjs; echo "EXIT=$?"
```

Expected: no output, `EXIT=0` — allowed.

- [ ] **Step 5: Prove staleness is caught**

```bash
cd d:/Projects/neo/dev-digest
git commit --allow-empty -q -m "chore: staleness probe"
echo '{"tool_name":"Bash","tool_input":{"command":"gh pr create --fill"}}' | node scripts/pr-self-review-gate.mjs
git reset --hard -q HEAD~1
```

Expected: a deny whose reason contains `stale`. Then the `reset` removes the
probe commit — verify with `git log --oneline -1` that the top commit is Task
5's, not the probe.

- [ ] **Step 6: Prove a BLOCKED report denies, and an override releases it**

```bash
cd d:/Projects/neo/dev-digest
HEAD_SHA=$(git rev-parse HEAD)
printf '{"head":"%s","base":"x","verdict":"BLOCKED","dirty":false,"counts":{"critical":1,"high":0,"medium":0},"critical":[{"id":"CRIT-1","path":"a.ts","line":1,"summary":"probe"}],"overrides":[],"report":"x.md"}' "$HEAD_SHA" > .devdigest/pr-self-review/latest.json
echo '{"tool_name":"Bash","tool_input":{"command":"gh pr create --fill"}}' | node scripts/pr-self-review-gate.mjs; echo

printf '{"head":"%s","base":"x","verdict":"BLOCKED","dirty":false,"counts":{"critical":1,"high":0,"medium":0},"critical":[{"id":"CRIT-1","path":"a.ts","line":1,"summary":"probe"}],"overrides":[{"id":"CRIT-1","reason":"probe of the override path","at":"","head":"%s"}],"report":"x.md"}' "$HEAD_SHA" "$HEAD_SHA" > .devdigest/pr-self-review/latest.json
echo '{"tool_name":"Bash","tool_input":{"command":"gh pr create --fill"}}' | node scripts/pr-self-review-gate.mjs; echo "EXIT=$?"
```

Expected: the first prints a deny naming `CRIT-1`; the second prints nothing and
`EXIT=0`.

- [ ] **Step 7: Run the real skill against this very branch**

Invoke `/pr-self-review`.

Expected: every changed file lands in **not routed by design** (`scripts/**`,
`.claude/**`, `docs/**`, `.gitignore` is unrouted — see below), `unrouted` is
empty or holds only `.gitignore`, Phase 1 runs **no** commands because nothing
under `server/`, `client/`, `reviewer-core/`, or `e2e/` changed, both artifacts
are written, a `PASS` verdict block is printed, and a PR draft is produced.

If Phase 1 tries to run anything, the package-detection rule in `routing.md` is
matching too broadly — fix `routing.md`, not the skill.

- [ ] **Step 8: Clean up the probe artifacts**

```bash
cd d:/Projects/neo/dev-digest
git status --short
```

Expected: only `.claude/skills/README.md` modified. `.devdigest/` must not
appear — if it does, the `.gitignore` line from Task 2 is wrong.

- [ ] **Step 9: Run the full unit suite once more**

```bash
cd d:/Projects/neo/dev-digest
node --test scripts/
```

Expected: 15 tests pass.

- [ ] **Step 10: Commit**

```bash
git add .claude/skills/README.md
git commit -m "docs: add pr-self-review to the skill catalog

Listed under Shared rather than Backend or Frontend: it is the skill that
routes to the others, so it has no domain of its own."
```

---

## Verification summary

The work is done when all of these hold:

| Check | Command | Expected |
|---|---|---|
| Gate logic is tested | `node --test scripts/` | 15 tests pass |
| Gate denies with no report | Task 6 Step 3 | deny naming `/pr-self-review` |
| Gate allows on a fresh PASS | Task 6 Step 4 | no output, exit 0 |
| Gate catches a stale report | Task 6 Step 5 | deny containing `stale` |
| Override releases a block | Task 6 Step 6 | deny, then allow |
| Hook is live in-session | Task 2 Step 3 | `echo "gh pr create"` is denied |
| Ordinary commands unaffected | Task 2 Step 3 | `git status --short` runs |
| Skill package is complete | Task 6 Step 2 | exactly four files |
| Artifacts are ignored | Task 6 Step 8 | `.devdigest/` absent from `git status` |
| No lockfile was created | `git status --short` | no `package-lock.json` / `pnpm-lock.yaml` at the repo root |

## Out of scope (do not do these)

- A CI workflow duplicating the review. This is a local pre-PR gate.
- A `pre-push` git hook running headless `claude -p`.
- Reviewing uncommitted changes. They are recorded as `dirty: true` and nothing
  more.
- A persistent allowlist or baseline for legacy findings. The scope is changed
  lines only, so legacy code cannot block. If that turns out to be wrong, add one
  later with the `depcruise` rule: it may only shrink.
- Editing any vendored skill, or `skills-lock.json`.
- Auto-fixing findings. The skill reports; fixing is a separate decision.
- Adding a root `package.json`. The gate script is dependency-free for exactly
  this reason.
