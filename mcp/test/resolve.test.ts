import { describe, it, expect } from 'vitest';
import { resolveRepo, resolvePull, resolveAgent } from '../src/resolve.js';
import { ToolError } from '../src/errors.js';
import { makeFakeApi } from './helpers/fake-api.js';

describe('resolveRepo', () => {
  it('matches a slug case-insensitively', async () => {
    const api = makeFakeApi();
    await expect(resolveRepo(api, 'ACME/Payments-API')).resolves.toMatchObject({ id: 'repo-1' });
  });

  it('lists the available slugs when nothing matches', async () => {
    const api = makeFakeApi();
    const err = await resolveRepo(api, 'acme/payments').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).message).toContain('acme/payments');
    expect((err as ToolError).next).toContain('acme/payments-api');
  });

  it('says the workspace is empty when no repo is imported', async () => {
    const api = makeFakeApi({ repos: [] });
    const err = await resolveRepo(api, 'acme/payments-api').catch((e: unknown) => e);
    expect((err as ToolError).next).toContain('Import a repository');
  });
});

describe('resolvePull', () => {
  const repo = { id: 'repo-1', owner: 'acme', name: 'payments-api', full_name: 'acme/payments-api' };

  it('finds a PR by number', async () => {
    const api = makeFakeApi();
    await expect(resolvePull(api, repo, 482)).resolves.toEqual({
      id: 'pr-1',
      number: 482,
      title: 'Add refund endpoint',
    });
  });

  it('rejects a PR that exists on GitHub but was never imported (id is null)', async () => {
    const api = makeFakeApi({ pulls: { 'repo-1': [{ id: null, number: 900, title: 'Draft' }] } });
    const err = await resolvePull(api, repo, 900).catch((e: unknown) => e);
    expect((err as ToolError).message).toContain('not imported');
  });

  it('rejects a PR whose id is undefined, not just null', async () => {
    const api = makeFakeApi({
      pulls: { 'repo-1': [{ id: undefined, number: 901, title: 'Draft' }] },
    });
    const err = await resolvePull(api, repo, 901).catch((e: unknown) => e);
    expect((err as ToolError).message).toContain('not imported');
  });

  it('lists nearby PR numbers when the number is unknown', async () => {
    const api = makeFakeApi();
    const err = await resolvePull(api, repo, 999).catch((e: unknown) => e);
    expect((err as ToolError).next).toContain('482');
  });
});

describe('resolveAgent', () => {
  it('matches an agent by name, case-insensitively', async () => {
    const api = makeFakeApi();
    await expect(resolveAgent(api, 'security reviewer')).resolves.toMatchObject({ id: 'agent-1' });
  });

  it('matches an agent by id', async () => {
    const api = makeFakeApi();
    await expect(resolveAgent(api, 'agent-1')).resolves.toMatchObject({ name: 'Security Reviewer' });
  });

  it('points at list_agents with the available names when nothing matches', async () => {
    const api = makeFakeApi();
    const err = await resolveAgent(api, 'Secrity').catch((e: unknown) => e);
    expect((err as ToolError).next).toContain('devdigest_list_agents');
    expect((err as ToolError).next).toContain('Security Reviewer');
  });

  it('refuses a disabled agent and says where to enable it', async () => {
    const api = makeFakeApi({
      agents: [
        {
          id: 'agent-1',
          name: 'Security Reviewer',
          description: '',
          provider: 'anthropic',
          model: 'claude-opus-5',
          enabled: false,
        },
      ],
    });
    const err = await resolveAgent(api, 'Security Reviewer').catch((e: unknown) => e);
    expect((err as ToolError).message).toContain('disabled');
  });
});
