export interface FindCount {
    current: number;
    total: number;
}

/** The reader's "search is still running" state: its count is 0 until the pages have been searched. */
const FIND_PENDING = 3;

/**
 * What the match counter should show after the reader's find events, or undefined to leave it as it is. A search
 * that is still running reports 0 matches, which would read as "No matches" before the pages are searched.
 */
export function findCountOf(event: { state?: number; matchesCount: FindCount }): FindCount | undefined {
    return event.state === FIND_PENDING ? undefined : event.matchesCount;
}
