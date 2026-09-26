import type { ComponentType } from "svelte";
import { get, writable } from "svelte/store";
import { v4 } from "uuid";

export type WokaMenuAction = {
    uuid?: string;
    actionName: string;
    callback: () => void;
    protected?: boolean;
    priority?: number;
    style?: "is-success" | "is-error" | "is-primary" | string;
    actionIcon?: string | ComponentType;
    testId?: string;
};
export interface WokaMenuData {
    wokaName: string;
    actions: WokaMenuAction[];
    visitCardUrl?: string;
    userId: number; // -1 if the user is not found yet and woka menu is in progress
    userUuid: string;
    /** Your own card: shows your woka, and none of the actions meant for other players. */
    isSelf?: boolean;
}

function createWokaMenuStore() {
    const { subscribe, update, set } = writable<WokaMenuData | undefined>(undefined);

    return {
        subscribe,
        initialize: (
            wokaName: string,
            userId: number,
            userUuid: string,
            visitCardUrl: string | undefined,
            isSelf = false
        ) => {
            set({
                wokaName,
                actions: new Array<WokaMenuAction>(),
                visitCardUrl,
                userId,
                userUuid,
                isSelf,
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
         * Hides menu
         */
        clear: () => {
            set(undefined);
        },
        /**
         * Closes the card when it shows this person. Anyone else leaving the map (a whole map of them when it closes)
         * leaves the card and its subscribers alone.
         */
        removeRemotePlayer: (userUuid: string) => {
            if (get({ subscribe })?.userUuid === userUuid) {
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
