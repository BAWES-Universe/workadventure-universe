import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../../../../src/front/Phaser/Game/Game";
import { HdpiManager } from "../../../../src/front/Phaser/Services/HdpiManager";
import { WaScaleManager } from "../../../../src/front/Phaser/Services/WaScaleManager";

const { viewport, gameElement } = vi.hoisted(() => ({
    viewport: { width: 1280, height: 720 },
    gameElement: { style: { width: "", height: "" } },
}));

vi.mock("../../../../src/front/Stores/CoWebsiteStore", () => ({
    coWebsiteManager: { getGameSize: () => viewport },
}));
vi.mock("../../../../src/front/WebRtc/HtmlUtils", () => ({
    HtmlUtils: { getElementByIdOrFail: () => gameElement },
}));
vi.mock("../../../../src/front/Phaser/Login/ResizableScene", () => ({
    ResizableScene: class {},
}));

function makeCamera(zoom = 1) {
    return {
        zoom,
        scene: undefined as Phaser.Scene | null | undefined,
        setZoom: vi.fn(function (this: { zoom: number }, value: number) {
            this.zoom = value;
        }),
    };
}

function makeGame(camera = makeCamera()) {
    const scale = {
        width: 0,
        height: 0,
        zoom: 1,
        canvas: { style: { width: "", height: "" } },
        displaySize: { width: 0, height: 0 },
        resize: vi.fn(function (this: { width: number; height: number }, width: number, height: number) {
            this.width = Math.floor(width);
            this.height = Math.floor(height);
        }),
        setZoom: vi.fn(function (this: { zoom: number }, zoom: number) {
            this.zoom = zoom;
        }),
        refresh: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    };
    const scene = { cameras: { main: camera, cameras: [camera] } };
    camera.scene = scene as unknown as Phaser.Scene;
    const game = {
        scale,
        domContainer: { style: { transform: "" } },
        scene: { getScenes: vi.fn(() => [scene]) },
        events: { emit: vi.fn() },
        markDirty: vi.fn(),
    };
    return { camera, scene, game, scale };
}

function makeManager() {
    const fixture = makeGame();
    const manager = new WaScaleManager(640 * 480, 196 * 196);
    manager.setGame(fixture.game as unknown as Game);
    // Keep the fixture's map-fit clamp below the zoom values being tested.
    manager.maxZoomOut = 0.05;
    return { ...fixture, manager };
}

function asCamera(camera: ReturnType<typeof makeCamera>): Phaser.Cameras.Scene2D.Camera {
    return camera as unknown as Phaser.Cameras.Scene2D.Camera;
}

