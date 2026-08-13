import type {
  AuthProvider,
  SecretsProvider,
  GitHubClient,
  GitClient,
  CodeIndex,
  Embedder,
  LLMProvider,
} from '@devdigest/shared';
import type { AppConfig } from './config.js';
import type { Db } from '../db/client.js';
import { JobRunner } from './jobs.js';
import { runBus, type RunBus } from './sse.js';
import type { PinoLike } from './run-logger.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { LocalNoAuthProvider } from '../adapters/auth/local.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { SimpleGitClient } from '../adapters/git/simple-git.js';
import { RipgrepCodeIndex } from '../adapters/codeindex/ripgrep.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';
import { AnthropicProvider } from '../adapters/llm/anthropic.js';
import { OpenAIEmbedder } from '../adapters/embedder/openai.js';
import { hunkHeaderDigest, OpenRouterProvider } from '@devdigest/reviewer-core';
import { FEATURE_MODELS } from '@devdigest/shared';
import { estimateCost } from '../adapters/llm/pricing.js';
import { PriceBook } from './price-book.js';
import { ConfigError } from './errors.js';
import { AgentsRepository } from '../modules/agents/repository.js';
import { SkillsRepository } from '../modules/skills/repository.js';
import { SkillsService } from '../modules/skills/service.js';
import { ConventionsRepository } from '../modules/conventions/repository.js';
import { ReviewRepository } from '../modules/reviews/repository.js';
import { IntentRepository } from '../modules/intent/repository.js';
import { IntentService } from '../modules/intent/service.js';
import { IntentModel } from '../modules/intent/model.js';
import { CloneDocReader } from '../modules/intent/docs.js';
import { GitHubIssueReader } from '../modules/intent/github.js';
import { SmartDiffRepository } from '../modules/smart-diff/repository.js';
import { SmartDiffService } from '../modules/smart-diff/service.js';
import { FileSummaryModel } from '../modules/smart-diff/model.js';
import { BlastRepository } from '../modules/blast/repository.js';
import { BlastService } from '../modules/blast/service.js';
import { BlastSummaryModel } from '../modules/blast/model.js';
import { ProjectContextRepository } from '../modules/project-context/repository.js';
import { ProjectContextService } from '../modules/project-context/service.js';
import { CloneWalker } from '../modules/project-context/walk.js';
import type { ContextReaderPort } from '../modules/project-context/ports.js';
import { CloneReader } from '../adapters/clone-reader/index.js';
import { loadDiff } from '../modules/reviews/diff-loader.js';
import type { RepoIntel } from '../modules/repo-intel/types.js';
import { RepoIntelService } from '../modules/repo-intel/service.js';
import { type DepGraph, DepCruiseGraph } from '../adapters/depgraph/index.js';
import { type Tokenizer, TiktokenTokenizer } from '../adapters/tokenizer/index.js';

/** Registry default — never a local restatement. Changing the model means
    changing FEATURE_MODELS (and its client mirror), not this line. */
const INTENT_REGISTRY_ENTRY = FEATURE_MODELS.find((f) => f.id === 'review_intent')!;
const INTENT_DEFAULT_MODEL = {
  provider: INTENT_REGISTRY_ENTRY.defaultProvider,
  model: INTENT_REGISTRY_ENTRY.defaultModel,
};

/** Registry default for the on-demand file summary — never a local restatement (Task 6). */
const FILE_SUMMARY_REGISTRY_ENTRY = FEATURE_MODELS.find((f) => f.id === 'file_summary')!;
const FILE_SUMMARY_DEFAULT_MODEL = {
  provider: FILE_SUMMARY_REGISTRY_ENTRY.defaultProvider,
  model: FILE_SUMMARY_REGISTRY_ENTRY.defaultModel,
};

/** Registry default for the on-demand blast summary — never a local restatement. */
const BLAST_SUMMARY_REGISTRY_ENTRY = FEATURE_MODELS.find((f) => f.id === 'blast_summary')!;
const BLAST_SUMMARY_DEFAULT_MODEL = {
  provider: BLAST_SUMMARY_REGISTRY_ENTRY.defaultProvider,
  model: BLAST_SUMMARY_REGISTRY_ENTRY.defaultModel,
};

