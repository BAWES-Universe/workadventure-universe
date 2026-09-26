import { beforeAll, describe, expect, it, vi } from "vitest";

// The camera manager only needs a few Phaser names here.
beforeAll(() => {
    class EventEmitter {
        emit() {
            return true;
        }
        on() {
            return this;
        }
        off() {
            return this;
        }
        removeAllListeners() {
            return this;
        }
    }
    vi.stubGlobal("Phaser", {
        Events: { EventEmitter },
        Cameras: { Scene2D: { Events: { PAN_START: "panstart", PAN_COMPLETE: "pancomplete" } } },
        Scenes: { Events: { UPDATE: "update" } },
        Math: { Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)) },
    });
});

vi.mock("../../Services/WaScaleManager", () => ({
    waScaleManager: {},
    WaScaleManagerEvent: { RefreshFocusOnTarget: "refresh" },
}));
vi.mock("../../../Stores/MapEditorStore", async () => {
    const { writable } = await import("svelte/store");
    return { mapEditorModeStore: writable(false) };
});
vi.mock("../../../WebRtc/HtmlUtils", () => ({ HtmlUtils: { querySelectorOrFail: vi.fn() } }));
vi.mock("../../Player/Player", () => ({ hasMovedEventName: "hasMoved" }));
vi.mock("../../UserInput/UserInputManager", () => ({ UserInputEvent: {} }));
vi.mock("../../../Utils/Debuggers", () => ({ debugZoom: () => undefined }));

function makeCamera() {
    return {
        startFollow: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        setBounds: vi.fn(),
        centerOn: vi.fn(),
        pan: vi.fn(),
        stopFollow: vi.fn(),
        setFollowOffset: vi.fn(),
        panEffect: { isRunning: false, reset: vi.fn() },
        centerX: 0,
        centerY: 0,
        scrollX: 0,
        scrollY: 0,
        width: 800,
        height: 600,
        zoom: 1,
        worldView: { x: 0, y: 0, width: 800, height: 600 },
        scaleManager: { zoom: 1 },
    };
}

async function makeCameraManager() {
    const { CameraManager } = await import("../CameraManager");
    const camera = makeCamera();
    const currentPlayer = { x: 10, y: 10, once: vi.fn() };
    const remote = { x: 500, y: 500, userUuid: "stitch", once: vi.fn() };
    const scene = {
        cameras: { main: camera },
        CurrentPlayer: currentPlayer,
        MapPlayersByKey: new Map([[1, remote]]),
        markDirty: vi.fn(),
        game: { events: { on: vi.fn(), off: vi.fn() } },
        tweens: { addCounter: vi.fn(() => ({ stop: vi.fn() })) },
        scale: { zoom: 1 },
        events: { on: vi.fn(), off: vi.fn() },
    };
    const scale = {
        zoomModifier: 1,
        saveZoom: vi.fn(),
        getSaveZoom: () => 1,
        setFocusTarget: vi.fn(),
        getFocusTarget: vi.fn(),
        getTargetZoomModifierFor: () => 1,
    };
    const manager = new CameraManager(scene as never, { width: 1000, height: 1000 }, scale as never);
    return { manager, camera, currentPlayer, remote };
}

describe("CameraManager following another player", () => {
    it("leaves the camera alone when nobody else is followed (the woka menu store starts empty)", async () => {
        const { manager, camera } = await makeCameraManager();
        manager.enterFocusMode({ x: 300, y: 300, width: 100, height: 100 }, 0, 0);
        camera.startFollow.mockClear();

        manager.stopFollowRemotePlayer();

        expect(camera.startFollow).not.toHaveBeenCalled();
    });

    it("goes back to the player after following someone else", async () => {
        const { manager } = await makeCameraManager();
        const follow = vi.spyOn(manager, "startFollowPlayer");

        manager.followRemotePlayer("stitch");
        manager.stopFollowRemotePlayer();

        expect(follow).toHaveBeenCalledTimes(2);
        expect(follow.mock.calls[1][0]).toMatchObject({ x: 10, y: 10 });
    });

    it("keeps an area lock that started after following someone", async () => {
        const { manager } = await makeCameraManager();
        const follow = vi.spyOn(manager, "startFollowPlayer");

        manager.followRemotePlayer("stitch");
        manager.enterFocusMode({ x: 300, y: 300, width: 100, height: 100 }, 0, 0);
        manager.stopFollowRemotePlayer();

        expect(follow).toHaveBeenCalledTimes(1);
    });
});
