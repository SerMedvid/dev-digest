import { describe, it, expect } from 'vitest';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { ConventionsModel } from '../src/modules/conventions/model.js';

/** The MockLLMProvider records `req` as unknown; these tests read two fields. */
type RecordedRequest = { schemaName: string; model: string; messages: unknown };

function model(structuredBySchema: Record<string, unknown>) {
  const llm = new MockLLMProvider('openai', { structuredBySchema });
  const lastReq = () => llm.calls.at(-1)!.req as RecordedRequest;
  return {
    llm,
    lastReq,
    subject: new ConventionsModel(llm, 'openrouter', 'deepseek/deepseek-v4-flash'),
  };
}

describe('ConventionsModel.selectFiles', () => {
  it('asks under the documented schema name and returns the chosen paths', async () => {
    const { lastReq, subject } = model({
      ConventionFileSelection: { paths: ['src/a.ts', 'src/b.ts'] },
    });
    const paths = await subject.selectFiles({ pool: ['src/a.ts', 'src/b.ts', 'src/c.ts'] });
    expect(paths).toEqual(['src/a.ts', 'src/b.ts']);
    expect(lastReq().schemaName).toBe('ConventionFileSelection');
    expect(lastReq().model).toBe('deepseek/deepseek-v4-flash');
  });

  it('puts every pool path in the prompt so the model can only pick real ones', async () => {
    const { lastReq, subject } = model({ ConventionFileSelection: { paths: [] } });
    await subject.selectFiles({ pool: ['src/a.ts', 'src/deep/b.ts'] });
    const text = JSON.stringify(lastReq().messages);
    expect(text).toContain('src/a.ts');
    expect(text).toContain('src/deep/b.ts');
  });
});

describe('ConventionsModel.extract', () => {
  it('returns candidates in domain shape', async () => {
    const { subject } = model({
      ConventionExtraction: {
        candidates: [
          {
            category: 'naming',
            rule: 'Always suffix repositories with Repository',
            evidence_path: 'src/a.ts',
            evidence_line: 3,
            evidence_snippet: 'class UserRepository {',
            confidence: 0.82,
          },
        ],
      },
    });
    const out = await subject.extract({
      files: [{ path: 'src/a.ts', content: 'a\nb\nclass UserRepository {', kind: 'code' }],
    });
    expect(out).toEqual([
      {
        category: 'naming',
        rule: 'Always suffix repositories with Repository',
        evidencePath: 'src/a.ts',
        evidenceLine: 3,
        evidenceSnippet: 'class UserRepository {',
        confidence: 0.82,
      },
    ]);
  });

  it('numbers the lines it shows, so the model can cite a real one', async () => {
    const { lastReq, subject } = model({ ConventionExtraction: { candidates: [] } });
    await subject.extract({
      files: [{ path: 'src/a.ts', content: 'first\nsecond', kind: 'code' }],
    });
    const text = JSON.stringify(lastReq().messages);
    expect(text).toContain('1: first');
    expect(text).toContain('2: second');
    expect(lastReq().schemaName).toBe('ConventionExtraction');
  });

  it('labels configs so the model can tell a rule from a code sample', async () => {
    const { lastReq, subject } = model({ ConventionExtraction: { candidates: [] } });
    await subject.extract({
      files: [{ path: 'tsconfig.json', content: '{}', kind: 'config' }],
    });
    expect(JSON.stringify(lastReq().messages)).toContain('config');
  });
});
