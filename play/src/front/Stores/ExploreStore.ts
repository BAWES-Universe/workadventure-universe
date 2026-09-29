import { derived, writable } from "svelte/store";
import type { RoomsFromSameUniverseAnswer } from "@workadventure/messages";
import type { RoomConnection } from "../Connection/RoomConnection";

export type ExploreState =
    | { status: "loading"; universe?: RoomsFromSameUniverseAnswer }
    | { status: "ready"; universe: RoomsFromSameUniverseAnswer }
    | { status: "failed"; universe?: RoomsFromSameUniverseAnswer };

/**
 * The rooms of the player's universe, grouped by world, for the "Explore {Universe}" button and list. Loaded once the
 * room's connection is up (so the button can show the universe's name) and refreshed each time the list opens.
 */
function createExploreStore() {
    const { subscribe, set, update } = writable<ExploreState>({ status: "loading" });
    let connection: RoomConnection | undefined;
    // Only the latest request may write: a room change or a second refresh makes earlier answers stale.
    let latestRequest = 0;

    async function fetchRooms(): Promise<void> {
        if (!connection) return;
        const request = ++latestRequest;
        const requestConnection = connection;
        update((state) => ({ status: "loading", universe: state.universe }));
        try {
            const universe = await requestConnection.queryRoomsFromSameUniverse();
            if (request === latestRequest) set({ status: "ready", universe });
        } catch (e) {
            console.error("Explore: could not load the universe's rooms", e);
            if (request === latestRequest) update((state) => ({ status: "failed", universe: state.universe }));
        }
    }

    return {
        subscribe,
        /** A new room's connection: forget the previous universe and load this one. */
        load(newConnection: RoomConnection): void {
            connection = newConnection;
            set({ status: "loading" });
            fetchRooms().catch((e) => console.error(e));
        },
        refresh(): void {
            fetchRooms().catch((e) => console.error(e));
        },
    };
}

export const exploreStore = createExploreStore();

/** The universe's name once known, for the button's label. */
export const universeNameStore = derived(exploreStore, ($explore) => $explore.universe?.universeName ?? "");
