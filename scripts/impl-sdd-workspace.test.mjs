import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveWorkspace, slugFor } from './impl-sdd-workspace.mjs';

const CWD = path.resolve('/repo');
const PLAN = 'docs/superpowers/plans/2026-08-13-impl-sdd.md';

test('slug is the plan basename without extension', () => {
  assert.equal(slugFor(PLAN), '2026-08-13-impl-sdd');
});

test('slug rejects a traversing path', () => {
  assert.throws(() => slugFor('../../etc/passwd'), TypeError);
});

test('slug rejects an absolute path', () => {
  assert.throws(() => slugFor(path.resolve('/etc/passwd')), TypeError);
});

test('workspace roots under .devdigest/impl-sdd/<slug>', () => {
  const ws = resolveWorkspace(PLAN, { cwd: CWD, create: false });
  assert.equal(ws.root, path.join(CWD, '.devdigest', 'impl-sdd', '2026-08-13-impl-sdd'));
  assert.equal(ws.ledger, path.join(ws.root, 'ledger.md'));
  assert.equal(ws.briefs, path.join(ws.root, 'briefs'));
  assert.equal(ws.reports, path.join(ws.root, 'reports'));
  assert.equal(ws.findings, path.join(ws.root, 'findings.md'));
});

test('paths are joined, never concatenated', () => {
  const ws = resolveWorkspace(PLAN, { cwd: CWD, create: false });
  assert.equal(ws.root.includes('//'), false);
  assert.equal(ws.root.includes('\\\\'), false);
});

test('resolveWorkspace does not touch the filesystem when create is false', () => {
  const ws = resolveWorkspace(PLAN, { cwd: path.resolve('/definitely/missing'), create: false });
  assert.equal(typeof ws.root, 'string');
});
