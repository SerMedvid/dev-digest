# Blockers — what makes a finding CRITICAL

## The rule, stated once

A finding is `CRITICAL` **only if it matches an entry in the table below.**

There is no judgement call and no "this feels critical". The list is closed. If
a finding does not match a row, it is not critical, however serious it reads.

Everything else is:

- `HIGH` — should be fixed before merge, does **not** block;
- `MEDIUM` — worth knowing, does **not** block.

Only `CRITICAL` produces a `BLOCKED` verdict, and only a `BLOCKED` verdict stops
`gh pr create`. That is why the list is closed: the verdict blocks a merge, and
an open-ended severity scale makes that unpredictable between two runs of the
same diff.

## The nine blockers

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

## Why B1 is not overridable

Every other row is a model judgement, and a model judgement can be wrong — so it
can be waived with a reason a human writes down.

B1 is not a judgement. A red typecheck or a red `arch:check` is a fact the
machine reported, and the fix is to fix it. There is nothing for a reason string
to add.

## Explicit non-blockers

These are never `CRITICAL`, no matter how a lane phrases them. Listed so lanes
stop reaching for the severity that blocks:

- style, formatting, naming;
- a missing test;
- a large function, a long file, duplication;
- a `MEDIUM`-tagged rule from `react-best-practices` — or any rule from any
  skill whose own severity scale is not this one;
- a theoretical vulnerability with no traced attacker-controlled input;
- anything in a file the diff does not touch;
- anything in a test fixture.

`react-best-practices` uses the word `CRITICAL` for its own rules. That scale is
not this scale. Do not carry those labels across.

## The finding-ID scheme

After the grounding gate and dedupe, sort all surviving findings by:

1. severity — `CRITICAL`, then `HIGH`, then `MEDIUM`;
2. `path`, ascending;
3. `line`, ascending.

Then number within each severity: `CRIT-1`, `CRIT-2`, …, `HIGH-1`, …, `MED-1`, …

Sorting first is the whole point. An override names an ID, and an ID is only
worth naming if the same diff produces the same ID on the next run.
