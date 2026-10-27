import { writable } from "svelte/store";

/**
 * The reply limit cards whose "Ask <bot>'s maker" this person already tapped, by bot and window, so the button stays
 * "Asked" when the card is drawn again (a newer card, the chat reopened). In memory only: Orbit counts an ask once per
 * person and window anyway.
 */
function createAskedStore() {
    const { subscribe, update } = writable(new Set<string>());
    return {
        subscribe,
        add(key: string) {
            update((asked) => new Set(asked).add(key));
        },
    };
}

export const askedBotMakers = createAskedStore();
