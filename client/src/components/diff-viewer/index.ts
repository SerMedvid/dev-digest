/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract, plus
   FileCard itself — Smart Diff (Task 8) composes it directly (grouped layout,
   controlled open state, marks) instead of going through DiffViewer's flat list. */
export { DiffViewer } from "./DiffViewer";
export { FileCard } from "./FileCard";
export type { DiffCommentApi } from "./comments";
