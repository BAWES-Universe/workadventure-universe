import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { tryGetCurrentGameScene, getCurrentGameScene } = vi.hoisted(() => ({
    tryGetCurrentGameScene: vi.fn(),
    getCurrentGameScene: vi.fn(),
}));

vi.mock("phaser", () => ({
    default: {
        Input: {
            Keyboard: { KeyCodes: { SHIFT: 16, ESC: 27, DELETE: 46 } },
            Events: { POINTER_DOWN: "pointerdown", POINTER_MOVE: "pointermove", POINTER_UP: "pointerup" },
        },
    },
}));
vi.mock("../../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: { tryGetCurrentGameScene, getCurrentGameScene },
}));
vi.mock("../../../../src/front/Stores/MapEditorStore", async () => {
    const { writable } = await import("svelte/store");
    return { mapEditorVisibilityStore: writable(true) };
});
vi.mock("../../../../src/front/external-modules/bots/phaser/WaypointPath", () => ({
    WaypointPath: vi.fn(),
    WaypointPathEvent: {},
}));
vi.mock("../../../../src/front/external-modules/bots/phaser/BotPreview", () => ({
    BotPreview: vi.fn(),
    BotPreviewEvent: {},
}));

import { BotEditorTool } from "../../../../src/front/external-modules/bots/phaser/BotEditorTool";

function makeScene(alive: boolean) {
    const addKey = vi.fn(() => {
        if (!alive) throw new TypeError("null is not an object (evaluating 'this.manager.addCapture')");
        return {};
    });
    const input = {
        keyboard: { manager: alive ? {} : null, addKey },
        on: vi.fn(),
        off: vi.fn(),
        setDefaultCursor: vi.fn(),
    };
    return {
        sys: { isActive: () => alive },
        input,
        markDirty: vi.fn(),
        addKey,
    };
}

describe("BotEditorTool.activate", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});
        tryGetCurrentGameScene.mockReset();
        getCurrentGameScene.mockReset();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("does not use a replaced, shut down scene and activates once the new scene runs", () => {
        const deadScene = makeScene(false);
        const liveScene = makeScene(true);
        // During a room change there is no current scene yet; getCurrentGameScene would return the replaced one
        tryGetCurrentGameScene.mockReturnValue(undefined);
        getCurrentGameScene.mockReturnValue(deadScene);

        const tool = new BotEditorTool();
        expect(() => tool.activate()).not.toThrow();
        expect(deadScene.addKey).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith("BotEditorTool: Cannot activate - no scene available");

        tryGetCurrentGameScene.mockReturnValue(liveScene);
        vi.advanceTimersByTime(300);
        expect(liveScene.addKey).toHaveBeenCalledTimes(3);
        tool.deactivate();
    });

    it("skips a current scene whose keyboard plugin was destroyed", () => {
        tryGetCurrentGameScene.mockReturnValue(makeScene(false));
        const tool = new BotEditorTool();
        expect(() => tool.activate()).not.toThrow();
        tool.deactivate();
        vi.advanceTimersByTime(1000);
        expect(tryGetCurrentGameScene).toHaveBeenCalledTimes(1);
    });
});
