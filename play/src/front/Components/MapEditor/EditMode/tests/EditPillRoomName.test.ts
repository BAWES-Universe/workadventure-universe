import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    // Every text is its own key, so the pill renders without the real translations
    const texts = (path: string): unknown =>
        new Proxy(() => path, {
            get: (_target, key) => texts(`${path}.${String(key)}`),
        });
    const LL = readable(texts("LL"));
    return { LL, default: LL };
});
vi.mock("../../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        // The page started in Headquarters and has not reloaded since
        currentStartedRoom: { roomName: "Headquarters" },
        currentMapRoom: { roomName: "Headquarters" },
    },
}));
vi.mock("../../../../Phaser/Game/MapEditor/MapEditorModeManager", () => ({ EditorToolName: {} }));
vi.mock("../../../../Stores/MapEditorStore", async () => {
    const { writable } = await import("svelte/store");
    return { mapEditorVisibilityStore: writable(true) };
});
vi.mock("../../../../Stores/EditModeStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        editPillStore: writable(undefined),
        editUndoRedoStore: writable({ canUndo: false, canRedo: false }),
    };
});
vi.mock("../../../../Administration/AnalyticsClient", () => ({ analyticsClient: { toggleMapEditor: vi.fn() } }));

import { gameSceneStore } from "../../../../Stores/GameSceneStore";
import EditPill from "../EditPill.svelte";

// The page does not reload when the player walks through a portal, so the pill says the room of the map they are on.
describe("The edit pill's room name", () => {
    let target: HTMLElement;
    let pill: EditPill | undefined;

    afterEach(() => {
        pill?.$destroy();
        pill = undefined;
        target?.remove();
        gameSceneStore.set(undefined);
    });

    function mount() {
        target = document.createElement("div");
        document.body.appendChild(target);
        pill = new EditPill({ target });
    }

    const name = () => target.querySelector(".em-room")?.textContent;

    it("says the first room before another map has started", () => {
        mount();
        expect(name()).toBe("Headquarters");
    });

    it("follows the player to another room", async () => {
        gameSceneStore.set({ room: { roomName: "Food Capital" } } as never);
        mount();
        expect(name()).toBe("Food Capital");

        gameSceneStore.set({ room: { roomName: "Onboarding Area" } } as never);
        await tick();
        expect(name()).toBe("Onboarding Area");
    });
});
