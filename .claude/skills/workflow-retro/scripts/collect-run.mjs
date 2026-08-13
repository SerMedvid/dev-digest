#!/usr/bin/env node
// Collects deterministic metrics for one multi-agent run.
//
// Reads the Claude Code transcripts for this project and emits a compact JSON
// document: per-agent tokens, timings, tool profile, launch waves, critical
// path and cross-agent file overlap. Nothing here is a judgement call — the
// qualitative pass is a separate step that reads the transcripts directly.
//
// Usage:
//   node collect-run.mjs [--session <id>] [--out <path>] [--cwd <dir>] [--quiet]
//
// Exit codes: 0 ok, 1 nothing to analyse, 2 bad arguments.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const AGENT_TOOLS = new Set(['Task', 'Agent']);
const READ_TOOLS = new Set(['Read', 'NotebookRead']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob']);
const EMPTY_RESULT = /^\s*$|no files found|no matches found|found 0 |does not exist|no content/i;

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = { session: null, out: null, cwd: process.cwd(), quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--quiet') { args.quiet = true; continue; }
    const value = argv[i + 1];
    if (flag === '--session' || flag === '--out' || flag === '--cwd') {
      if (!value) throw new Error(`${flag} needs a value`);
      args[flag.slice(2)] = value;
      i++;
      continue;
    }
    throw new Error(`unknown argument: ${flag}`);
  }
  return args;
}

// ------------------------------------------------------------ locating data

/** Claude Code encodes the project path by replacing every separator with `-`. */
function slugify(dir) {
  return dir.replace(/[:\\/]/g, '-');
}

function sameDir(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/**
 * Find the transcript directory for `cwd`. Tries the slug first, then falls
 * back to reading the `cwd` field out of each candidate's newest transcript —
 * the slug encoding is an implementation detail and may change.
 */
function findProjectDir(cwd) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(root)) return null;

  const bySlug = path.join(root, slugify(cwd));
  if (fs.existsSync(bySlug)) return bySlug;

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const newest = listSessions(dir)[0];
    if (!newest) continue;
    const first = readFirstRecord(newest.file);
    if (first?.cwd && sameDir(first.cwd, cwd)) return dir;
  }
  return null;
}

/** Session transcripts are `<id>.jsonl` files, newest first. */
function listSessions(projectDir) {
  return fs
    .readdirSync(projectDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
    .map((e) => {
      const file = path.join(projectDir, e.name);
      return { id: e.name.replace(/\.jsonl$/, ''), file, mtime: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function readRecords(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a partially written tail line */ }
  }
  return out;
}

function readFirstRecord(file) {
  const handle = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    const read = fs.readSync(handle, buf, 0, buf.length, 0);
    const line = buf.subarray(0, read).toString('utf8').split('\n')[0];
    return JSON.parse(line);
  } catch {
    return null;
  } finally {
    fs.closeSync(handle);
  }
}

// -------------------------------------------------------------- main branch

/** Agent dispatches as seen from the orchestrator: order, prompt, completion. */
function collectDispatches(records) {
  const dispatches = [];
  const byToolUseId = new Map();

  for (const record of records) {
    const content = record?.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type === 'tool_use' && AGENT_TOOLS.has(block.name)) {
        const dispatch = {
          toolUseId: block.id,
          dispatchedAt: record.timestamp ?? null,
          completedAt: null,
          subagentType: block.input?.subagent_type ?? null,
          description: block.input?.description ?? null,
          prompt: block.input?.prompt ?? '',
          background: block.input?.run_in_background === true,
        };
        dispatches.push(dispatch);
        byToolUseId.set(block.id, dispatch);
      }
      if (block.type === 'tool_result' && byToolUseId.has(block.tool_use_id)) {
        byToolUseId.get(block.tool_use_id).completedAt = record.timestamp ?? null;
      }
    }
  }
  return dispatches;
}

/** Workflow tool invocations, so a Workflow-driven run is labelled as one. */
function collectWorkflowCalls(records) {
  const calls = [];
  for (const record of records) {
    const content = record?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_use' && block.name === 'Workflow') {
        calls.push({
          at: record.timestamp ?? null,
          name: block.input?.name ?? null,
          scriptPath: block.input?.scriptPath ?? null,
          resumeFromRunId: block.input?.resumeFromRunId ?? null,
        });
      }
    }
  }
  return calls;
}

