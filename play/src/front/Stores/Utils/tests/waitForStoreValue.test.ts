import { get, writable } from "svelte/store";
import { describe, expect, it } from "vitest";
import { waitForStoreValue } from "../waitForStoreValue";

describe("waitForStoreValue", () => {
    it("resolves once the store gets a value", async () => {
        const store = writable<string | undefined>(undefined);
        const waiting = waitForStoreValue(store);
        store.set("room");
        await expect(waiting).resolves.toBe("room");
    });

    it("resolves at once for a store that already has a value, and leaves nothing subscribed", async () => {
        const store = writable(true);
        await expect(waitForStoreValue(store)).resolves.toBe(true);

        // A subscriber left behind would run on the next change and break every store update after it.
        const other = writable(0);
        store.set(false);
        store.set(true);
        other.set(1);
        expect(get(other)).toBe(1);
        expect(get(store)).toBe(true);
    });
});
