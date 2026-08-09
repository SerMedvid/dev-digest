import { describe, it, expect } from 'vitest';
import { ok, fail, ToolError, toToolResult } from '../src/errors.js';
import { ApiHttpError, ApiUnavailableError } from '../src/api.js';

describe('ok', () => {
  it('carries the data both as JSON text and as structuredContent', () => {
    const result = ok({ verdict: 'approve', findings: [] });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ verdict: 'approve', findings: [] });
    expect(JSON.parse(result.content[0]!.text)).toEqual({ verdict: 'approve', findings: [] });
  });
});

describe('fail', () => {
  it('marks isError and appends the next step to the message', () => {
    const result = fail('Agent "Secrity" not found.', 'Call devdigest_list_agents for exact names.');
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(
      'Agent "Secrity" not found.\n\nNext: Call devdigest_list_agents for exact names.',
    );
  });
});

describe('toToolResult', () => {
  it('renders a ToolError with its own next step', () => {
    const err = new ToolError('PR #999 is not imported.', 'Import it in DevDigest, then retry.');
    expect(toToolResult(err).content[0]!.text).toBe(
      'PR #999 is not imported.\n\nNext: Import it in DevDigest, then retry.',
    );
  });

  it('tells the user to start the API when it is unreachable', () => {
    const result = toToolResult(new ApiUnavailableError('http://localhost:3001', new Error('boom')));
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('pnpm --dir server dev');
  });

  it('surfaces the API message and points at a retry for an HTTP error', () => {
    const result = toToolResult(new ApiHttpError(500, 'internal', 'Reviewer exploded'));
    expect(result.content[0]!.text).toContain('Reviewer exploded');
    expect(result.content[0]!.text).toContain('Next:');
  });

  it('never leaks a raw stack for an unknown error', () => {
    const result = toToolResult(new Error('kaboom'));
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('kaboom');
    expect(result.content[0]!.text).not.toContain('at Object.');
  });
});
