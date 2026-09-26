import { get } from "svelte/store";
import type { Readable, Writable } from "svelte/store";

/**
 * On a phone the chat sidebar covers the map, so a person's card (and the camera moving to them) would open behind
 * it. Tapping someone in the People tab there closes the sidebar once their card opens; closing the card with its
 * X (or Escape), or a search that finds no one, brings the People tab back as it was left. Anything else is "done":
 * an action on the card (walk to, message, summon...), the card closing on its own, or opening the sidebar again.
 * Where the card fits beside the sidebar (desktop, a tablet in landscape), nothing changes.
 */

/** Map width (CSS px) the card needs beside the sidebar; with less, the sidebar covers the map. */
export const CARD_MIN_WIDTH = 400;
/** How long after the tap a card that opens is that person's (the server answers a locate within a moment). */
export const CARD_OPEN_WINDOW_MS = 5_000;

export function sidebarCoversMap(windowWidth: number, sidebarWidth: number): boolean {
    return windowWidth - sidebarWidth < CARD_MIN_WIDTH;
}

export interface PeopleCardReturnDeps {
    chatVisible: Writable<boolean>;
    /** The open card (undefined when none), with the person it is for ("" while a search hasn't found them). */
    card: Readable<{ userUuid: string } | undefined>;
    clearCard: () => void;
    /** Whether the sidebar, as shown now, leaves no room for the card. */
    coversMap: () => boolean;
    /** Select the People tab (before the sidebar shows again). */
    showPeople: () => void;
    now?: () => number;
}

export interface PeopleCardReturn {
    /** Someone was tapped in the People tab: their card is about to open. */
    tappedPerson(): void;
    /** The card was closed without doing anything (X, Escape, no one found): back to the People tab if it was hidden. */
    dismissCard(): void;
    /** Whether the People list should scroll back to where it was (read once, when the list shows again). */
    takeScrollRestore(): boolean;
}

export function createPeopleCardReturn(deps: PeopleCardReturnDeps): PeopleCardReturn {
    const now = deps.now ?? (() => Date.now());
    let state: { kind: "idle" } | { kind: "armed"; at: number } | { kind: "returning"; person: string } = {
        kind: "idle",
    };
    let restoreScroll = false;

    // Not unsubscribing is ok: one for the app's lifetime.
    //eslint-disable-next-line svelte/no-ignored-unsubscribe
    deps.card.subscribe((card) => {
        if (card === undefined) {
            // The card went away some other way than dismissCard: the person did something, or it closed itself.
            if (state.kind === "returning") state = { kind: "idle" };
            return;
        }
        if (state.kind === "returning") {
            // Someone else's card replaced it (a tap on the map): closing that one isn't a way back to the list.
            // The same person's card opening again (the search finding them) keeps it.
            if (state.person === "") state = { kind: "returning", person: card.userUuid };
            else if (card.userUuid !== "" && card.userUuid !== state.person) state = { kind: "idle" };
            return;
        }
        if (state.kind === "armed") {
            if (now() - state.at > CARD_OPEN_WINDOW_MS) {
                state = { kind: "idle" };
                return;
            }
            state = { kind: "returning", person: card.userUuid };
            deps.chatVisible.set(false);
        }
    });

    //eslint-disable-next-line svelte/no-ignored-unsubscribe
    deps.chatVisible.subscribe((visible) => {
        // The sidebar was opened again by hand: the card is no longer on its way back to it.
        if (visible && state.kind === "returning") state = { kind: "idle" };
    });

    return {
        tappedPerson() {
            if (!get(deps.chatVisible) || !deps.coversMap()) {
                state = { kind: "idle" };
                return;
            }
            state = { kind: "armed", at: now() };
        },
        dismissCard() {
            const returning = state.kind === "returning";
            state = { kind: "idle" };
            deps.clearCard();
            if (!returning) return;
            restoreScroll = true;
            deps.showPeople();
            deps.chatVisible.set(true);
        },
        takeScrollRestore() {
            const restore = restoreScroll;
            restoreScroll = false;
            return restore;
        },
    };
}
