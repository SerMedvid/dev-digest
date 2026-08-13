#!/usr/bin/env node
/**
 * Workspace resolver for the /impl-sdd command.
 *
 * Every artifact of one run — ledger, briefs, reports, findings — lives under
 * .devdigest/impl-sdd/<plan-basename>/. One plan owns one directory; another
 * plan's directory is never read or written by this run.
 *
 * The plan path arrives from a command argument and names a directory this
 * script creates, so it is validated before use: no absolute paths, no `..`.
 */
import { mkdirSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function slugFor(planPath) {
  if (typeof planPath !== 'string' || planPath.length === 0) {
    throw new TypeError('plan path must be a non-empty repo-relative string');
  }
  if (path.isAbsolute(planPath) || planPath.split(/[\\/]/).includes('..')) {
    throw new TypeError(`plan path must be repo-relative and must not traverse: ${planPath}`);
  }
  return path.basename(planPath, '.md');
}

export function resolveWorkspace(planPath, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const create = opts.create ?? true;
  const root = path.join(cwd, '.devdigest', 'impl-sdd', slugFor(planPath));
  const ws = {
    root,
    ledger: path.join(root, 'ledger.md'),
    briefs: path.join(root, 'briefs'),
    reports: path.join(root, 'reports'),
    findings: path.join(root, 'findings.md'),
  };
  if (create) {
    mkdirSync(ws.briefs, { recursive: true });
    mkdirSync(ws.reports, { recursive: true });
    // Never truncate: a resumed run appends to the ledger it already has.
    if (!existsSync(ws.ledger)) appendFileSync(ws.ledger, `# Ledger — ${slugFor(planPath)}\n\n`);
  }
  return ws;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error('usage: node scripts/impl-sdd-workspace.mjs <plan-path>');
    process.exit(1);
  }
  console.log(JSON.stringify(resolveWorkspace(planPath), null, 2));
}
