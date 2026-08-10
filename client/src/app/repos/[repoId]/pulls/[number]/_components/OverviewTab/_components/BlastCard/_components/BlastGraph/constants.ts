/**
 * The drawing box. Width is fixed — three columns are what the dialog is sized
 * for — while height is computed from the row count, so a large map grows the
 * canvas and scrolls instead of packing nodes on top of each other.
 */
export const GRAPH_WIDTH = 1120;

/** Shortest canvas worth drawing, so a one-symbol map is not a sliver. */
export const MIN_GRAPH_HEIGHT = 200;

/** Dot x per column: changed symbol, caller, what the caller exposes. */
export const COLUMN_X = [40, 400, 760] as const;

/** Content box a row may occupy — dot, label and sublabel, before the gutter. */
export const ROW_WIDTH = 320;

/** Vertical pitch between two rows of one column. Fits a 12px label above a
    9px sublabel with clear air between one row and the next. */
export const ROW_PITCH = 42;

/** Room above the first row for the column headers, and below the last row. */
export const MARGIN_TOP = 52;
export const MARGIN_BOTTOM = 28;

/** Header baseline, inside `MARGIN_TOP`. */
export const HEADER_Y = 22;

/** Label offset from its own dot, and the two label baselines relative to it. */
export const LABEL_DX = 14;
export const LABEL_DY = 4;
export const SUBLABEL_DY = 16;

/** Label truncation — a full path would overrun its column. */
export const MAX_LABEL_CHARS = 38;

/**
 * Advance-width estimates, in px per character, for the two label tiers. Used
 * to work out where a row's text ends so an edge can leave from beyond it
 * rather than being drawn through it. Deliberately generous: over-estimating
 * pushes an edge further right, which is harmless, while under-estimating puts
 * a line through the text.
 */
export const CHAR_WIDTH = 6.4;
export const CHAR_WIDTH_PRIMARY = 7.3;

/** Gap between where a label ends and where its outgoing edges start, and the
    gap an incoming edge stops short of the target dot. */
export const EDGE_GAP = 12;
export const EDGE_ARRIVE = 9;
