# References — where these rules came from

Sources behind [`SKILL.md`](SKILL.md), and what each one contributed. Recorded so
the skill can be revised without re-deriving the reasoning.

## The pattern itself

| Source | What we took |
|---|---|
| [Self-Learning AI Skill System with Learnings.md + Wrap-Up Skill](https://www.mindstudio.ai/blog/self-learning-ai-skill-system-learnings-md-wrap-up) | The fixed section list; the vague-vs-useful entry pairs in [`examples.md`](examples.md); the ~200-entry ceiling; the observation that a manual-only trigger doesn't hold — *"if you skip the wrap-up, the system doesn't learn"* |
| [How to Build a Learnings Loop for Claude Code Skills](https://www.mindstudio.ai/blog/how-to-build-learnings-loop-claude-code-skills) | Append-only with dated corrections rather than overwrites; the forced active-read prompt (*"confirm you've read it and summarise the top 3 relevant points"*); the distinction between this and a `CLAUDE.md` |
| [Self-Learning Claude Code Skill with Learnings.md](https://www.mindstudio.ai/blog/self-learning-claude-code-skill-learnings-md) | Why plain markdown is sufficient — *"a file that the previous version of Claude left notes in for the current version to read"*. No RAG, no vector store |
| [Self-Evolving Claude Code Memory with Obsidian + Hooks](https://www.mindstudio.ai/blog/self-evolving-claude-code-memory-obsidian-hooks) | The four capture categories (patterns, mistakes, decisions, context) that the six sections collapse down from |
| [Compounding Knowledge Loop in Claude Code](https://www.mindstudio.ai/blog/claude-code-context-compounding-explained) | Framing of the problem: nothing persists past the context window, so the same class of mistake recurs weekly |

## Entry quality

| Source | What we took |
|---|---|
| [CLAUDE.md: Building Persistent Memory for AI Coding Agents](https://dev.to/evoleinik/claudemd-building-persistent-memory-for-ai-coding-agents-5322) | One-line entry style (*"Prisma Accelerate has a 5MB response limit — use `select` not `include`"*); flag during the session, write after the fix is confirmed; periodic pruning of fixed bugs and duplicates; the caution that this is not a substitute for documentation |
| [Self-Improving AI: One Prompt That Makes Claude Learn From Every Mistake](https://dev.to/aviad_rozenhek_cba37e0660/self-improving-ai-one-prompt-that-makes-claude-learn-from-every-mistake-16ek) | Always record the *why*; keep entries terse and declarative; the compounding argument for doing this at all |
| [Lessons Learned (AI Development Retro)](https://mcpmarket.com/tools/skills/lessons-learned-retrospectives) | Prior art enforcing a quality bar — *"prevents generic platitudes… focuses on actionable, transferable technical knowledge"* |
| [CLAUDE.md Lessons Manager](https://mcpmarket.com/tools/skills/claude-md-lessons-manager) | Duplicate detection and consolidation as a first-class concern, not an afterthought |
| [Omega (MCP) — field notes](https://glama.ai/mcp/servers/@omega-memory/Omega) | Why `Decisions` earns its own section: *"We chose PostgreSQL for ACID, not Redis"* had to be re-explained every session until it was written down |

## Skill authoring

| Source | What we took |
|---|---|
| [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | The `description` is the discovery interface — it must state both *what* and *when*, in the third person, because it's injected into the system prompt |
| [Lessons from building Claude Code: how we use skills](https://claude.com/blog/lessons-from-building-claude-code-how-we-use-skills) | Skills are folders, not single files — hence the split into `SKILL.md` / `examples.md` / `references.md` |
| [glebis/claude-skills — retrospective](https://github.com/glebis/claude-skills) | Prior art for the wrap-up half of the trigger: *"use at end of work day to capture learnings across all sessions"* |

## Deliberate departures

- **`INSIGHTS.md`, not `LEARNINGS.md`.** Every source above uses the latter. We
  matched the file to the skill name instead.
- **No `Session Notes` section.** The sources keep a dated diary. It's the
  section that grows without bound, and it's the one their own
  common-mistakes lists flag as the length risk — every entry here carries its
  own date anyway, so the chronology isn't lost.
- **No `Stop` hook.** The sources argue a human-triggered capture won't happen
  consistently, and they're probably right. We rely on the rule in root
  [`CLAUDE.md`](../../../CLAUDE.md) instead, which is always in context. If that
  proves too soft in practice, a `Stop` hook in `.claude/settings.json` is the
  documented next step.
- **No helper script.** An earlier draft had one enforcing duplicate detection,
  section names, and formatting mechanically. Dropped in favour of keeping the
  skill pure markdown — those checks are now procedure in
  [`SKILL.md`](SKILL.md), which means they depend on the model following them.
  That is the known soft spot in this design; the duplicate check in step 3 is
  where it will show first.
