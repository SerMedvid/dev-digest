import type { CSSProperties } from "react";

/** Co-located styles for the skill editor's `Project context to use` section. */
export const s = {
  // A rule above the section, because it sits below the skill's own Save row and
  // saves on a different model: nothing here waits for that button.
  section: {
    marginTop: 28,
    paddingTop: 24,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  headRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  heading: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  badge: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    background: "var(--bg-inset, rgba(127,127,127,0.12))",
    padding: "1px 8px",
    borderRadius: 4,
  } satisfies CSSProperties,
  hint: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "6px 0 16px",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  // Matched to the agent editor's Context tab, which puts the same filter in
  // the same place above the list (AC-46).
  filter: { marginBottom: 14 } satisfies CSSProperties,
  notice: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginBottom: 12,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)", marginTop: 12 } satisfies CSSProperties,

  /* The SERIALIZES AS panel. It shows the block the server assembled, verbatim —
     never a re-rendering of it, and never the comp's `## Project specifications`
     heading, which no run ever sends (AC-49). */
  panel: {
    marginTop: 20,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    padding: 14,
  } satisfies CSSProperties,
  panelLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  panelHint: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    margin: "6px 0 12px",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  panelEmpty: { fontSize: 12.5, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  block: {
    margin: 0,
    maxHeight: 320,
    overflow: "auto",
    fontSize: 12,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
    background: "var(--bg-inset, rgba(127,127,127,0.08))",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: 12,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  unread: { marginTop: 12 } satisfies CSSProperties,
  unreadHeading: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--warn, var(--crit))",
  } satisfies CSSProperties,
  unreadHint: {
    fontSize: 12,
    color: "var(--text-muted)",
    margin: "4px 0 6px",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  // Tailwind 4's preflight strips list markers, so a list has to restate one
  // (client/INSIGHTS.md, 2026-08-06).
  unreadList: {
    listStyleType: "disc",
    paddingLeft: 18,
    margin: 0,
  } satisfies CSSProperties,
  unreadItem: {
    fontSize: 12,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
} as const;
