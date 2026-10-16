import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";

// Execute the actual canonical method in a small scene harness, without booting
// unrelated Phaser/WebRTC/browser subsystems. No copy of its implementation.
const source = ts.createSourceFile(
    "GameScene.ts",
    readFileSync("src/front/Phaser/Game/GameScene.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true
);
const scene = source.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === "GameScene");
const method = scene.members.find(
    (node) => ts.isMethodDeclaration(node) && node.name.getText(source) === "handleCurrentPlayerHasMovedEvent"
);
const code = ts.transpileModule(`(function (event) ${method.body.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

describe("native soundscape canonical player position", () => {
    it.each([true, false])("updates before property dispatch for movement/teleport (moving=%s)", (moving) => {
        const listener = writable({ x: 1, y: 2 });
        const handler = new Script(code).runInNewContext({ nativeSoundscapeListenerStore: listener });
        const positions = [];
        const target = {
            pushPlayerPosition: vi.fn(),
            gameMapFrontWrapper: {
                setPosition: () => positions.push(get(listener)),
                getActivatableEntities: () => [],
            },
            activatablesManager: {
                updateActivatableObjectsDistances: vi.fn(),
                deduceSelectedActivatableObjectByDistance: vi.fn(),
            },
            MapPlayersByKey: new Map(),
            actionableItems: new Map(),
            onPlayerMovementEndedCallbacks: [],
            hasMovedThisFrame: false,
        };
        handler.call(target, { x: 300, y: 500, moving, direction: "down" });
        expect(get(listener)).toEqual({ x: 300, y: 500 });
        expect(positions).toEqual([{ x: 300, y: 500 }]);
    });
});
