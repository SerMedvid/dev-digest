import { HttpApiClient } from '../api.js';
import { loadConfig } from '../config.js';
import { parseArgs, USAGE } from './args.js';
import { repoRoot, untrackedCount, workingDiff } from './git.js';
import { runReviewCommand } from './run.js';

/**
 * `devdigest review --mode working [--agent <name>]`
 *
 * This module RUNS on import — it is the entrypoint `bin/devdigest.mjs` loads,
 * and that shim (not this file) is `argv[1]`, so an "am I the entrypoint?"
 * guard here could never match. Everything testable lives in `args.ts` and
 * `run.ts` instead; this file is only composition.
 *
 * stdout carries the review payload only; every diagnostic goes to stderr —
 * the same discipline `src/main.ts` applies for the JSON-RPC channel.
 */
/**
 * Set `process.exitCode` and RETURN — never `process.exit()`.
 *
 * `process.exit()` tears the process down while tsx's ESM loader thread is
 * still live, which on Windows trips a libuv assertion
 * (`!(handle->flags & UV_HANDLE_CLOSING)`) and replaces our exit code with
 * 127. Since the exit code IS this command's contract, that turns "no
 * blockers" into "the tool broke". Letting the loop drain naturally keeps the
 * code we chose on every platform.
 */
async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    if (parsed.message === null) {
      process.stdout.write(USAGE);
      return;
    }
    process.stderr.write(`${parsed.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  const config = loadConfig(process.env);
  process.exitCode = await runReviewCommand(parsed.opts, {
    git: { repoRoot, workingDiff, untrackedCount },
    api: new HttpApiClient(config.apiUrl),
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    cwd: process.cwd(),
  });
}

await main();
