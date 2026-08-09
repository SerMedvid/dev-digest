/** Fixed x for each column: symbols → callers → endpoints/crons. */
export const COLUMN_X = [90, 330, 590] as const;

/** Drawing box. `width` is the layout's argument; this is the fallback. */
export const GRAPH_WIDTH = 720;

/** Vertical breathing room around the stacked nodes. */
export const ROW_HEIGHT = 34;
export const PADDING_Y = 24;

/** Minimum height, so a one-node graph still looks like a diagram. */
export const MIN_GRAPH_HEIGHT = 120;

/** The card scrolls the svg vertically past this rather than shrinking text. */
export const GRAPH_MAX_HEIGHT = 420;

/** Label truncation — a full path would overrun its column. */
export const MAX_LABEL_CHARS = 30;
