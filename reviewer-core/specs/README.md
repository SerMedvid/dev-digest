# `reviewer-core/specs/`

Specifications for engine behaviour: what a stage of the pipeline is *supposed* to
do, independent of how it's currently written. Because the engine is pure and the
whole system's output depends on it, specs here are contracts — the invariants
listed in [`../CLAUDE.md`](../CLAUDE.md) are exactly the kind of thing that
belongs in one.

A spec here should carry:

- **Inputs/outputs** — named against the types in `src/` and the Zod contracts,
  not restated inline.
- **The invariant** — what must hold for every input. ("Score is derived only from
  grounded findings." "An unwrapped untrusted slot is a bug.")
- **Edge cases** — empty diff, single file, no findings, malformed model output,
  a finding citing a file absent from the diff, cancellation mid-chunk.
- **What is deliberately *not* guaranteed** — e.g. `verdict` is passed through
  from the model and may disagree with the findings. Writing the known gaps down
  is the point; that one is load-bearing for prompt authors.
- **Acceptance** — assertions concrete enough to become hermetic tests with a
  stubbed `LLMProvider`.

Conventions:

- One stage or invariant per file, kebab-case: `citation-grounding.md`,
  `prompt-assembly.md`, `map-reduce.md`.
- No I/O in a spec's examples, mirroring the package's purity rule.

Empty on purpose — nothing in the starter was built spec-first.
