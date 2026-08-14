import { describe, it, expect } from 'vitest';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { OnboardingModel } from '../src/modules/onboarding/model.js';
import type { FactsSkeleton } from '../src/modules/onboarding/domain.js';

const facts: FactsSkeleton = {
  criticalPaths: [{ path: 'src/server.ts', percentile: 99 }],
  readingPath: [{ path: 'src/server.ts', percentile: 99 }],
  chains: [['src/server.ts', 'src/middleware/auth.ts']],
  commands: ['pnpm install', 'pnpm dev'],
  repoMap: 'MAP',
  indexedFiles: 10,
  indexSha: 'sha-1',
};

const fixture = {
  architecture: { body: 'It is a Node service.', diagram: 'flowchart LR\n  A --> B' },
  critical_paths: [{ path: 'src/server.ts', note: 'App bootstrap' }],
  reading_path: [{ path: 'src/server.ts', note: 'The whole lifecycle in one file' }],
  commands: [{ index: 1, comment: 'http://localhost:3000' }],
  first_tasks: [
    { title: 'Add a health route', body: 'Mirror the existing ones.', path: 'src/server.ts' },
  ],
};

function provider() {
  return new MockLLMProvider('openai', { structuredBySchema: { OnboardingTour: fixture } });
}

describe('OnboardingModel', () => {
  it('makes exactly one structured call, under the OnboardingTour schema', async () => {
    const llm = provider();
    await new OnboardingModel(llm, 'openai', 'gpt-4.1').write(facts, 'English');
    const structured = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structured).toHaveLength(1);
    expect((structured[0]!.req as { schemaName: string }).schemaName).toBe('OnboardingTour');
  });

  it('maps the response onto the Narrative shape', async () => {
    const narrative = await new OnboardingModel(provider(), 'openai', 'gpt-4.1').write(
      facts,
      'English',
    );
    expect(narrative.architecture.body).toBe('It is a Node service.');
    expect(narrative.criticalPathNotes).toEqual([{ path: 'src/server.ts', note: 'App bootstrap' }]);
    expect(narrative.commandComments).toEqual([{ index: 1, comment: 'http://localhost:3000' }]);
    expect(narrative.firstTasks[0]?.path).toBe('src/server.ts');
  });

  it('wraps repo data in an <untrusted> block so prompt injection reads as data', async () => {
    const llm = provider();
    await new OnboardingModel(llm, 'openai', 'gpt-4.1').write(facts, 'English');
    const req = llm.calls.find((c) => c.method === 'completeStructured')!.req as {
      messages: { role: string; content: string }[];
    };
    const user = req.messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('<untrusted>');
    expect(user).toContain('</untrusted>');
    expect(user).toContain('src/server.ts');
  });

  it('sends the skeleton commands by index so comments can be keyed back', async () => {
    const llm = provider();
    await new OnboardingModel(llm, 'openai', 'gpt-4.1').write(facts, 'English');
    const req = llm.calls.find((c) => c.method === 'completeStructured')!.req as {
      messages: { role: string; content: string }[];
    };
    const user = req.messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('0. pnpm install');
    expect(user).toContain('1. pnpm dev');
  });

  it('renders the system prompt with the requested language', async () => {
    const llm = provider();
    await new OnboardingModel(llm, 'openai', 'gpt-4.1').write(facts, 'Ukrainian');
    const req = llm.calls.find((c) => c.method === 'completeStructured')!.req as {
      messages: { role: string; content: string }[];
    };
    const system = req.messages.find((m) => m.role === 'system')!.content;
    expect(system).toContain('Ukrainian');
    expect(system).not.toContain('{{language}}');
    expect(system).not.toContain('{{maxTasks}}');
  });
});