// ------------------------------------------------------------- agent branch

function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
}

function addUsage(tokens, usage) {
  tokens.input += usage.input_tokens ?? 0;
  tokens.output += usage.output_tokens ?? 0;
  tokens.cacheRead += usage.cache_read_input_tokens ?? 0;
  tokens.cacheCreation += usage.cache_creation_input_tokens ?? 0;
}

function inputPath(name, input) {
  if (!input) return null;
  if (READ_TOOLS.has(name) || WRITE_TOOLS.has(name)) return input.file_path ?? input.notebook_path ?? null;
  return null;
}

/**
 * One subagent transcript → one agent record.
 *
 * Usage is deduplicated by `message.id`: a single assistant message is written
 * across several lines as it streams, each carrying a usage block, and summing
 * them multiplies the real cost. The last line for an id holds the final usage.
 */
function readAgentTranscript(file) {
  const records = readRecords(file);
  if (records.length === 0) return null;

  const first = records[0];
  const agent = {
    agentId: first.agentId ?? path.basename(file).replace(/^agent-|\.jsonl$/g, ''),
    transcript: file,
    type: null,
    model: null,
    effort: null,
    prompt: typeof first?.message?.content === 'string' ? first.message.content : '',
    startedAt: first.timestamp ?? null,
    endedAt: null,
    durationMs: null,
    tokens: emptyTokens(),
    turns: 0,
    toolCalls: {},
    filesRead: [],
    filesWritten: [],
    searches: 0,
    emptyResults: 0,
    repeatedCalls: 0,
    finalTextChars: 0,
    truncated: false,
  };

  const usageByMessage = new Map();
  const seenCalls = new Set();
  const filesRead = new Set();
  const filesWritten = new Set();
  let lastText = '';

  for (const record of records) {
    if (record.timestamp) agent.endedAt = record.timestamp;
    if (record.attributionAgent && !agent.type) agent.type = record.attributionAgent;
    if (record.effort && !agent.effort) agent.effort = record.effort;

    const message = record.message;
    if (!message) continue;
    if (message.model && !agent.model) agent.model = message.model;
    if (message.id && message.usage) usageByMessage.set(message.id, message.usage);

    const content = message.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type === 'text' && record.type === 'assistant') lastText = block.text ?? '';

      if (block.type === 'tool_use') {
        agent.toolCalls[block.name] = (agent.toolCalls[block.name] ?? 0) + 1;

        const fingerprint = `${block.name}:${JSON.stringify(block.input ?? {})}`;
        if (seenCalls.has(fingerprint)) agent.repeatedCalls++;
        seenCalls.add(fingerprint);

        if (SEARCH_TOOLS.has(block.name)) agent.searches++;
        const target = inputPath(block.name, block.input);
        if (target && READ_TOOLS.has(block.name)) filesRead.add(path.resolve(target));
        if (target && WRITE_TOOLS.has(block.name)) filesWritten.add(path.resolve(target));
      }

      if (block.type === 'tool_result') {
        const text = typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content.map((c) => c.text ?? '').join('')
            : '';
        if (EMPTY_RESULT.test(text.slice(0, 200))) agent.emptyResults++;
      }
    }
  }

  agent.turns = usageByMessage.size;
  for (const usage of usageByMessage.values()) addUsage(agent.tokens, usage);
  agent.filesRead = [...filesRead].sort();
  agent.filesWritten = [...filesWritten].sort();
  agent.finalTextChars = lastText.length;
  agent.truncated = lastText.length === 0;

  if (agent.startedAt && agent.endedAt) {
    agent.durationMs = Date.parse(agent.endedAt) - Date.parse(agent.startedAt);
  }
  return agent;
}

function readAgents(sessionDir) {
  const dir = path.join(sessionDir, 'subagents');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('agent-') && name.endsWith('.jsonl'))
    .map((name) => readAgentTranscript(path.join(dir, name)))
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.startedAt ?? 0) - Date.parse(b.startedAt ?? 0));
}

/**
 * The orchestrator transcript records no agentId, so a dispatch is matched to
 * its transcript by the prompt — the subagent's first user message is that
 * prompt verbatim. Falls back to the subagent type plus dispatch order.
 */
