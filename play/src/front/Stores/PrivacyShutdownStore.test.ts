import { get } from "svelte/store";
import type { Writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
    peers: undefined as unknown as Writable<unknown[]>,
    visible: undefined as unknown as Writable<boolean>,
    live: undefined as unknown as Writable<boolean>,
}));

vi.mock("./PeerStore", async () => {
    const { writable } = await import("svelte/store");
    stores.peers = writable<unknown[]>([]);
    return { videoStreamElementsStore: stores.peers };
});
vi.mock("./VisibilityStore", async () => {
    const { writable } = await import("svelte/store");
    stores.visible = writable(true);
    return { visibilityStore: stores.visible };
});
vi.mock("./IsStreamingStore", async () => {
    const { writable } = await import("svelte/store");
    stores.live = writable(false);
    return { isLiveStreamingStore: stores.live };
});

describe("privacyShutdownStore (away mode)", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    async function load() {
        // The mocked stores outlive a test: put them back to "visible, alone, not live" before the store is built.
        await Promise.all([import("./PeerStore"), import("./VisibilityStore"), import("./IsStreamingStore")]);
        stores.peers.set([]);
        stores.visible.set(true);
        stores.live.set(false);
        const { privacyShutdownStore } = await import("./PrivacyShutdownStore");
        return privacyShutdownStore;
    }

    it("goes away when the game is hidden and nobody is near", async () => {
        const store = await load();
        stores.visible.set(false);
        expect(get(store)).toBe(true);
        stores.visible.set(true);
        expect(get(store)).toBe(false);
    });

    it("stays in the conversation when the game is hidden during a call", async () => {
        const store = await load();
        stores.peers.set([{}]);
        stores.visible.set(false);
        expect(get(store)).toBe(false);
    });

    it("goes away when the call ends while the game is hidden", async () => {
        const store = await load();
        stores.peers.set([{}]);
        stores.visible.set(false);
        stores.peers.set([]);
        expect(get(store)).toBe(true);
    });

    it("stays live when the last person leaves while speaking live", async () => {
        const store = await load();
        stores.peers.set([{}]);
        stores.live.set(true);
        stores.visible.set(false);
        stores.peers.set([]);
        expect(get(store)).toBe(false);
    });

    it("goes away when a live session ends in the background with nobody near", async () => {
        const store = await load();
        stores.live.set(true);
        stores.visible.set(false);
        expect(get(store)).toBe(false);
        stores.live.set(false);
        expect(get(store)).toBe(true);
    });
});