describe("WaScaleManager camera continuity during resize", () => {
    beforeEach(() => {
        viewport.width = 1280;
        viewport.height = 720;
        vi.stubGlobal("window", { devicePixelRatio: 1 });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("can receive a resize before a game is attached", () => {
        const manager = new WaScaleManager(640 * 480, 196 * 196);
        expect(() => manager.applyNewSize()).not.toThrow();
    });

    it("preserves the default game resolution and CSS size", () => {
        const { manager, camera, scale } = makeManager();
        manager.setZoomModifier(1, asCamera(camera));
        expect([scale.width, scale.height]).toEqual([854, 480]);
        expect(scale.canvas.style).toEqual({ width: "1281px", height: "720px" });
        expect(camera.zoom).toBe(1);
        expect(manager.getActualZoom()).toBe(1.5);
    });

    it.each([1, 1.25, 1.5, 2, 3])("resets camera zoom when resizing into canvas scaling at DPR %s", (dpr) => {
        vi.stubGlobal("window", { devicePixelRatio: dpr });
        viewport.width = 1280 / dpr;
        viewport.height = 720 / dpr;
        const { manager, camera, scale } = makeManager();
        manager.setZoomModifier(0.4, asCamera(camera));
        expect(camera.zoom).toBeCloseTo(0.6);

        viewport.width = 2560 / dpr;
        viewport.height = 1440 / dpr;
        manager.applyNewSize();

        expect(camera.zoom).toBe(1);
        expect([scale.width, scale.height]).toEqual([2134, 1200]);
        expect(scale.width / camera.zoom).toBe(2134);
        expect(scale.canvas.style).toEqual({
            width: `${Math.ceil(2562 / dpr)}px`,
            height: `${Math.ceil(1440 / dpr)}px`,
        });
        expect(manager.zoomModifier).toBe(0.4);
    });

    it("applies camera zoom when resizing out of canvas scaling", () => {
        viewport.width = 2560;
        viewport.height = 1440;
        const { manager, camera } = makeManager();
        manager.setZoomModifier(0.4, asCamera(camera));
        expect(camera.zoom).toBe(1);

        viewport.width = 1280;
        viewport.height = 720;
        manager.applyNewSize();
        expect(camera.zoom).toBeCloseTo(0.6);
    });

    it("updates camera zoom within the low-zoom branch when the optimal scale changes", () => {
        const { manager, camera } = makeManager();
        manager.setZoomModifier(0.4, asCamera(camera));
        viewport.width = 800;
        viewport.height = 600;
        manager.applyNewSize();
        expect(camera.zoom).toBeCloseTo(0.4);
    });

    it("honors an explicit camera instead of the remembered one", () => {
        const { manager, camera } = makeManager();
        manager.setZoomModifier(0.4, asCamera(camera));
        const explicitCamera = makeCamera();
        camera.setZoom.mockClear();

        manager.setZoomModifier(0.3, asCamera(explicitCamera));
        expect(explicitCamera.zoom).toBeCloseTo(0.45);
        expect(camera.setZoom).not.toHaveBeenCalled();
    });

    it("does not select an unrelated active camera when none has been managed", () => {
        const { manager, camera } = makeManager();
        camera.zoom = 2;
        manager.applyNewSize();
        expect(camera.zoom).toBe(2);
        expect(camera.setZoom).not.toHaveBeenCalled();
    });

    it("leaves other active scene cameras alone", () => {
        const { manager, camera, scene, game } = makeManager();
        manager.setZoomModifier(0.4, asCamera(camera));
        const overlayCamera = makeCamera(2);
        const overlayScene = { cameras: { main: overlayCamera, cameras: [overlayCamera] } };
        overlayCamera.scene = overlayScene as unknown as Phaser.Scene;
        game.scene.getScenes.mockReturnValue([scene, overlayScene]);
        viewport.width = 2560;
        viewport.height = 1440;

        manager.applyNewSize();
        expect(camera.zoom).toBe(1);
        expect(overlayCamera.zoom).toBe(2);
        expect(overlayCamera.setZoom).not.toHaveBeenCalled();
    });

    it("does not reuse a camera from an inactive scene", () => {
        const { manager, camera, game } = makeManager();
        manager.setZoomModifier(0.4, asCamera(camera));
        camera.setZoom.mockClear();
        game.scene.getScenes.mockReturnValue([]);
        manager.applyNewSize();
        expect(game.scene.getScenes).toHaveBeenCalledWith(true);
        expect(camera.setZoom).not.toHaveBeenCalled();
    });

    it("does not reuse a removed camera or reset its replacement", () => {
        const { manager, camera, scene } = makeManager();
        manager.setZoomModifier(0.4, asCamera(camera));
        camera.setZoom.mockClear();
        const replacement = makeCamera(2);
        scene.cameras.main = replacement;
        scene.cameras.cameras = [replacement];
        replacement.scene = scene as unknown as Phaser.Scene;
        manager.applyNewSize();
        expect(camera.setZoom).not.toHaveBeenCalled();
        expect(replacement.setZoom).not.toHaveBeenCalled();
    });

    it.each([null, undefined])("does not reuse a destroyed camera whose scene is %s", (sceneAfterDestroy) => {
        const { manager, camera, scene } = makeManager();
        manager.setZoomModifier(0.4, asCamera(camera));
        camera.setZoom.mockClear();
        // Direct camera.destroy() clears its scene but does not remove it from the camera manager's array.
        camera.scene = sceneAfterDestroy;
        expect(scene.cameras.cameras).toContain(camera);

        manager.applyNewSize();
        expect(camera.setZoom).not.toHaveBeenCalled();
    });

    it("forgets the managed camera when the game is replaced", () => {
        const { manager, camera } = makeManager();
        manager.setZoomModifier(0.4, asCamera(camera));
        camera.setZoom.mockClear();
        // Even if a caller supplies the same scene camera in another game, setGame resets ownership.
        const replacement = makeGame(camera);
        manager.setGame(replacement.game as unknown as Game);
        manager.applyNewSize();
        expect(camera.setZoom).not.toHaveBeenCalled();
    });

    it("re-fits the next scene's camera on resize once that scene hands it over", () => {
        const { manager, camera, scene } = makeManager();
        manager.setZoomModifier(0.4, asCamera(camera));
        // The player leaves through an exit: the old scene's camera goes, the new scene brings a camera at zoom 1.
        const nextCamera = makeCamera();
        scene.cameras.main = nextCamera;
        scene.cameras.cameras = [nextCamera];
        nextCamera.scene = scene as unknown as Phaser.Scene;
        manager.applyNewSize(asCamera(nextCamera));
        expect(nextCamera.zoom).toBeCloseTo(0.6);

        viewport.width = 2560;
        viewport.height = 1440;
        manager.applyNewSize();
        expect(nextCamera.zoom).toBe(1);
    });

    it("restores both the saved zoom modifier and its camera component", () => {
        const { manager, camera } = makeManager();
        manager.setZoomModifier(0.4, asCamera(camera));
        manager.saveZoom();
        manager.setZoomModifier(1, asCamera(camera));
        manager.restoreZoom();
        expect(manager.zoomModifier).toBe(0.4);
        expect(camera.zoom).toBeCloseTo(0.6);
    });

    it("updates the remembered camera when a focused area is refitted without a camera argument", () => {
        const { manager, camera, game } = makeManager();
        manager.setZoomModifier(0.4, asCamera(camera));
        manager.setFocusTarget({ x: 1000, y: 1000, width: 4000, height: 2000 });
        manager.refreshFocusOnTarget();
        expect(camera.zoom).toBeCloseTo(1281 / 4000);
        expect(game.events.emit).toHaveBeenCalledWith("wa-scale-manager:refresh-focus-on-target", {
            x: 1000,
            y: 1000,
            width: 4000,
            height: 2000,
        });
    });
});

describe("WaScaleManager DOM layer scale", () => {
    beforeEach(() => {
        viewport.width = 1280;
        viewport.height = 720;
        vi.stubGlobal("window", { devicePixelRatio: 1 });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // Phaser's refresh() sets the DOM layer's scale to displaySize / baseSize, from its own zoom.
    function emulatePhaserRefresh(fixture: ReturnType<typeof makeManager>) {
        fixture.scale.refresh.mockImplementation(() => {
            fixture.game.domContainer.style.transform = `scale(${fixture.scale.zoom})`;
        });
    }

    it("keeps the DOM layer unscaled while the zoom goes through the camera", () => {
        const fixture = makeManager();
        emulatePhaserRefresh(fixture);
        fixture.manager.setZoomModifier(0.4, asCamera(fixture.camera));

        expect(fixture.camera.zoom).toBeCloseTo(0.6);
        // Phaser alone would leave `scale(0.6, 0.6)` here: the names would sit 40% closer to the top left.
        const [x, y] = /scale\(([\d.]+), ([\d.]+)\)/
            .exec(fixture.game.domContainer.style.transform)!
            .slice(1)
            .map(Number);
        expect(x).toBeCloseTo(1, 2);
        expect(y).toBeCloseTo(1, 2);
    });

    it("scales the DOM layer down by the pixel ratio when the zoom goes through the camera", () => {
        vi.stubGlobal("window", { devicePixelRatio: 2 });
        viewport.width = 640;
        viewport.height = 360;
        const fixture = makeManager();
        emulatePhaserRefresh(fixture);
        fixture.manager.setZoomModifier(0.4, asCamera(fixture.camera));

        const [x] = /scale\(([\d.]+), ([\d.]+)\)/.exec(fixture.game.domContainer.style.transform)!.slice(1).map(Number);
        expect(x).toBeCloseTo(0.5, 2);
    });

    it("puts the DOM layer's scale back when Phaser refreshes it on its own", () => {
        const fixture = makeManager();
        emulatePhaserRefresh(fixture);
        fixture.manager.setZoomModifier(0.4, asCamera(fixture.camera));

        const onResize = fixture.scale.on.mock.calls.find(([event]) => event === "resize")?.[1] as () => void;
        expect(onResize).toBeTypeOf("function");
        fixture.game.domContainer.style.transform = "scale(0.6, 0.6)";
        onResize();
        expect(fixture.game.domContainer.style.transform).toMatch(/^scale\(1(\.\d+)?, 1(\.\d+)?\)$/);
    });

    it("leaves Phaser's own DOM layer scale alone while the canvas is scaled", () => {
        const fixture = makeManager();
        emulatePhaserRefresh(fixture);
        fixture.manager.setZoomModifier(1, asCamera(fixture.camera));

        expect(fixture.camera.zoom).toBe(1);
        expect(fixture.game.domContainer.style.transform).toBe(`scale(${fixture.scale.zoom})`);
        const onResize = fixture.scale.on.mock.calls.find(([event]) => event === "resize")?.[1] as () => void;
        onResize();
        expect(fixture.game.domContainer.style.transform).toBe(`scale(${fixture.scale.zoom})`);
    });

    it("stops listening to the previous game when the game is replaced", () => {
        const fixture = makeManager();
        const next = makeGame();
        fixture.manager.setGame(next.game as unknown as Game);
        expect(fixture.scale.off).toHaveBeenCalledWith("resize", expect.any(Function));
        expect(next.scale.on).toHaveBeenCalledWith("resize", expect.any(Function));
    });
});

describe("HdpiManager existing small-screen behavior", () => {
    it.each([0.5, 1, 2])("currently keeps the physical screen size at zoom modifier %s", (modifier) => {
        const manager = new HdpiManager(640 * 480, 196 * 196);
        manager.zoomModifier = modifier;
        expect(manager.getOptimalGameSize({ width: 375, height: 667 })).toEqual({
            game: { width: 375, height: 667 },
            real: { width: 375, height: 667 },
        });
    });
});
