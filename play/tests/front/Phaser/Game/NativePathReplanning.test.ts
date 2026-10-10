/* eslint-disable no-await-in-loop -- Each simulated frame/transition must settle before the next one. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/front/Phaser/Entity/Character", () => ({
    CHARACTER_BODY_HEIGHT: 16,
    CHARACTER_BODY_OFFSET_X: 0,
    CHARACTER_BODY_OFFSET_Y: 8,
}));

import { PathfindingManager, PathTileType } from "../../../../src/front/Utils/PathfindingManager";

type Point = { x: number; y: number };
type MovementResult = Point & { cancelled: boolean };
interface NativePlayer extends Point {
    pathToFollow?: Point[];
    getCurrentPathDestinationPoint(coordinates?: "sprite" | "floor"): Point | undefined;
    followPath(delta: number): void;
    finishFollowingPath(cancelled?: boolean): void;
}
interface NativeScene {
    moveTo(position: Point, nearest?: boolean, speed?: number): Promise<MovementResult>;
    subscribeToGameMapChanged(): void;
}
interface NativeWrapper {
    collisionGrid: number[][];
    mapChangedSubject: { next(grid: number[][]): void };
    setLayerVisibility(name: string, visible: boolean): void;
    updateCollisionGrid(layer?: unknown, useCache?: boolean): void;
}
interface NativePointer {
    gameScene: NativeScene;
    handlePointerUpEvent(pointer: unknown, objects: unknown[]): void;
}

// Compile the actual method bodies, without starting Phaser, networking or a game scene.
// The production PathfindingManager and installed EasyStar run directly, with async fake timers.
function nativeClass<T>(file: string, names: string[], globals: Record<string, unknown> = {}): new () => T {
    const source = readFileSync(resolve("src/front", file), "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(ts.isClassDeclaration)!;
    const methods = names.map((name) => {
        const method = declaration.members.find((member) => member.name?.getText(ast) === name);
        if (!method) throw new Error(`Missing production method ${file}:${name}`);
        return method.getText(ast);
    });
    const compiled = ts.transpileModule(`class Extracted { ${methods.join("\n")} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    return runInNewContext(`${compiled}; Extracted`, { console, ...globals }) as new () => T;
}

const Player = nativeClass<NativePlayer>(
    "Phaser/Player/Player.ts",
    [
        "setPathToFollow",
        "getCurrentPathDestinationPoint",
        "finishFollowingPath",
        "adjustPathToFollowToColliderBounds",
        "followPath",
        "deduceSpeed",
        "moveToPos",
    ],
    {
        WOKA_SPEED: 9,
        passStatusToOnline: () => {},
        hasMovedEventName: "hasMoved",
        PositionMessage_Direction: { DOWN: 0, LEFT: 1, RIGHT: 2, UP: 3 },
    }
);
const Scene = nativeClass<NativeScene>("Phaser/Game/GameScene.ts", ["moveTo", "subscribeToGameMapChanged"]);
const Wrapper = nativeClass<NativeWrapper>(
    "Phaser/Game/GameMap/GameMapFrontWrapper.ts",
    ["setLayerVisibility", "findPhaserLayer", "findPhaserLayers", "getLayerCollisionGrid", "updateCollisionGrid"],
    {
        PathTileType,
        GameMapProperties: {
            COLLIDES: "collides",
            EXIT_URL: "exitUrl",
            EXIT_SCENE_URL: "exitSceneUrl",
            START: "start",
            START_LAYER: "startLayer",
        },
    }
);
const Pointer = nativeClass<NativePointer>("Phaser/UserInput/GameSceneUserInputHandler.ts", ["handlePointerUpEvent"], {
    get: (value: unknown) => value,
    mapEditorToolbarInUseStore: false,
    botEditorToolActiveStore: false,
    isActivatable: () => false,
    isQuickTap: () => true,
    Player,
    RemotePlayer: class {},
});

function fixture(start: Point = { x: 80, y: 192 }) {
    const grid = Array.from({ length: 8 }, (_, y) =>
        Array.from({ length: 8 }, (_, x) => (x === 0 || y === 0 || x === 7 || y === 7 ? 1 : 0))
    );
    const names = ["collision-permanent", "shell/art", "roof/art", "terrace/art", "lounge/art"];
    const layers = names.map((name, index) => ({
        visible: true,
        layerIndex: index,
        layer: {
            name,
            properties: [],
            data: grid.map((row) =>
                row.map((value) => ({
                    index: index === 0 && value ? 1 : -1,
                    properties: index === 0 && value ? { collides: true } : {},
                }))
            ),
        },
        setVisible(visible: boolean) {
            this.visible = visible;
        },
        setCollisionByProperty() {},
    }));
    const wrapper: NativeWrapper = Object.assign(new Wrapper(), {
        phaserLayers: layers,
        perLayerCollisionGridCache: new Map(),
        gameMap: { getMap: () => ({ width: 8, height: 8 }) },
        mapChangedSubject: { next: vi.fn() },
        getMapChangedObservable: () => ({
            subscribe(callback: (grid: number[][]) => void) {
                wrapper.mapChangedSubject = { next: callback };
                return { unsubscribe: vi.fn() };
            },
        }),
    });
    wrapper.updateCollisionGrid(undefined, false);
    const manager = new PathfindingManager(wrapper.collisionGrid, { width: 32, height: 32 });
    const body = { height: 16, offset: { y: 8 }, setDirectControl: vi.fn() };
    const player = Object.assign(new Player(), start, {
        walkingSpeed: 9,
        currentPathSegmentDistanceFromStart: 0,
        _lastDirection: 3,
        body,
        getBody: () => body,
        stop: vi.fn(),
        setDepth: vi.fn(),
        playAnimation: vi.fn(),
        emit: vi.fn(),
        scene: { markDirty: vi.fn() },
    });
    const scene = Object.assign(new Scene(), {
        CurrentPlayer: player,
        pathfindingManager: manager,
        gameMapFrontWrapper: wrapper,
        getPathfindingManager: () => manager,
        markDirty: vi.fn(),
        userInputManager: { isControlsEnabled: true, isRightClickEnabled: true },
        getCameraManager: () => ({ getCamera: () => ({ scrollX: 0, scrollY: 0 }) }),
    });
    scene.subscribeToGameMapChanged();
    const pointer = Object.assign(new Pointer(), { gameScene: scene });
    const click = (position: Point, touch = false) =>
        pointer.handlePointerUpEvent(
            {
                ...position,
                wasTouch: touch,
                leftButtonReleased: () => false,
                getDuration: () => 100,
            },
            []
        );
    return { player, scene, wrapper, manager, click, grid, layers };
}

async function finish(player: NativePlayer) {
    for (let frame = 0; player.pathToFollow && frame < 1000; frame++) {
        player.followPath(1000 / 60);
        await vi.runAllTimersAsync();
    }
    expect(player.pathToFollow).toBeUndefined();
}

describe("native click/tap visibility replanning", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it.each([false, true])("keeps the intended endpoint when a decorative group hides (touch=%s)", async (touch) => {
        const f = fixture();
        f.click({ x: 80, y: 144 }, touch);
        await vi.runAllTimersAsync();
        expect(f.player.getCurrentPathDestinationPoint()).toEqual({ x: 80, y: 128 });
        expect(f.player.getCurrentPathDestinationPoint("floor")).toEqual({ x: 80, y: 144 });
        while (f.player.y > 141) f.player.followPath(1000 / 60);
        f.wrapper.setLayerVisibility("shell", false);
        await vi.runAllTimersAsync();
        expect(f.wrapper.collisionGrid).toEqual(f.grid);
        await finish(f.player);
        expect({ x: f.player.x, y: f.player.y }).toEqual({ x: 80, y: 128 });
    });

    it("preserves a non-centred fitted endpoint through every one of 16 visibility states", async () => {
        const f = fixture();
        f.click({ x: 87, y: 155 });
        await vi.runAllTimersAsync();
        for (let mask = 0; mask < 16; mask++) {
            ["shell", "roof", "terrace", "lounge"].forEach((name, bit) =>
                f.wrapper.setLayerVisibility(name, !!(mask & (1 << bit)))
            );
            await vi.runAllTimersAsync();
            expect(f.wrapper.collisionGrid).toEqual(f.grid);
            expect(f.layers[0].visible).toBe(true);
            expect(f.player.getCurrentPathDestinationPoint()).toEqual({ x: 87, y: 139 });
        }
        await finish(f.player);
        expect({ x: f.player.x, y: f.player.y }).toEqual({ x: 87, y: 139 });
    });

    it("keeps a newer pointer target when another layer changes before its callback arrives", async () => {
        const f = fixture();
        f.click({ x: 80, y: 144 });
        await vi.runAllTimersAsync();
        f.wrapper.setLayerVisibility("shell", false);
        f.click({ x: 176, y: 176 }, true);
        f.wrapper.setLayerVisibility("roof", false);
        f.wrapper.setLayerVisibility("terrace", false);
        await vi.runAllTimersAsync();
        expect(f.player.getCurrentPathDestinationPoint()).toEqual({ x: 176, y: 160 });
        await finish(f.player);
        expect({ x: f.player.x, y: f.player.y }).toEqual({ x: 176, y: 160 });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("preserves strict blocked-target semantics while replaying a pending request", async () => {
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const f = fixture();
            const pending = f.scene.moveTo({ x: 0, y: 0 }, false);
            f.wrapper.setLayerVisibility("shell", false);
            await vi.runAllTimersAsync();
            expect((await pending).cancelled).toBe(true);
            expect(f.player.pathToFollow).toBeUndefined();
            expect({ x: f.player.x, y: f.player.y }).toEqual({ x: 80, y: 192 });
            expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: "No path found" }));
        } finally {
            warning.mockRestore();
        }
    });

    it("settles replaced movement promises as cancelled and leaves the final command successful", async () => {
        const f = fixture();
        const old = f.scene.moveTo({ x: 80, y: 144 }, true);
        await vi.runAllTimersAsync();
        const pending = f.scene.moveTo({ x: 144, y: 144 }, true);
        const latest = f.scene.moveTo({ x: 176, y: 176 }, true);
        await vi.runAllTimersAsync();
        expect((await old).cancelled).toBe(true);
        expect((await pending).cancelled).toBe(true);
        await finish(f.player);
        expect(await latest).toEqual({ x: 176, y: 160, cancelled: false });
    });

    it("handles repeated doorway hide/show and alternating desktop/mobile return commands", async () => {
        const f = fixture();
        for (let repeat = 0; repeat < 20; repeat++) {
            const target = repeat % 2 ? { x: 80, y: 208 } : { x: 80, y: 144 };
            f.click(target, !!(repeat % 2));
            await vi.runAllTimersAsync();
            f.player.followPath(1000 / 60);
            f.wrapper.setLayerVisibility("shell", !!(repeat % 2));
            await vi.runAllTimersAsync();
            await finish(f.player);
            expect({ x: f.player.x, y: f.player.y }).toEqual({ x: target.x, y: target.y - 16 });
        }
        expect(f.scene.userInputManager.isControlsEnabled).toBe(true);
        expect(f.scene.userInputManager.isRightClickEnabled).toBe(true);
    });
});