/**
 * DI container. One per app instance. Holds config, db, the JobRunner,
 * the SSE bus, and lazily-constructed adapters resolved through SecretsProvider.
 *
 * Tests construct a container with `overrides` to inject mock adapters; the
 * Services depend on these interfaces, not the concrete classes.
 */
export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  github?: GitHubClient;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  /** Pre-built providers by id (skip key lookup). */
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  /** repo-intel facade (T1.1+) — tests inject mock RepoIntel implementations. */
  repoIntel?: RepoIntel;
  /** repo-intel T3 adapters — only the indexer pipeline reads these. */
  depgraph?: DepGraph;
  tokenizer?: Tokenizer;
  /**
   * The confined clone reader (`adapters/clone-reader/`), so a test can drive
   * `container.projectContext` without a clone on disk.
   *
   * Typed by the consuming module's port rather than by a `@devdigest/shared`
   * interface, which is where `server/CLAUDE.md`'s adapter checklist would
   * normally put it: this port describes a *filesystem* read, and
   * `@devdigest/shared` is copied verbatim into `client/`, which has no
   * filesystem and no use for it. `ports.ts` declares the shape structurally, so
   * `CloneReader.open` satisfies it with no adapter class and no cast.
   */
  cloneReader?: ContextReaderPort;
}

export class Container {
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly auth: AuthProvider;
  readonly jobs: JobRunner;
  readonly runBus: RunBus;

  private _git?: GitClient;
  private _github?: GitHubClient;
  private _codeIndex?: CodeIndex;
  private _embedder?: Embedder;
  private llmCache = new Map<string, LLMProvider>();

  // Shared repositories for cross-cutting entities (agents, reviews/pulls,
  // runs). Constructed here, in the composition root, so consuming modules use
  // `container.agentsRepo` instead of reaching into another module's folder.
  private _agentsRepo?: AgentsRepository;
  private _skillsRepo?: SkillsRepository;
  private _skillsService?: SkillsService;
  private _conventionsRepo?: ConventionsRepository;
  private _reviewRepo?: ReviewRepository;
  private _intentRepo?: IntentRepository;
  private _intentService?: IntentService;
  private _smartDiffRepo?: SmartDiffRepository;
  private _smartDiffService?: SmartDiffService;
  private _blastRepo?: BlastRepository;
  private _blastService?: BlastService;
  private _projectContextRepo?: ProjectContextRepository;
  private _projectContext?: ProjectContextService;
  private _repoIntel?: RepoIntel;
  private _depgraph?: DepGraph;
  private _tokenizer?: Tokenizer;
  private _priceBook?: PriceBook;

  /**
   * The process's structured logger (pino), supplied by `buildApp` so that
   * services composed here can report best-effort failures they swallow by
   * contract. Typed as `PinoLike` — the platform's own narrow pino shape —
   * rather than Fastify's logger type, so no SDK type enters the graph.
   * Optional so a Container is still constructible without one.
   */
  readonly logger?: PinoLike;

  constructor(
    config: AppConfig,
    db: Db,
    private overrides: ContainerOverrides = {},
    logger?: PinoLike,
  ) {
    this.logger = logger;
    this.config = config;
    this.db = db;
    this.secrets = overrides.secrets ?? new LocalSecretsProvider(config.secretsPath);
    this.auth = overrides.auth ?? new LocalNoAuthProvider(db);
    this.runBus = runBus;
    this.jobs = new JobRunner(db);
  }

  get git(): GitClient {
    if (this.overrides.git) return this.overrides.git;
    this._git ??= new SimpleGitClient(this.config.cloneDir);
    return this._git;
  }

  get agentsRepo(): AgentsRepository {
    return (this._agentsRepo ??= new AgentsRepository(this.db));
  }

  get skillsRepo(): SkillsRepository {
    return (this._skillsRepo ??= new SkillsRepository(this.db));
  }

