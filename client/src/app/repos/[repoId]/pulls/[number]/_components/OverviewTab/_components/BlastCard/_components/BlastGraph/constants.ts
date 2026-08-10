/** The drawing box, sized for the dialog rather than a card column. */
export const GRAPH_WIDTH = 1120;
export const GRAPH_HEIGHT = 620;

/** Keeps a node's label inside the viewBox after the simulation settles. */
export const NODE_MARGIN = 60;

/** Force parameters. Tuned so a ~20-node map fills the box without clumping. */
export const LINK_DISTANCE = 110;
export const LINK_STRENGTH = 0.55;
export const CHARGE_STRENGTH = -340;
export const COLLIDE_RADIUS = 48;

/** Ticks to run before reading positions. d3's own default alpha decay settles
    in ~300; running them synchronously is what makes the layout reproducible. */
export const SIMULATION_TICKS = 300;

/** Label truncation — a full path would overrun its node. */
export const MAX_LABEL_CHARS = 30;
