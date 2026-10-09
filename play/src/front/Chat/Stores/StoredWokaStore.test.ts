import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";

const wokaBase64 = vi.hoisted(() => vi.fn(() => Promise.resolve("data:image/png;base64,woka")));

vi.mock("../../Phaser/Entity/CharacterLayerManager", () => ({ CharacterLayerManager: { wokaBase64 } }));
vi.mock("@sentry/svelte", () => ({ captureException: vi.fn() }));

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
        expect(wokaBase64).toHaveBeenCalledWith([
            { id: "male1", url: "resources/male1.png" },
            { id: "hat1", url: "resources/hat1.png" },
        ]);
        expect(seen[0]).toBeUndefined();
    });
});