  /**
   * Skill creation is needed by more than the skills module — the conventions
   * extractor turns accepted rules into a skill. Constructed here so that
   * module calls one use-case instead of importing `modules/skills/service.ts`,
   * which the `no-cross-module-internals` gate forbids.
   */
  get skillsService(): SkillsService {
    return (this._skillsService ??= new SkillsService(this.skillsRepo));
  }

  get conventionsRepo(): ConventionsRepository {
    return (this._conventionsRepo ??= new ConventionsRepository(this.db));
  }

  get reviewRepo(): ReviewRepository {
    return (this._reviewRepo ??= new ReviewRepository(this.db));
  }

  get intentRepo(): IntentRepository {
    return (this._intentRepo ??= new IntentRepository(this.db));
  }

  /**
   * Intent derivation is needed by two callers — the intent routes and the
   * review pre-work in `run-executor` — so the composition root is here rather
   * than in the module's routes file. The service takes ports, never `Container`.
   */
  get intentService(): IntentService {
    return (this._intentService ??= new IntentService({
      repo: this.intentRepo,
      store: {
        get: (prId) => this.reviewRepo.getIntent(prId),
        put: (prId, rec) => this.reviewRepo.upsertIntent(prId, rec),
      },
      docs: new CloneDocReader(),
      issues: new GitHubIssueReader(() => this.github()),
      diff: {
        hunkDigest: async (workspaceId, prId) => {
          // loadDiff needs the FULL pull + repo rows (it falls back to stored
          // pr_files patches), so read them through the reviews aggregate —
          // intentRepo returns deliberately narrow projections that would not
          // type-check here.
          const pull = await this.reviewRepo.getPull(workspaceId, prId);
          if (!pull) return undefined;
          const repo = await this.reviewRepo.getRepo(pull.repoId);
          if (!repo) return undefined;
          const diff = await loadDiff(this.git, this.reviewRepo, workspaceId, pull, repo);
          return hunkHeaderDigest(diff);
        },
      },
      model: async (workspaceId) => {
        const choice = (await this.intentRepo.featureModelChoice(workspaceId)) ?? INTENT_DEFAULT_MODEL;
        const llm = await this.llm(choice.provider as 'openai' | 'anthropic' | 'openrouter');
        return new IntentModel(llm, choice.provider, choice.model);
      },
      tokenCount: (text) => this.tokenizer.count(text),
      // `ensureFresh` swallows every derivation failure by contract, so without
      // a logger a review's failed classification would go unrecorded until a
      // caller happens to pass `onLog`. This is that record.
      ...(this.logger ? { logger: this.logger } : {}),
    }));
  }

  get smartDiffRepo(): SmartDiffRepository {
    return (this._smartDiffRepo ??= new SmartDiffRepository(this.db));
  }

  /**
   * Smart Diff composes over the reviews aggregate for the pull, its files
   * and its findings — the store port is built inline here, exactly as
   * `intentService`'s `store`/`diff` deps are, so consuming modules never
   * import `modules/reviews/repository.ts` directly.
   */
  get smartDiffService(): SmartDiffService {
    return (this._smartDiffService ??= new SmartDiffService({
      store: {
        getPull: (workspaceId, prId) => this.reviewRepo.getPull(workspaceId, prId),
        getPrFiles: (prId) => this.reviewRepo.getPrFiles(prId),
        findingsForPull: async (prId) => {
          const rows = await this.reviewRepo.reviewsForPull(prId);
          return rows.flatMap((r) => r.findings);
        },
      },
      repo: this.smartDiffRepo,
      // Exact shape of `intentService`'s `model` dep: workspace choice, else
      // the registry default, resolved to a bound provider.
      model: async (workspaceId) => {
        const choice =
          (await this.smartDiffRepo.featureModelChoice(workspaceId)) ?? FILE_SUMMARY_DEFAULT_MODEL;
        const llm = await this.llm(choice.provider as 'openai' | 'anthropic' | 'openrouter');
        return new FileSummaryModel(llm, choice.provider, choice.model);
      },
      ...(this.logger ? { log: this.logger } : {}),
    }));
  }

