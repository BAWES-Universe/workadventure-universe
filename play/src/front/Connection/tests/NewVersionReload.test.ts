import { describe, expect, it } from "vitest";
import { AUTO_RELOAD_WINDOW_MS, MAX_AUTO_RELOADS, canAutoReload, recordAutoReload } from "../NewVersionReload";

function memoryStorage() {
    const items = new Map<string, string>();
    return {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
    };
}

describe("NewVersionReload", () => {
    it("allows automatic reloads until a couple have happened recently", () => {
        const storage = memoryStorage();
        const now = 1_000_000;
        for (let i = 0; i < MAX_AUTO_RELOADS; i++) {
            expect(canAutoReload(now + i, storage)).toBe(true);
            recordAutoReload(now + i, storage);
        }
        expect(canAutoReload(now + MAX_AUTO_RELOADS, storage)).toBe(false);
    });

    it("allows them again once the earlier reloads are old", () => {
        const storage = memoryStorage();
        const now = 1_000_000;
        for (let i = 0; i < MAX_AUTO_RELOADS; i++) recordAutoReload(now, storage);
        expect(canAutoReload(now + AUTO_RELOAD_WINDOW_MS, storage)).toBe(true);
    });

    it("allows reloading when there is no storage or its content is unreadable", () => {
        expect(canAutoReload(1, undefined)).toBe(true);
        const storage = memoryStorage();
        storage.setItem("universe.newVersionAutoReloads", "not json");
        expect(canAutoReload(1, storage)).toBe(true);
    });
});
