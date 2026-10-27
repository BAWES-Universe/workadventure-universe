/**
 * Tool order for bot requests.
 *
 * Tool definitions come before the system prompt in the request, so they are
 * part of the prefix a provider caches (issue #1333). Reordering, adding or
 * rewording one tool misses the cache from the first byte. MCP tools arrive in
 * whatever order the servers answer, so sort them.
 */

/** A copy of the tools sorted by function name, so the order is the same on every call. */
export function sortToolsByName<T extends { function: { name: string } }>(tools: T[]): T[] {
    return [...tools].sort((a, b) => (a.function.name < b.function.name ? -1 : a.function.name > b.function.name ? 1 : 0));
}