function linkDispatches(agents, dispatches) {
  const unmatched = [...dispatches];

  for (const agent of agents) {
    const key = agent.prompt.trim();
    let index = unmatched.findIndex((d) => d.prompt.trim() === key);
    if (index === -1 && key) {
      index = unmatched.findIndex((d) => d.prompt.trim().slice(0, 400) === key.slice(0, 400));
    }
    if (index === -1) {
      index = unmatched.findIndex((d) => d.subagentType && d.subagentType === agent.type);
    }
    if (index === -1) continue;

    const [dispatch] = unmatched.splice(index, 1);
    agent.label = dispatch.description ?? agent.type ?? agent.agentId;
    agent.type = agent.type ?? dispatch.subagentType;
    agent.dispatchedAt = dispatch.dispatchedAt;
    agent.background = dispatch.background;
  }

  for (const agent of agents) agent.label = agent.label ?? agent.type ?? agent.agentId;
  return unmatched;
}

// ----------------------------------------------------------------- journal

/**
 * Workflow runs write a journal.jsonl next to the transcripts. Its schema is
 * not pinned here — the fields below are read when present and the whole thing
 * is reported as unparsed rather than guessed at when the shape is unfamiliar.
 */
function readJournal(sessionDir) {
  const file = path.join(sessionDir, 'journal.jsonl');
  if (!fs.existsSync(file)) return null;

  const records = readRecords(file);
  const entries = records.map((r) => ({
    label: r.label ?? r.agentLabel ?? null,
    phase: r.phase ?? null,
    at: r.timestamp ?? r.at ?? null,
    kind: r.type ?? r.event ?? null,
  }));
  const recognised = entries.filter((e) => e.label || e.phase).length;

  return {
    file,
    records: records.length,
    parsed: recognised > 0,
    entries: recognised > 0 ? entries : [],
    note: recognised > 0
      ? null
      : 'journal.jsonl present but no recognised fields — read it directly in the qualitative pass',
  };
}

// ------------------------------------------------------------------ derived

/**
 * A wave ends where a barrier is: the next agent starts only after every agent
 * in the current wave has finished. Agents overlapping in time share a wave.
 */
function buildWaves(agents) {
  const timed = agents.filter((a) => a.startedAt && a.endedAt);
  const waves = [];
  let current = null;

  for (const agent of timed) {
    const start = Date.parse(agent.startedAt);
    if (current && start < current.endsAt) {
      current.agents.push(agent.label);
      current.endsAt = Math.max(current.endsAt, Date.parse(agent.endedAt));
      if (Date.parse(agent.endedAt) === current.endsAt) current.slowest = agent.label;
      continue;
    }
    current = {
      wave: waves.length + 1,
      startsAt: start,
      endsAt: Date.parse(agent.endedAt),
      agents: [agent.label],
      slowest: agent.label,
    };
    waves.push(current);
  }

  return waves.map((w) => ({
    wave: w.wave,
    agents: w.agents,
    slowest: w.slowest,
    spanMs: w.endsAt - w.startsAt,
  }));
}

/** Files more than one agent read, with a rough cost of having read them twice. */
function fileOverlap(agents) {
  const readers = new Map();
  for (const agent of agents) {
    for (const file of agent.filesRead) {
      if (!readers.has(file)) readers.set(file, []);
      readers.get(file).push(agent.label);
    }
  }

  const overlap = [];
  for (const [file, who] of readers) {
    if (who.length < 2) continue;
    let approxTokens = null;
    try { approxTokens = Math.round(fs.statSync(file).size / 4); } catch { /* file is gone */ }
    overlap.push({
      file,
      readers: who,
      rereads: who.length - 1,
      approxWastedTokens: approxTokens === null ? null : approxTokens * (who.length - 1),
    });
  }
  return overlap.sort((a, b) => (b.approxWastedTokens ?? 0) - (a.approxWastedTokens ?? 0));
}

