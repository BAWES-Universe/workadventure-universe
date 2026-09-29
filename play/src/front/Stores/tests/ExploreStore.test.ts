import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import type { RoomsFromSameUniverseAnswer } from "@workadventure/messages";
import type { RoomConnection } from "../../Connection/RoomConnection";
import { exploreStore, universeNameStore } from "../ExploreStore";

function universe(name: string): RoomsFromSameUniverseAnswer {
    return { universeName: name, worlds: [] };
}

/** A connection whose answers the test releases by hand, in any order. */
function fakeConnection() {
    const pending: Array<{ resolve: (u: RoomsFromSameUniverseAnswer) => void; reject: (e: Error) => void }> = [];
    const connection = {
        queryRoomsFromSameUniverse: () =>
            new Promise<RoomsFromSameUniverseAnswer>((resolve, reject) => {
                pending.push({ resolve, reject });
            }),
    } as unknown as RoomConnection;
    return { connection, pending };
}

const settle = () =>
    new Promise((resolve) => {
        setTimeout(resolve, 0);
    });

describe("exploreStore", () => {
    it("loads the universe for a new connection and names the button after it", async () => {
        const { connection, pending } = fakeConnection();
        exploreStore.load(connection);
        expect(get(exploreStore).status).toBe("loading");
        expect(get(universeNameStore)).toBe("");

        pending[0].resolve(universe("Acme"));
        await settle();
        expect(get(exploreStore)).toEqual({ status: "ready", universe: universe("Acme") });
        expect(get(universeNameStore)).toBe("Acme");
    });

    it("keeps what it has while refreshing, and after a failed refresh", async () => {
        const { connection, pending } = fakeConnection();
        exploreStore.load(connection);
        pending[0].resolve(universe("Acme"));
        await settle();

        exploreStore.refresh();
        expect(get(exploreStore)).toEqual({ status: "loading", universe: universe("Acme") });
        pending[1].reject(new Error("offline"));
        await settle();
        expect(get(exploreStore)).toEqual({ status: "failed", universe: universe("Acme") });
    });

    it("ignores an answer from a previous room", async () => {
        const first = fakeConnection();
        const second = fakeConnection();
        exploreStore.load(first.connection);
        exploreStore.load(second.connection);

        second.pending[0].resolve(universe("New"));
        first.pending[0].resolve(universe("Old"));
        await settle();
        expect(get(universeNameStore)).toBe("New");
    });
});
