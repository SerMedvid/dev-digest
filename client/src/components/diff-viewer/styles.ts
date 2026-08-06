import type { CSSProperties } from "react";
import type { Severity } from "@devdigest/shared";
import type { Line } from "./helpers";

/** Severity → CSS colour token, matching FindingCard's mapping
    (`app/repos/[repoId]/pulls/[number]/_components/FindingCard/constants.ts`) —
    same variable names, defined in `src/vendor/ui/styles.css`. */
export const SEVERITY_COLOR: Record<Severity, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
};

/** Tinted fill behind a severity chip — the `-bg` half of the same tokens. */
const SEVERITY_BG: Record<Severity, string> = {
  CRITICAL: "var(--crit-bg)",
  WARNING: "var(--warn-bg)",
  SUGGESTION: "var(--sugg-bg)",
};

/** Co-located styles for the DiffViewer (extracted from inline styles). */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  empty: { padding: "24px", fontSize: 14, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  fileCard: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  /** Takes the header's free space so the path ellipsises and everything after
      it stays right-aligned — the path itself no longer stretches, or its
      adornment would be pushed away from the name it belongs to. */
  pathWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  filePath: {
    fontSize: 13,
    fontWeight: 500,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  fileStat: { fontSize: 12 } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  noDiff: {
    padding: "14px 18px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
  hunk: {
    fontSize: 12,
    lineHeight: "20px",
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    padding: "0 14px",
  } satisfies CSSProperties,
  lineNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when the file card is open. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}

/** Row background per line kind (add/del tinted, others transparent), plus the
    severity-coloured left rule a marked line carries. The border is always laid
    out — transparent when unmarked — so a mark can never shift the code text
    sideways relative to the lines above and below it. */
export function lineRowFor(kind: Line["kind"], severity?: Severity): CSSProperties {
  const background = kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent";
  return {
    display: "flex",
    alignItems: "stretch",
    fontSize: 13,
    lineHeight: "20px",
    background,
    borderLeft: `3px solid ${severity ? SEVERITY_COLOR[severity] : "transparent"}`,
  };
}

/** Gutter sign colour per line kind. */
export function lineSignFor(kind: Line["kind"]): CSSProperties {
  return {
    width: 14,
    textAlign: "center",
    color: kind === "add" ? "var(--code-add-text)" : kind === "del" ? "var(--code-del-text)" : "var(--text-muted)",
    flexShrink: 0,
  };
}

/** The clickable severity chip a finding mark renders at the end of its
    anchored line — a labelled badge ("blocker" / "warning" / "suggestion"),
    right-aligned so it never interrupts the code text it annotates. Shaped like
    the `Badge` primitive (tinted fill, no outline, 5px radius) so it reads as
    the same species of chip as every other badge in the app. */
export function markChipFor(severity: Severity): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    alignSelf: "center",
    borderRadius: 5,
    border: "none",
    background: SEVERITY_BG[severity],
    color: SEVERITY_COLOR[severity],
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.4,
    letterSpacing: "0.01em",
    whiteSpace: "nowrap",
    cursor: "pointer",
    flexShrink: 0,
    marginRight: 10,
    padding: "2px 8px",
  };
}
