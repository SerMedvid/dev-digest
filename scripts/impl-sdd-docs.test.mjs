/**
 * Structural invariants of the /impl-sdd skill.
 *
 * The spec fixes a vocabulary — six phase ids, four triage buckets, three caps,
 * an event list — and every one of them is quoted across four files. Prose stays
 * a human's job; these assertions exist so a rename in one file cannot drift
 * silently away from the others.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const DIR = path.join('.claude', 'skills', 'impl-sdd');
const read = (f) => readFileSync(path.join(DIR, f), 'utf8');

test('the skill folder holds the command and its companions', () => {
  assert.equal(existsSync(path.join(DIR, 'SKILL.md')), true);
  assert.equal(existsSync(path.join(DIR, 'phases.md')), true);
});

test('the six phase ids appear, and no seventh', () => {
  const all = readdirSync(DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => read(f))
    .join('\n');
  const ids = [...new Set(all.match(/\bP[0-9]\b/g) ?? [])].sort();
  assert.deepEqual(ids, ['P0', 'P1', 'P2', 'P3', 'P4', 'P5']);
});

test('every argument the spec names is documented', () => {
  const skill = read('SKILL.md');
  for (const arg of ['--plan', '--spec', '--from', '--mode', '--dry-run']) {
    assert.ok(skill.includes(arg), `SKILL.md does not document ${arg}`);
  }
});

test('the prohibitions are stated in the command body', () => {
  const skill = read('SKILL.md');
  for (const verb of ['git commit', 'git push', 'worktree', 'arch:baseline', 'docker compose down -v']) {
    assert.ok(skill.includes(verb), `SKILL.md does not forbid ${verb}`);
  }
});

test('the ledger documents its grammar and its event vocabulary', () => {
  const ledger = read('ledger.md');
  assert.ok(ledger.includes('<ISO8601> · <Pn> · <event> · <subject> · <outcome>'));
  for (const event of ['task-start', 'task-done', 'phase-verify', 'finding', 'round', 'retry', 'ruling', 'stop']) {
    assert.ok(ledger.includes(event), `ledger.md does not define the ${event} event`);
  }
});

test('briefs.md carries the three templates', () => {
  const briefs = read('briefs.md');
  for (const heading of ['## Task brief', '## Remediation brief', '## Review surface']) {
    assert.ok(briefs.includes(heading), `briefs.md is missing ${heading}`);
  }
});

test('remediation defines exactly the four buckets and the caps', () => {
  const rem = read('remediation.md');
  for (const bucket of ['must-fix', 'fix-in-scope', 'defer', 'conflict']) {
    assert.ok(rem.includes(bucket), `remediation.md does not define ${bucket}`);
  }
  assert.ok(/three rounds|R = 1\.\.3|round 3/i.test(rem), 'the 3-round cap is not stated');
  assert.ok(/retry it exactly once|exactly one retry|retried once|retried exactly once/i.test(rem), 'the single retry is not stated');
});

test('findings.md columns are fixed', () => {
  const rem = read('remediation.md');
  for (const col of ['id', 'source', 'severity', 'file:line', 'bucket']) {
    assert.ok(rem.includes(col), `remediation.md does not name the ${col} column`);
  }
});

test('every relative link in the skill resolves', () => {
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
    const body = read(file);
    for (const [, target] of body.matchAll(/\]\((?!https?:)([^)#]+)(?:#[^)]*)?\)/g)) {
      const resolved = path.resolve(DIR, target);
      assert.ok(existsSync(resolved), `${file} links to a missing path: ${target}`);
    }
  }
});
