import type { BlastRadiusResponse, BlastSymbolC } from '@devdigest/shared';
import { BLAST_REASON } from './constants.js';
import type { BlastResultShape, IndexStateShape } from './ports.js';

/**
 * Pure mapping from repo-intel's `BlastResult` to the wire contract. Nothing
 * here reads the database or calls a model — the whole read path's honesty
 * (what `status` and `reason` say) is decided by these two functions.
 */

/** A map we could not compute at all. Arrays are empty because we are blind. */
export function degradedWire(headSha: string, reason: string): BlastRadiusResponse {
  return {
    status: 'degraded',
    reason,
    head_sha: headSha,
    changed_symbols: [],
    endpoints: [],
    crons: [],
    summary: null,
  };
}

export function toWire(
  result: BlastResultShape,
  state: IndexStateShape,
  headSha: string,
  summary: string | null,
): BlastRadiusResponse {
  // The facade's own verdict wins: if it fell back to ripgrep, no amount of
  // index metadata makes the arrays below mean anything.
  if (result.degraded) {
    return { ...degradedWire(headSha, result.reason ?? BLAST_REASON.noData), summary: null };
  }

  // Everything below is a REAL map. It is served either way; `partial` only
  // adds "some callers may be missing" — silently downgrading it to an empty
  // `ok` would be the one thing this feature exists to prevent.
  let status: BlastRadiusResponse['status'] = 'ok';
  let reason: string | null = null;
  if (state.status === 'partial') {
    status = 'partial';
    reason = BLAST_REASON.indexPartial;
  } else if (state.lastIndexedSha !== headSha) {
    status = 'partial';
    reason = BLAST_REASON.indexStale;
  }

  // The facade hands back ONE flat caller list tagged with `viaSymbol`; the
  // wire groups it under the symbol each caller reaches. Order inside a group
  // is preserved, which is rank-descending — the facade sorted it that way.
  const callersBySymbol = new Map<string, BlastSymbolC['callers']>();
  const callerFilesBySymbol = new Map<string, Set<string>>();
  for (const c of result.callers) {
    const list = callersBySymbol.get(c.viaSymbol);
    const entry = { file: c.file, line: c.line, symbol: c.symbol, rank: c.rank };
    if (list) list.push(entry);
    else callersBySymbol.set(c.viaSymbol, [entry]);

    const files = callerFilesBySymbol.get(c.viaSymbol);
    if (files) files.add(c.file);
    else callerFilesBySymbol.set(c.viaSymbol, new Set([c.file]));
  }

  const facts = result.factsByFile ?? {};
  const changed_symbols: BlastSymbolC[] = result.changedSymbols.map((s) => {
    // Per-symbol attribution is narrower than the top-level union by design:
    // it covers the symbol's own declaring file plus the files that actually
    // call THIS symbol, while the union is BFS-widened. The declaring file is
    // seeded in so that a symbol with zero resolved callers (stale index)
    // still carries the endpoints/crons its own file declares — otherwise the
    // header counter names facts no chip can show. Either way the card can
    // say "this symbol reaches that endpoint" without overclaiming.
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const file of [s.file, ...(callerFilesBySymbol.get(s.name) ?? [])]) {
      const f = facts[file];
      if (!f) continue;
      for (const e of f.endpoints) endpoints.add(e);
      for (const c of f.crons) crons.add(c);
    }
    return {
      name: s.name,
      kind: s.kind,
      file: s.file,
      line: s.line ?? null,
      callers: callersBySymbol.get(s.name) ?? [],
      endpoints: [...endpoints],
      crons: [...crons],
    };
  });

  return {
    status,
    reason,
    head_sha: headSha,
    changed_symbols,
    endpoints: [...result.impactedEndpoints],
    crons: [...result.impactedCrons],
    summary,
  };
}
