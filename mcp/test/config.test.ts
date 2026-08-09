import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('defaults to localhost:3001 with a 120s wait budget', () => {
    expect(loadConfig({})).toEqual({
      apiUrl: 'http://localhost:3001',
      waitSeconds: 120,
      pollIntervalMs: 2000,
    });
  });

  it('reads overrides from the environment', () => {
    const cfg = loadConfig({
      DEVDIGEST_API_URL: 'http://127.0.0.1:4000/',
      DEVDIGEST_WAIT_SECONDS: '30',
      DEVDIGEST_POLL_INTERVAL_MS: '500',
    });
    expect(cfg).toEqual({
      apiUrl: 'http://127.0.0.1:4000',
      waitSeconds: 30,
      pollIntervalMs: 500,
    });
  });

  it('falls back to the default when a numeric var is not a positive number', () => {
    expect(loadConfig({ DEVDIGEST_WAIT_SECONDS: 'soon' }).waitSeconds).toBe(120);
    expect(loadConfig({ DEVDIGEST_POLL_INTERVAL_MS: '0' }).pollIntervalMs).toBe(2000);
  });
});
