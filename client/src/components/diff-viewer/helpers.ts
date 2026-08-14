/** Pure helpers for the DiffViewer. */
import { HUNK_HEADER_RE } from "./constants";

/**
 * The DOM id of a file's block in the diff, derived from its path.
 *
 * Lives on `FileCard`, so both viewers get it from one place — the flat
 * `DiffViewer` and Smart Diff's grouped layout both compose that component, and
 * an anchor added to only one of them would work on whichever ordering the URL
 * happened to be in.
 *
 * Paths are used verbatim after the prefix. HTML5 ids permit everything except
 * whitespace, and the consumer resolves them with `getElementById`, never a CSS
 * selector — so `/` and `.` need no escaping, and escaping them would break the
 * round trip from a path the API returned.
 */
export function fileAnchorId(path: string): string {
  return `file-${path}`;
}

export interface Line {
  kind: "add" | "del" | "ctx" | "hunk";
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** Parse unified-diff patch text into renderable lines with old/new line numbers. */
export function parsePatch(patch: string | null | undefined): Line[] {
  if (!patch) return [];
  const out: Line[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(HUNK_HEADER_RE);
      if (m) {
        oldNo = parseInt(m[1]!, 10);
        newNo = parseInt(m[2]!, 10);
      }
      out.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), newNo });
      newNo++;
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldNo });
      oldNo++;
    } else {
      out.push({ kind: "ctx", text: raw.slice(raw.startsWith(" ") ? 1 : 0), oldNo, newNo });
      oldNo++;
      newNo++;
    }
  }
  return out;
}
