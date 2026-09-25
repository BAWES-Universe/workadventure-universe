/** How long typing pauses before the search reaches the user providers (the offline members' search is a request). */
export const SEARCH_FILTER_DELAY_MS = 300;

interface Timers {
    setTimeout(handler: () => void, ms: number): unknown;
    clearTimeout(id: unknown): void;
}

export interface SearchFilter {
    /** The search text changed (typed, autocorrected, dictated or pasted): apply it once typing pauses. */
    schedule(value: string, apply: (value: string) => Promise<unknown>): void;
    /** Drop what's pending (the search was cleared). */
    cancel(): void;
}

/**
 * Passes the search text on after a short pause. Every change counts, not only key presses: on phones, autocorrect,
 * predictive text, dictation and paste change the field without the key events the search used to wait for.
 * The loading state ends with the latest search only, never with an older one that finished later.
 */
export function createSearchFilter(
    onLoading: (loading: boolean) => void,
    delayMs: number = SEARCH_FILTER_DELAY_MS,
    timers: Timers = globalThis as unknown as Timers
): SearchFilter {
    let timer: unknown;
    let latest = 0;
    return {
        schedule(value, apply) {
            timers.clearTimeout(timer);
            timer = timers.setTimeout(() => {
                const run = ++latest;
                onLoading(true);
                apply(value)
                    .catch((e) => console.error(e))
                    .finally(() => {
                        if (run === latest) onLoading(false);
                    });
            }, delayMs);
        },
        cancel() {
            timers.clearTimeout(timer);
            latest++;
            onLoading(false);
        },
    };
}
