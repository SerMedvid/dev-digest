/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract, plus
   FileCard itself — Smart Diff (Task 8) composes it directly (grouped layout,
   controlled open state, marks) instead of going through DiffViewer's flat list. */
export { DiffViewer } from "./DiffViewer";
export { FileCard } from "./FileCard";
export type { DiffCommentApi } from "./comments";
/* Severity presentation, shared with Smart Diff's own header adornments so the
   colour of a file's finding dot and the colour of the line chip it scrolls to
   can never disagree. */
export { SEVERITY_RANK } from "./FileCard/constants";
export { SEVERITY_COLOR } from "./styles";
