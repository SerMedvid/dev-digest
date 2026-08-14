import type { OnboardingCommandValue, OnboardingSectionValue } from '@devdigest/shared';
import { MAX_FIRST_TASKS, SECTION_TITLES } from './constants.js';
import type { FactsSkeleton, Narrative } from './domain.js';

/**
 * The grounding gate.
 *
 * The skeleton is the authority: the model's prose is attached to it by path or
 * by index, and anything that does not match is discarded. A file therefore
 * cannot be hallucinated onto the page — the model never supplied one. A note
 * the model omitted leaves its file rendering without prose, which is a much
 * smaller failure than dropping the file.
 */

const MERMAID_HEAD = /^(flowchart|graph)\s+(LR|RL|TD|TB|BT)\s*$/;

/** Cheap renderability check — a broken diagram is worse than no diagram. */
export function isRenderableMermaid(diagram: string | null): boolean {
  if (!diagram) return false;
  if (diagram.includes('```')) return false;
  const lines = diagram.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const head = lines[0]?.trim();
  if (!head || !MERMAID_HEAD.test(head)) return false;
  return lines.slice(1).some((l) => l.includes('-->') || l.includes('---'));
}

export function assembleSections(
  facts: FactsSkeleton,
  narrative: Narrative,
): OnboardingSectionValue[] {
  const criticalNotes = notesByPath(narrative.criticalPathNotes);
  const readingNotes = notesByPath(narrative.readingPathNotes);
  const knownPaths = new Set(facts.criticalPaths.map((f) => f.path));

  const commentByIndex = new Map(narrative.commandComments.map((c) => [c.index, c.comment]));
  const commands: OnboardingCommandValue[] = facts.commands.map((command, i) => ({
    command,
    comment: commentByIndex.get(i) ?? null,
  }));

  return [
    {
      id: 'architecture',
      title: SECTION_TITLES.architecture,
      body: narrative.architecture.body,
      diagram: isRenderableMermaid(narrative.architecture.diagram)
        ? narrative.architecture.diagram
        : null,
      files: [],
      commands: [],
      tasks: [],
    },
    {
      id: 'critical_paths',
      title: SECTION_TITLES.critical_paths,
      body: '',
      diagram: null,
      files: facts.criticalPaths.map((f) => ({
        path: f.path,
        percentile: f.percentile,
        note: criticalNotes.get(f.path) ?? null,
      })),
      commands: [],
      tasks: [],
    },
    {
      id: 'run_locally',
      title: SECTION_TITLES.run_locally,
      body: '',
      diagram: null,
      files: [],
      commands,
      tasks: [],
    },
    {
      id: 'reading_path',
      title: SECTION_TITLES.reading_path,
      body: '',
      diagram: null,
      // Order is the skeleton's — i.e. file rank — never the model's.
      files: facts.readingPath.map((f) => ({
        path: f.path,
        percentile: f.percentile,
        note: readingNotes.get(f.path) ?? null,
      })),
      commands: [],
      tasks: [],
    },
    {
      id: 'first_tasks',
      title: SECTION_TITLES.first_tasks,
      body: '',
      diagram: null,
      files: [],
      commands: [],
      tasks: narrative.firstTasks.filter((t) => knownPaths.has(t.path)).slice(0, MAX_FIRST_TASKS),
    },
  ];
}

function notesByPath(entries: { path: string; note: string }[]): Map<string, string> {
  return new Map(entries.map((e) => [e.path, e.note]));
}
