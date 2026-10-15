import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";

const wokaBase64 = vi.hoisted(() => vi.fn(() => Promise.resolve("data:image/png;base64,woka")));

vi.mock("../../Phaser/Entity/CharacterLayerManager", () => ({ CharacterLayerManager: { wokaBase64 } }));
const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/svelte", () => ({ captureException }));

import { storedWokaStore } from "./StoredWokaStore";

describe("storedWokaStore", () => {
    it("has no picture for someone without a saved Woka", () => {
        expect(storedWokaStore(undefined)).toBeUndefined();
        expect(storedWokaStore([])).toBeUndefined();
    });

    it("draws nothing until the picture is shown, then draws their layers once", async () => {
        const store = storedWokaStore([
            { id: "male1", url: "resources/male1.png" },
            { id: "hat1", url: "resources/hat1.png" },
        ]);
        expect(wokaBase64).not.toHaveBeenCalled();

        const seen: (string | undefined)[] = [];
        const unsubscribe = store!.subscribe((value) => seen.push(value));
        await vi.waitFor(() => expect(get(store!)).toBe("data:image/png;base64,woka"));
        unsubscribe();

        expect(wokaBase64).toHaveBeenCalledTimes(1);
        expect(wokaBase64).toHaveBeenCalledWith(
            [
                { id: "male1", url: "resources/male1.png" },
                { id: "hat1", url: "resources/hat1.png" },
            ],
            { standIn: false }
        );
        expect(seen[0]).toBeUndefined();
    });

    it("stays without a picture, and sends nothing to Sentry, when the Woka's pictures can't be loaded", async () => {
        wokaBase64.mockImplementationOnce(() =>
            Promise.reject(new Error('Failed loading "spritesheet": "https://pictures.example/melon.png"'))
        );
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const store = storedWokaStore([{ id: "melon", url: "https://pictures.example/melon.png" }]);
        const seen: (string | undefined)[] = [];
        const unsubscribe = store!.subscribe((value) => seen.push(value));
        await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
        unsubscribe();

        expect(seen).toEqual([undefined]);
        expect(captureException).not.toHaveBeenCalled();
    });
});
