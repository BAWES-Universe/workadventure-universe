/**
 * The quest log's place in the browser's history: opening it adds one entry, so Back (Android's, the browser's, a
 * swipe) closes the log instead of leaving the room, as it does for Orbit. The popstate listener exists only while the
 * log is open. An entry left behind when the log closed while another entry was on top (Orbit opened over it) costs
 * one extra Back, nothing more.
 */
interface QuestLogHistoryState {
    questLog: string;
}

function isOwnState(state: unknown, id: string): boolean {
    return !!state && typeof state === "object" && (state as Partial<QuestLogHistoryState>).questLog === id;
}

function newId(): string {
    try {
        return crypto.randomUUID();
    } catch {
        return `${Date.now()}-${Math.random()}`;
    }
}

/**
 * Adds the entry and calls `onBack` when Back leaves it. Returns the function to call when the log closes any other
 * way: it removes the listener and steps back over the entry if it is still the current one.
 */
export function openQuestLogHistory(onBack: () => void): () => void {
    const id = newId();
    let open = true;
    const onPopState = (event: PopStateEvent) => {
        // Back from something opened over the log (Orbit) lands on the log's entry: the log stays.
        if (!open || isOwnState(event.state, id)) return;
        open = false;
        window.removeEventListener("popstate", onPopState);
        onBack();
    };
    try {
        history.pushState({ questLog: id } satisfies QuestLogHistoryState, "");
    } catch (error) {
        console.warn("Quests: could not add the log to the history", error);
        return () => {};
    }
    window.addEventListener("popstate", onPopState);
    return () => {
        if (!open) return;
        open = false;
        window.removeEventListener("popstate", onPopState);
        if (isOwnState(history.state, id)) history.back();
    };
}
