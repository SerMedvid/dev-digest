/** Source tags with a dedicated label under `prReview.intent.source.<tag>`.
 *  Any other tag the server records (an issue or doc reference, e.g.
 *  `"issue#471"`) has no catalogue entry and passes through untranslated —
 *  see `sourceLine` in `helpers.ts`. */
export const KNOWN_SOURCES = ["title", "description", "hunk_headers"] as const;
export type KnownSource = (typeof KNOWN_SOURCES)[number];
