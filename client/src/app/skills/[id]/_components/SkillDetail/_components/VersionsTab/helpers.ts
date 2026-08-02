import { diffLines } from "diff";

export type DiffRowKind = "add" | "del" | "ctx";
export interface DiffRow {
  kind: DiffRowKind;
  text: string;
}

/** Flatten a line diff into renderable rows. Trailing blank lines are dropped. */
export function toDiffRows(from: string, to: string): DiffRow[] {
  return diffLines(from, to).flatMap((part) => {
    const kind: DiffRowKind = part.added ? "add" : part.removed ? "del" : "ctx";
    return part.value
      .split("\n")
      .filter((line, i, all) => !(line === "" && i === all.length - 1))
      .map((text) => ({ kind, text }));
  });
}