function summarise(agents, waves) {
  const totals = emptyTokens();
  for (const agent of agents) {
    totals.input += agent.tokens.input;
    totals.output += agent.tokens.output;
    totals.cacheRead += agent.tokens.cacheRead;
    totals.cacheCreation += agent.tokens.cacheCreation;
  }

  const durations = agents.map((a) => a.durationMs ?? 0);
  const agentTimeMs = durations.reduce((a, b) => a + b, 0);
  const wallClockMs = waves.reduce((sum, w) => sum + w.spanMs, 0);

  return {
    agents: agents.length,
    tokens: totals,
    billableTokens: totals.input + totals.output + totals.cacheCreation,
    agentTimeMs,
    wallClockMs,
    parallelSpeedup: wallClockMs > 0 ? Number((agentTimeMs / wallClockMs).toFixed(2)) : null,
    criticalPath: waves.map((w) => w.slowest),
  };
}

// -------------------------------------------------------------------- entry

function collect({ session, cwd }) {
  const projectDir = findProjectDir(cwd);
  if (!projectDir) throw new Error(`no transcripts found for ${cwd}`);

  const sessions = listSessions(projectDir);
  const target = session ? sessions.find((s) => s.id === session) : sessions[0];
  if (!target) throw new Error(session ? `session ${session} not found` : 'no sessions recorded');

  const sessionDir = path.join(projectDir, target.id);
  const records = readRecords(target.file);
  const dispatches = collectDispatches(records);
  const workflowCalls = collectWorkflowCalls(records);
  const agents = readAgents(sessionDir);
  const orphanDispatches = linkDispatches(agents, dispatches);
  const waves = buildWaves(agents);

  return {
    run: {
      sessionId: target.id,
      transcript: target.file,
      sessionDir: fs.existsSync(sessionDir) ? sessionDir : null,
      cwd,
      mode: workflowCalls.length > 0 ? 'workflow' : 'agent-fanout',
      workflowCalls,
      startedAt: agents[0]?.startedAt ?? dispatches[0]?.dispatchedAt ?? null,
      endedAt: agents.at(-1)?.endedAt ?? null,
    },
    summary: summarise(agents, waves),
    waves,
    agents: agents.map(({ transcript, prompt, ...rest }) => ({
      ...rest,
      transcript,
      promptChars: prompt.length,
      promptHead: prompt.slice(0, 300),
    })),
    fileOverlap: fileOverlap(agents),
    orphanDispatches: orphanDispatches.map((d) => ({
      description: d.description,
      subagentType: d.subagentType,
      dispatchedAt: d.dispatchedAt,
      note: 'dispatched but no matching subagent transcript — still running, or killed',
    })),
    journal: readJournal(sessionDir),
  };
}

function printSummary(report) {
  const { run, summary, waves } = report;
  const k = (n) => `${(n / 1000).toFixed(1)}k`;

  console.log(`run       ${run.sessionId} (${run.mode})`);
  console.log(`agents    ${summary.agents} in ${waves.length} wave(s)`);
  console.log(
    `tokens    in ${k(summary.tokens.input)} · out ${k(summary.tokens.output)} · ` +
    `cache-write ${k(summary.tokens.cacheCreation)} · cache-read ${k(summary.tokens.cacheRead)}`,
  );
  console.log(`billable  ${k(summary.billableTokens)} (cache reads excluded)`);
  console.log(
    `time      ${Math.round(summary.wallClockMs / 1000)}s wall / ` +
    `${Math.round(summary.agentTimeMs / 1000)}s agent (${summary.parallelSpeedup}x)`,
  );
  if (report.fileOverlap.length > 0) {
    console.log(`overlap   ${report.fileOverlap.length} file(s) read by more than one agent`);
  }
  if (report.orphanDispatches.length > 0) {
    console.log(`orphans   ${report.orphanDispatches.length} dispatch(es) with no transcript`);
  }
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`${err.message}\nusage: collect-run.mjs [--session <id>] [--out <path>] [--cwd <dir>] [--quiet]`);
    return 2;
  }

  let report;
  try {
    report = collect(args);
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  if (report.summary.agents === 0 && report.orphanDispatches.length === 0) {
    console.error(`session ${report.run.sessionId} ran no subagents — nothing to analyse`);
    return 1;
  }

  const out = args.out ?? path.join(args.cwd, '.devdigest', 'workflow-retro', `run-${report.run.sessionId}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (!args.quiet) {
    printSummary(report);
    console.log(`written   ${out}`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}

export { collect, findProjectDir, buildWaves, fileOverlap };
