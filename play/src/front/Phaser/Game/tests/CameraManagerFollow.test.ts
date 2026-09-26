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
const querySelectorOrFail = vi.hoisted(() => vi.fn());
vi.mock("../../../WebRtc/HtmlUtils", () => ({ HtmlUtils: { querySelectorOrFail } }));
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
        tweens: { addCounter: vi.fn((_config: { onComplete?: () => void }) => ({ stop: vi.fn() })) },
        scale: { zoom: 1 },
        reposition: vi.fn(),
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
    return { manager, camera, currentPlayer, remote, scene };
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

describe("CameraManager back to the player (your own row in the People tab)", () => {
    it("goes back to the player after looking at someone else", async () => {
        const { manager } = await makeCameraManager();
        const follow = vi.spyOn(manager, "startFollowPlayer");

        manager.followRemotePlayer("stitch");
        manager.returnToPlayer();

        expect(follow).toHaveBeenCalledTimes(2);
        expect(follow.mock.calls[1][0]).toMatchObject({ x: 10, y: 10 });
        // Closing the card afterwards doesn't move the camera again.
        manager.stopFollowRemotePlayer();
        expect(follow).toHaveBeenCalledTimes(2);
    });

    it("goes back to the player from exploring the map", async () => {
        const { manager } = await makeCameraManager();
        manager.setExplorationMode();
        const follow = vi.spyOn(manager, "startFollowPlayer");

        manager.returnToPlayer();

        expect(follow).toHaveBeenCalledTimes(1);
        expect(follow.mock.calls[0][0]).toMatchObject({ x: 10, y: 10 });
    });

    it("keeps an area lock: the player is in it, on screen", async () => {
        const { manager } = await makeCameraManager();
        manager.enterFocusMode({ x: 300, y: 300, width: 100, height: 100 }, 0, 0);
        const follow = vi.spyOn(manager, "startFollowPlayer");

        manager.returnToPlayer();

        expect(follow).not.toHaveBeenCalled();
    });

    it("does nothing when already following the player", async () => {
        const { manager, currentPlayer } = await makeCameraManager();
        manager.startFollowPlayer(currentPlayer as never);
        const follow = vi.spyOn(manager, "startFollowPlayer");

        manager.returnToPlayer();

        expect(follow).not.toHaveBeenCalled();
    });
});

describe("CameraManager after gliding back to the player", () => {
    /** Ends the most recent camera animation, as Phaser does when its tween completes. */
    function finishLastGlide(scene: { tweens: { addCounter: ReturnType<typeof vi.fn> } }) {
        const calls = scene.tweens.addCounter.mock.calls;
        const config = calls[calls.length - 1][0] as { onComplete?: () => void };
        config.onComplete?.();
    }

    function withCanvas() {
        querySelectorOrFail.mockReturnValue({ offsetWidth: 800, offsetHeight: 600 });
    }

    it("follows the player again, so an open chat panel keeps the player in the free space", async () => {
        withCanvas();
        const { manager, camera, scene } = await makeCameraManager();

        manager.followRemotePlayer("stitch");
        finishLastGlide(scene);
        manager.stopFollowRemotePlayer();
        finishLastGlide(scene);

        expect(scene.reposition).toHaveBeenCalled();
        camera.setFollowOffset.mockClear();
        // The chat panel covers the left 300px: the player is centred in the 500px left over.
        manager.updateCameraOffset({ xStart: 300, yStart: 0, xEnd: 800, yEnd: 600 }, true);
        expect(camera.setFollowOffset).toHaveBeenCalledWith(150, 0);
    });

    it("stays in exploration when exploring was asked for during the glide", async () => {
        withCanvas();
        const { manager, camera, scene } = await makeCameraManager();

        manager.followRemotePlayer("stitch");
        manager.setExplorationMode();
        camera.startFollow.mockClear();
        camera.setBounds.mockClear();
        finishLastGlide(scene);

        // The explorer keeps its free camera: not snapped back onto the player, map bounds not restored.
        expect(camera.startFollow).not.toHaveBeenCalled();
        expect(camera.setBounds).not.toHaveBeenCalled();
        expect(scene.reposition).not.toHaveBeenCalled();
        camera.setFollowOffset.mockClear();
        manager.updateCameraOffset({ xStart: 300, yStart: 0, xEnd: 800, yEnd: 600 }, true);
        expect(camera.setFollowOffset).not.toHaveBeenCalled();
    });
});
