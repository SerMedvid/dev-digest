import type { Intent } from '@devdigest/shared';

/**
 * The intent as the REVIEWER sees it. Deliberately excludes confidence, sources
 * and missing context: those are for the user and the run log. A reviewer told
 * "confidence: low" has been handed an excuse to work less carefully.
 */
export function renderIntent(intent: Intent): string {
  const lines = [intent.intent];
  if (intent.in_scope.length > 0) {
    lines.push('', 'In scope:', ...intent.in_scope.map((s) => `- ${s}`));
  }
  if (intent.out_of_scope.length > 0) {
    lines.push('', 'Out of scope:', ...intent.out_of_scope.map((s) => `- ${s}`));
  }
  return lines.join('\n');
}
