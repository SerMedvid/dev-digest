"use client";

import React from "react";
import { diffAnchorHash } from "@/lib/github-urls";

/**
 * GitHub diff anchors for a set of files, resolved asynchronously.
 *
 * One hook for the whole card rather than one per row: the card renders every
 * row at once, so a per-row hook would mean N effects and N state commits for
 * what is one batch of digests.
 *
 * A path is absent from the result until its digest lands — and stays absent
 * forever when SubtleCrypto isn't available. Callers must treat "absent" as the
 * normal first state and fall back to an un-anchored link, never to no link.
 */
export function useDiffAnchors(files: string[], enabled: boolean): Record<string, string> {
  const [anchors, setAnchors] = React.useState<Record<string, string>>({});

  // The set of paths, not the array: the card re-renders on hover/placement and
  // would otherwise re-run this on every one of them.
  const key = React.useMemo(() => Array.from(new Set(files)).sort().join("\n"), [files]);

  React.useEffect(() => {
    if (!enabled || !key) return;
    let alive = true;
    for (const file of key.split("\n")) {
      void diffAnchorHash(file).then((hash) => {
        if (!alive || !hash) return;
        // Merge rather than replace — several digests settle independently.
        setAnchors((prev) => (prev[file] === hash ? prev : { ...prev, [file]: hash }));
      });
    }
    return () => {
      alive = false;
    };
  }, [key, enabled]);

  return anchors;
}

export default useDiffAnchors;