  get blastRepo(): BlastRepository {
    return (this._blastRepo ??= new BlastRepository(this.db));
  }

  /**
   * Blast composes the reviews aggregate (the pull + its changed paths) with
   * the repo-intel facade. Both port objects are built inline here, exactly as
   * `smartDiffService`'s are, so the module never imports another module's
   * repository and never takes `Container` (the cycle `server/INSIGHTS.md`
   * 2026-08-02 warns about).
   */
  get blastService(): BlastService {
    return (this._blastService ??= new BlastService({
      store: {
        getPull: async (workspaceId, prId) => {
          const pull = await this.reviewRepo.getPull(workspaceId, prId);
          // Projected rather than passed through: the port declares the three
          // fields blast reads, and nothing more travels into the module.
          return pull ? { id: pull.id, repoId: pull.repoId, headSha: pull.headSha } : undefined;
        },
        getPrFilePaths: async (prId) => {
          const rows = await this.reviewRepo.getPrFiles(prId);
          return rows.map((r) => r.path);
        },
        priorPrs: (args) => this.reviewRepo.getPriorPrsTouching(args),
        countPrsWithoutFiles: (args) => this.reviewRepo.countPrsWithoutFiles(args),
      },
      intel: {
        blastRadius: (repoId, files) => this.repoIntel.getBlastRadius(repoId, files),
        indexState: (repoId) => this.repoIntel.getIndexState(repoId),
      },
      summaries: this.blastRepo,
      model: async (workspaceId) => {
        const choice =
          (await this.blastRepo.featureModelChoice(workspaceId)) ?? BLAST_SUMMARY_DEFAULT_MODEL;
        const llm = await this.llm(choice.provider as 'openai' | 'anthropic' | 'openrouter');
        return new BlastSummaryModel(llm, choice.provider, choice.model);
      },
      ...(this.logger ? { log: this.logger } : {}),
    }));
  }

  get projectContextRepo(): ProjectContextRepository {
    return (this._projectContextRepo ??= new ProjectContextRepository(this.db));
  }

  /**
   * Project-context documents, needed by two callers — the module's routes and
   * the review pre-work in `run-executor` — so the composition root is here.
   *
   * This assignment is also the **only** place the two filesystem ports are
   * checked against their implementations: `ports.ts` declares `walker` and
   * `reader` structurally rather than importing `CloneWalker`/`CloneReader`'s own
   * types, because `tsPreCompilationDeps: true` makes a type-only import a real
   * graph edge and would put `node:fs` in the module core's dependency graph.
   * `server/tsconfig.json` includes `src/**` only, so `pnpm typecheck` never sees
   * `server/test/**` — the test's type-level conformance check does not run in
   * the gate, and this line does.
   *
   * `CloneReader.open` is a static that never touches `this`, so passing it
   * detached is safe.
   */
  get projectContext(): ProjectContextService {
    return (this._projectContext ??= new ProjectContextService({
      store: this.projectContextRepo,
      walker: new CloneWalker(),
      reader: this.overrides.cloneReader ?? { open: CloneReader.open },
      tokenCount: (text) => this.tokenizer.count(text),
      // Discovery logs paths, counts and a duration — never document content and
      // never the clone's absolute path.
      ...(this.logger ? { logger: this.logger } : {}),
    }));
  }

  get codeIndex(): CodeIndex {
    if (this.overrides.codeIndex) return this.overrides.codeIndex;
    this._codeIndex ??= new RipgrepCodeIndex(this.git);
    return this._codeIndex;
  }

  /**
   * The repo-intel facade (T1.1). All higher-level features (reviews,
   * blast/onboarding migrations, phantom-gate) code against this interface.
   * Tests inject a mock via `ContainerOverrides.repoIntel`.
   */
  get repoIntel(): RepoIntel {
    if (this.overrides.repoIntel) return this.overrides.repoIntel;
    this._repoIntel ??= new RepoIntelService(this);
    return this._repoIntel;
  }

