/** Pure helpers for CreateSkillModal. */

/** Strip a markdown extension from a picked file's name. */
export function stripMarkdownExtension(filename: string): string {
  return filename.replace(/\.(md|markdown|mdx)$/i, "");
}

/**
 * The name an imported skill gets when the user leaves the field blank — the
 * body's first ATX heading, else the filename without its extension. This is
 * what `file.nameHint` promises ("derived from the first heading if blank").
 * Returns "" when neither is available, which keeps submit disabled.
 */
export function deriveSkillName(body: string, filename?: string): string {
  for (const line of body.split("\n")) {
    const heading = /^\s{0,3}#{1,6}\s+(.*\S)\s*$/.exec(line);
    if (heading?.[1]) return heading[1].trim();
  }
  return filename ? stripMarkdownExtension(filename).trim() : "";
}
