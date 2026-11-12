import { derived, get, writable, type Readable } from "svelte/store";
import { callReducer, showsOnACall, startCall, type CallEvent, type CallState } from "./CallSession";

/**
 * The one call a person has at a time (game #2004). One bar follows the person everywhere, so there is one store: asking
 * for a second call while one is live changes nothing. The state is only ever changed by `callReducer`, so the rules in
 * CallSession (hold first, only Resume brings the call back, one card at a time) hold wherever the call is driven from.
 *
 * Time comes in as a function, so a test fixes it.
 */
export interface BotCall {
    botId: string;
    botName: string;
    state: CallState;
}

export function createCallStore(clock: () => number = Date.now) {
    const call = writable<BotCall | undefined>(undefined);

    return {
        subscribe: call.subscribe,
        /** Asks for a call. Returns false, and changes nothing, when a call is already live. */
        start(botId: string, botName: string): boolean {
            const current = get(call);
            if (current && current.state.phase !== "ended") return false;
            call.set({ botId, botName, state: startCall(clock()) });
            return true;
        },
        send(event: CallEvent): void {
            call.update((current) => (current ? { ...current, state: callReducer(current.state, event) } : current));
        },
        /** The ended call goes away (after its one line is shown). */
        clear(): void {
            call.set(undefined);
        },
    };
}

export const botCallStore = createCallStore();

/** "On a call" for the game to show next to the person's name while the call lasts. Never changes their own status. */
export const onACallStore: Readable<boolean> = derived(botCallStore, ($call) => !!$call && showsOnACall($call.state));
