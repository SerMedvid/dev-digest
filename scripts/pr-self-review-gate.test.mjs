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
