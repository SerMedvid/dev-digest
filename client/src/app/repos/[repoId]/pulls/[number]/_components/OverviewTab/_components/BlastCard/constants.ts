/**
 * The kinds whose names read as callable, so `rateLimit` renders `rateLimit()`.
 * The indexer emits exactly six kinds (`server/src/adapters/codeindex/extract.ts`):
 * class, enum, function, interface, method, type. Appending `()` to the other
 * four would draw an interface as something you can call.
 */
export const FUNCTION_KINDS = new Set(["function", "method"]);
