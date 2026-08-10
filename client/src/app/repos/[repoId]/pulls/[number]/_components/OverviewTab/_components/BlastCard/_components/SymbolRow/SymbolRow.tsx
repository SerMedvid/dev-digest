"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { BlastSymbolC } from "@devdigest/shared";
import { callerHref } from "../../helpers";
import { FUNCTION_KINDS } from "../../constants";
import { s } from "./styles";

interface SymbolRowProps {
  sym: BlastSymbolC;
  headSha: string;
  repoFullName: string | null;
  /** The comp opens the first symbol and leaves the rest closed. */
  defaultOpen: boolean;
}

/** One `file:line`, linked when we know where to point and plain text when not. */
function FileRef({ href, file, line }: { href: string | null; file: string; line: number | null }) {
  const label = line == null ? file : `${file}:${line}`;
  // A plain `<a className="mono">`, not `MonoLink` — that primitive hardcodes
  // `fontSize: 13` inline, which no wrapper can override, and these rows are
  // 12 (INSIGHTS 2026-08-02).
  return href ? (
    <a className="mono" href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  ) : (
    <span className="mono">{label}</span>
  );
}

/**
 * A changed symbol and everything that reaches it, collapsed behind its own
 * header. The header is a real `<button aria-expanded>` controlling the body by
 * id, so the disclosure is operable by keyboard and announced.
 *
 * The declaration `file:line` lives in the body rather than the header: the comp
 * drops it, but it is the only link to the changed symbol itself and losing it
 * would be a regression.
 */
export function SymbolRow({ sym, headSha, repoFullName, defaultOpen }: SymbolRowProps) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(defaultOpen);

  const bodyId = `blast-sym-${sym.file}-${sym.name}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const callable = FUNCTION_KINDS.has(sym.kind);
  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;

  return (
    <div style={s.block}>
      <button
        type="button"
        style={s.header}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <Chevron size={14} style={s.chevron} />
        <Icon.Code size={13} style={s.codeIcon} />
        <span className="mono" style={s.name}>
          {callable ? `${sym.name}()` : sym.name}
        </span>
        {/* The comp drops the kind for functions; for a class or interface it is
            the only thing saying the name is not callable, so it stays. */}
        {!callable && <span style={s.kind}>{sym.kind}</span>}
        <span style={s.count}>{t("callerCount", { count: sym.callers.length })}</span>
      </button>

      {open && (
        <div id={bodyId} style={s.body}>
          <div style={s.declared}>
            <span>{t("declaredAt")}</span>
            <FileRef
              href={callerHref(repoFullName, headSha, sym.file, sym.line)}
              file={sym.file}
              line={sym.line}
            />
          </div>

          {sym.callers.length > 0 && (
            <ul style={s.callerList}>
              {sym.callers.map((c) => (
                <li key={`${c.file}:${c.line}:${c.symbol}`} style={s.callerRow}>
                  <Icon.CornerDownRight size={12} style={s.branch} />
                  <FileRef
                    href={callerHref(repoFullName, headSha, c.file, c.line)}
                    file={c.file}
                    line={c.line}
                  />
                  <span style={s.callerSymbol}>{c.symbol}</span>
                </li>
              ))}
            </ul>
          )}

          {(sym.endpoints.length > 0 || sym.crons.length > 0) && (
            <div style={s.chips}>
              {/* This symbol's own attribution, not the response's BFS-widened
                  union — the union is what the counters report. */}
              {sym.endpoints.map((e) => (
                <span key={e} style={s.chip}>
                  <Icon.Globe size={11} />
                  {e}
                </span>
              ))}
              {sym.crons.map((c) => (
                <span key={c} style={s.cronChip}>
                  <Icon.Clock size={11} />
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
