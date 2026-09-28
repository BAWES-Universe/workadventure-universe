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

async function makeCameraManager() {
    const { CameraManager } = await import("../CameraManager");
    const camera = {
        startFollow: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        setBounds: vi.fn(),
        setFollowOffset: vi.fn(),
        panEffect: { isRunning: false, reset: vi.fn() },
        scrollX: 0,
        scrollY: 0,
        width: 800,
        height: 600,
        worldView: { x: 0, y: 0, width: 800, height: 600 },
        scaleManager: { zoom: 1 },
    };
    const player = { x: 400, y: 300, once: vi.fn() };
    const scene = {
        cameras: { main: camera },
        CurrentPlayer: player,
        MapPlayersByKey: new Map(),
        markDirty: vi.fn(),
        game: { events: { on: vi.fn(), off: vi.fn() } },
        tweens: { addCounter: vi.fn(() => ({ stop: vi.fn() })) },
        scale: { zoom: 1 },
        reposition: vi.fn(),
        events: { on: vi.fn(), off: vi.fn() },
        applyWhiteMask: vi.fn(),
        removeWhiteMask: vi.fn(),
    };
    const scale = {
        zoomModifier: 1,
        getTargetZoomModifierFor: () => 1,
    };
    const manager = new CameraManager(scene as never, { width: 1000, height: 1000 }, scale as never);
    return { manager, scene, scale, player };
}

/** The per-frame resistance callbacks registered on the scene, not counting the zoom animation. */
function resistanceUpdates(scene: { events: { on: ReturnType<typeof vi.fn> } }, manager: object) {
    const animate = (manager as { animateCallback: unknown }).animateCallback;
    return scene.events.on.mock.calls
        .filter(([event, callback]) => event === "update" && callback !== animate)
        .map(([, callback]) => callback as (time: number, delta: number) => void);
}

describe("CameraManager zoom resistance zone (explore the room)", () => {
    it("calls back once the zoom goes past the end of the zone", async () => {
        const { manager, scene, scale, player } = await makeCameraManager();
        const onPassed = vi.fn();
        manager.setResistanceZone(0.6, 0.3, 1, onPassed, true, undefined, player as never);

        scale.zoomModifier = 0.5;
        manager.zoomByFactor(0.9, true);
        const [resist] = resistanceUpdates(scene, manager);
        expect(resist).toBeDefined();

        scale.zoomModifier = 0.25;
        resist(0, 16);

        expect(onPassed).toHaveBeenCalledTimes(1);
        expect(scene.removeWhiteMask).toHaveBeenCalled();
    });

    it("does not resist or call back once the zone is disabled", async () => {
        const { manager, scene, scale, player } = await makeCameraManager();
        const onPassed = vi.fn();
        manager.setResistanceZone(0.6, 0.3, 1, onPassed, true, undefined, player as never);
        manager.disableResistanceZone();

        scale.zoomModifier = 0.5;
        manager.zoomByFactor(0.9, true);

        expect(resistanceUpdates(scene, manager)).toHaveLength(0);
        expect(onPassed).not.toHaveBeenCalled();
    });

    it("only resists zooming back in when the camera is near the avatar", async () => {
        const { manager, scene, scale, player } = await makeCameraManager();
        const onPassed = vi.fn();
        // Reverse zone, as used while exploring: zooming in past 0.6 leaves.
        manager.setResistanceZone(0.3, 0.6, 1, onPassed, false, 100, player as never);
        scale.zoomModifier = 0.4;

        player.x = 5000;
        manager.zoomByFactor(1.1, true);
        expect(resistanceUpdates(scene, manager)).toHaveLength(0);

        player.x = 400;
        manager.zoomByFactor(1.1, true);
        const [resist] = resistanceUpdates(scene, manager);
        scale.zoomModifier = 0.7;
        resist(0, 16);

        expect(onPassed).toHaveBeenCalledTimes(1);
    });

    it("stops a resistance in progress when the zone is swapped", async () => {
        const { manager, scene, scale, player } = await makeCameraManager();
        const onEnter = vi.fn();
        manager.setResistanceZone(0.6, 0.3, 1, onEnter, true, undefined, player as never);
        scale.zoomModifier = 0.5;
        manager.zoomByFactor(0.9, true);
        const [resist] = resistanceUpdates(scene, manager);

        manager.setResistanceZone(0.3, 0.6, 1, vi.fn(), false, undefined, player as never);

        expect(scene.events.off).toHaveBeenCalledWith("update", resist);
        expect(scene.removeWhiteMask).toHaveBeenCalled();
        expect(onEnter).not.toHaveBeenCalled();
    });
});