  /** Import-graph builder (dependency-cruiser). T3 indexer pipeline only. */
  get depgraph(): DepGraph {
    if (this.overrides.depgraph) return this.overrides.depgraph;
    this._depgraph ??= new DepCruiseGraph();
    return this._depgraph;
  }

  /** Token counter (js-tiktoken) for the repo-map budget search. */
  get tokenizer(): Tokenizer {
    if (this.overrides.tokenizer) return this.overrides.tokenizer;
    this._tokenizer ??= new TiktokenTokenizer();
    return this._tokenizer;
  }

  /**
   * Live OpenRouter pricing for cost attribution. The lister builds a bare
   * OpenRouter provider just for `/models` (no estimator needed) and degrades to
   * `[]` when no key is configured; the static `estimateCost` table is the
   * fallback for OpenAI/Anthropic and a cold/cold-failed cache.
   */
  get priceBook(): PriceBook {
    this._priceBook ??= new PriceBook(async () => {
      try {
        const key = await this.secrets.get('OPENROUTER_API_KEY');
        if (!key) return [];
        return await new OpenRouterProvider(key).listModels();
      } catch {
        return [];
      }
    }, estimateCost);
    return this._priceBook;
  }

  async github(): Promise<GitHubClient> {
    if (this.overrides.github) return this.overrides.github;
    if (this._github) return this._github;
    const token = await this.secrets.get('GITHUB_TOKEN');
    if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
    this._github = new OctokitGitHubClient(token);
    return this._github;
  }

  /** Resolve an LLM provider by id; constructs from the secret key, cached. */
  async llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    const injected = this.overrides.llm?.[id];
    if (injected) return injected;
    const cached = this.llmCache.get(id);
    if (cached) return cached;
    const provider = await this.buildLlm(id);
    this.llmCache.set(id, provider);
    return provider;
  }

  private async buildLlm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    if (id === 'openai') {
      const key = await this.secrets.get('OPENAI_API_KEY');
      if (!key) throw new ConfigError('OPENAI_API_KEY is not configured');
      return new OpenAIProvider(key);
    }
    if (id === 'openrouter') {
      // Single OpenRouter provider lives in reviewer-core (shared with the CI
      // runner); inject the PriceBook so cost attribution uses LIVE OpenRouter
      // prices (with the static table as a fallback) rather than a hardcoded one.
      const key = await this.secrets.get('OPENROUTER_API_KEY');
      if (!key) throw new ConfigError('OPENROUTER_API_KEY is not configured');
      return new OpenRouterProvider(key, {
        estimateCost: (model, tokensIn, tokensOut) =>
          this.priceBook.estimate(model, tokensIn, tokensOut),
      });
    }
    const key = await this.secrets.get('ANTHROPIC_API_KEY');
    if (!key) throw new ConfigError('ANTHROPIC_API_KEY is not configured');
    return new AnthropicProvider(key);
  }

  async embedder(): Promise<Embedder> {
    // Injected embedders (tests) always win. Otherwise embeddings are gated by
    // config: when disabled we throw BEFORE constructing the OpenAI client, so
    // the app makes ZERO OpenAI requests. All callers wrap this in try/catch and
    // degrade gracefully (memory/RAG simply returns no hits).
    if (this.overrides.embedder) return this.overrides.embedder;
    if (!this.config.embeddingsEnabled) {
      throw new ConfigError('Embeddings are disabled (set EMBEDDINGS_ENABLED=true to enable memory/RAG)');
    }
    if (this._embedder) return this._embedder;
    const openai = await this.llm('openai');
    this._embedder = new OpenAIEmbedder(openai);
    return this._embedder;
  }

  /**
   * Drop cached provider clients so the next resolve picks up changed secrets.
   * Call after persisting a new API key/PAT via SecretsProvider.set.
   */
  invalidateSecretCaches(): void {
    this.llmCache.clear();
    this._github = undefined;
    this._embedder = undefined;
  }
}
