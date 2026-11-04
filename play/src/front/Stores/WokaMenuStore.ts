import type { ComponentType } from "svelte";
import { get, writable } from "svelte/store";
import { v4 } from "uuid";
import type { PictureStore } from "./PictureStore";

export type WokaMenuAction = {
    uuid?: string;
    actionName: string;
    callback: () => void;
    protected?: boolean;
    priority?: number;
    style?: "is-success" | "is-error" | "is-primary" | string;
    actionIcon?: string | ComponentType;
    testId?: string;
    /** Listed under the card's "more" (⋯) button instead of beside the others: rarer or harsher actions, like Block. */
    overflow?: boolean;
};
export interface WokaMenuData {
    wokaName: string;
    actions: WokaMenuAction[];
    visitCardUrl?: string;
    userId: number; // -1 if the user is not found yet and woka menu is in progress
    userUuid: string;
    /** Your own card: shows your woka, and none of the actions meant for other players. */
    isSelf?: boolean;
    /** While searching for someone not on your screen yet (userId -1): their Woka as People shows it. */
    searchPicture?: PictureStore;
    /**
     * The answers this card still waits for (Orbit's membership button, a bot's Message and Summon). Its buttons show
     * once none is left, so no button appears later and moves the others (#1790).
     */
    pending: string[];
    /** Counts the times a card was opened, so a card opened again for the same person asks for its answers again. */
    opening: number;
}

/** An answer that never comes must not keep the buttons away: after this long the card shows what it has. */
export const PENDING_ANSWER_TIMEOUT_MS = 6000;

function createWokaMenuStore() {
    const { subscribe, update, set } = writable<WokaMenuData | undefined>(undefined);
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const forgetTimers = () => {
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
    };
    let openings = 0;
    const timerKey = (userUuid: string, key: string) => `${userUuid}#${key}`;

    return {
        subscribe,
        initialize: (
            wokaName: string,
            userId: number,
            userUuid: string,
            visitCardUrl: string | undefined,
            isSelf = false,
            searchPicture?: PictureStore
        ) => {
            forgetTimers();
            set({
                opening: ++openings,
                pending: [],
                wokaName,
                actions: new Array<WokaMenuAction>(),
                visitCardUrl,
                userId,
                userUuid,
                isSelf,
                searchPicture,
            });
        },
        addAction: (action: WokaMenuAction) => {
            update((data) => {
                if (data === undefined) return data;

                const dataWithUuid = { ...action, uuid: action.uuid ?? v4() };
                data.actions = [...data.actions, dataWithUuid];
                return data;
            });
        },
        removeAction: (actionName: string) => {
            update((data) => {
                if (!data) return data;
                const index = data.actions.findIndex((action) => {
                    return action.actionName === actionName;
                });
                if (index == undefined || index === -1) return data;

                data.actions = [...data.actions.splice(index, 1)];
                return data;
            });
        },
        /**
         * The card for this person waits for an answer (`key` names it) before it shows its buttons. Nothing happens
         * when the card shows someone else, or has no card.
         */
        expect: (userUuid: string, key: string) => {
            update((data) => {
                if (!data || data.userUuid !== userUuid || data.pending.includes(key)) return data;
                data.pending = [...data.pending, key];
                timers.set(
                    timerKey(userUuid, key),
                    setTimeout(() => wokaMenuStore.settle(userUuid, key), PENDING_ANSWER_TIMEOUT_MS)
                );
                return data;
            });
        },
        /** The answer is in (or will not come): the card stops waiting for it. */
        settle: (userUuid: string, key: string) => {
            const id = timerKey(userUuid, key);
            const timer = timers.get(id);
            if (timer !== undefined) clearTimeout(timer);
            timers.delete(id);
            update((data) => {
                if (!data || data.userUuid !== userUuid || !data.pending.includes(key)) return data;
                data.pending = data.pending.filter((pending) => pending !== key);
                return data;
            });
        },
        /**
         * Hides menu
         */
        clear: () => {
            forgetTimers();
            set(undefined);
        },
        /**
         * Closes the card when it shows this person. Anyone else leaving the map (a whole map of them when it closes)
         * leaves the card and its subscribers alone.
         */
        removeRemotePlayer: (userUuid: string, userId?: number) => {
            const card = get({ subscribe });
            // With the avatar's id, only that avatar's card: another tab or device of the same person stays open.
            if (card?.userUuid === userUuid && (userId === undefined || card.userId === userId)) {
                forgetTimers();
                set(undefined);
            }
        },
    };
}

export const wokaMenuStore = createWokaMenuStore();

export const wokaMenuProgressStore = writable<
    | {
          progress: number;
          message: string;
      }
    | undefined
>(undefined);
