export interface McpConfig {
  /** DevDigest API base URL, no trailing slash. */
  apiUrl: string;
  /** How long `run_agent_on_pr` waits for a run before handing back a run_id. */
  waitSeconds: number;
  /** Poll cadence while waiting for a run to reach a terminal state. */
  pollIntervalMs: number;
}

const DEFAULTS: McpConfig = {
  apiUrl: 'http://localhost:3001',
  waitSeconds: 120,
  pollIntervalMs: 2000,
};

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: Record<string, string | undefined>): McpConfig {
  const url = env.DEVDIGEST_API_URL?.trim();
  return {
    apiUrl: url ? url.replace(/\/+$/, '') : DEFAULTS.apiUrl,
    waitSeconds: positiveNumber(env.DEVDIGEST_WAIT_SECONDS, DEFAULTS.waitSeconds),
    pollIntervalMs: positiveNumber(env.DEVDIGEST_POLL_INTERVAL_MS, DEFAULTS.pollIntervalMs),
  };
}
