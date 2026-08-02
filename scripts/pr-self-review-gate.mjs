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
