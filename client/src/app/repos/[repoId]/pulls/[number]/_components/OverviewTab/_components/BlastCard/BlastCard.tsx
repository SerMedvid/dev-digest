"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Skeleton } from "@devdigest/ui";
import type { BlastSymbolC } from "@devdigest/shared";
import { useBlastRadius, useBlastSummary } from "@/lib/hooks/blast";
import { ApiError } from "@/lib/api";
import { callerHref } from "./helpers";
import { s } from "./styles";

interface BlastCardProps {
  prId: string | null;
  /** The PR's current head — every link is pinned to it, so lines stay right. */
  headSha: string;
  /** `null` when the repo is unknown; rows then render as plain text. */
  repoFullName: string | null;
}

/** One `file:line`, linked when we know where to point and plain text when not. */
function FileRef({
  href,
  file,
  line,
}: {
  href: string | null;
  file: string;
  line: number | null;
}) {
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
 * What this PR's changes reach: the symbols it touched, who calls them, and the
 * endpoints and jobs downstream — all read from the index, so the card renders
 * without a model call.
 *
 * The states that matter are the ones that distinguish "nothing is there" from
 * "we cannot see": `degraded` renders an explanation and NO tree, because an
 * empty tree beside a "0 callers" counter reads as an all-clear.
 */
export function BlastCard({ prId, headSha, repoFullName }: BlastCardProps) {
  const t = useTranslations("blast");
  const { data, isLoading, isError, error, refetch, isFetching } = useBlastRadius(prId);
  const explain = useBlastSummary(prId);

  const explainError = explain.isError
    ? explain.error instanceof ApiError
      ? explain.error.message
      : t("explainError")
    : null;

  if (isLoading) {
    // Keeps the card's footprint so the page doesn't shift once data lands.
    return (
      <section style={s.card}>
        <SectionLabel icon="Zap">{t("title")}</SectionLabel>
        <Skeleton height={14} width="45%" />
        <Skeleton height={72} />
      </section>
    );
  }

  if (isError) {
    return (
      <section style={s.card}>
        <SectionLabel icon="Zap">{t("title")}</SectionLabel>
        <div style={s.warning}>
          {error instanceof ApiError ? error.message : t("loadError")}
        </div>
        {/* The GET failed — retry the GET. Explaining here would answer a failed
            read with a paid model call the user never asked for. */}
        <Button onClick={() => void refetch()} disabled={isFetching}>
          {t("retry")}
        </Button>
      </section>
    );
  }

  if (!data) return null;

  if (data.status === "degraded") {
    return (
      <section style={s.card}>
        <SectionLabel icon="Zap">{t("title")}</SectionLabel>
        <div style={s.degraded}>
          <p style={s.degradedTitle}>{t("degradedTitle")}</p>
          <p style={s.degradedBody}>{t("degradedBody", { reason: data.reason ?? "" })}</p>
        </div>
      </section>
    );
  }

  const callerCount = data.changed_symbols.reduce((n, sym) => n + sym.callers.length, 0);
  const counters: Array<[string, number]> = [
    [t("stat.symbols"), data.changed_symbols.length],
    [t("stat.callers"), callerCount],
    [t("stat.endpoints"), data.endpoints.length],
    [t("stat.crons"), data.crons.length],
  ];

  return (
    <section style={s.card}>
      <SectionLabel icon="Zap">{t("title")}</SectionLabel>

      {data.status === "partial" && (
        <p style={s.warning}>{t("partialWarning", { reason: data.reason ?? "" })}</p>
      )}

      <div style={s.counters}>
        {counters.map(([label, value]) => (
          <span key={label}>
            <span style={s.counterValue}>{value}</span>
            <span>{label}</span>
          </span>
        ))}
      </div>

      {data.changed_symbols.length === 0 ? (
        <p style={s.emptyNote}>{t("empty")}</p>
      ) : (
        <div style={s.tree}>
          {data.changed_symbols.map((sym) => (
            <SymbolBlock
              key={`${sym.file}:${sym.name}`}
              sym={sym}
              headSha={headSha}
              repoFullName={repoFullName}
            />
          ))}
        </div>
      )}

      {explainError && (
        <div style={s.warning} role="alert">
          {explainError}
        </div>
      )}

      {data.summary ? (
        <div>
          <div style={s.summaryTitle}>{t("summaryTitle")}</div>
          <p style={s.summary}>{data.summary}</p>
        </div>
      ) : (
        // No "Regenerate" once a summary exists at this head: it would be a paid
        // call producing the answer already on screen.
        <div>
          <Button onClick={() => explain.mutate()} disabled={explain.isPending}>
            {explain.isPending ? t("explaining") : t("explain")}
          </Button>
        </div>
      )}
    </section>
  );
}

function SymbolBlock({
  sym,
  headSha,
  repoFullName,
}: {
  sym: BlastSymbolC;
  headSha: string;
  repoFullName: string | null;
}) {
  return (
    <div style={s.symbolBlock}>
      <div style={s.symbolHeader}>
        <span style={s.symbolName}>{sym.name}</span>
        <span style={s.symbolKind}>{sym.kind}</span>
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
          {sym.endpoints.map((e) => (
            <span key={e} style={s.chip}>
              {e}
            </span>
          ))}
          {sym.crons.map((c) => (
            <span key={c} style={s.cronChip}>
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
