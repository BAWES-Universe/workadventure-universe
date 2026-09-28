import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const current = vi.hoisted(() => ({ scene: undefined as unknown }));
vi.mock("../../Enum/EnvironmentVariable", () => ({ FEATURE_FLAG_QUESTS_PROOF_SLICE: true }));
vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../../Chat/UserProvider/ChatUserMapper", () => ({ isBotUser: () => false }));
vi.mock("../../Connection/LocalUserStore", () => ({ localUserStore: { getLocalUser: () => ({ uuid: "me" }) } }));
vi.mock("../../Phaser/Game/MapEditor/Commands/Entity/CreateEntityFrontCommand", () => ({
    CreateEntityFrontCommand: class {},
}));
vi.mock("../../Phaser/Game/MapEditor/MapEditorModeManager", () => ({
    mapEditorCommandExecuted$: { subscribe: () => ({ unsubscribe: () => {} }) },
}));
vi.mock("../../Phaser/Game/Say/sendSay", () => ({ saySent$: { subscribe: () => ({ unsubscribe: () => {} }) } }));
vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: { tryGetCurrentGameScene: () => current.scene },
}));
vi.mock("../../Stores/MenuStore", async () => {
    const { writable } = await import("svelte/store");
    return { mapEditorMenuVisibleStore: writable(false) };
});

import type { GameScene } from "../../Phaser/Game/GameScene";
import { armQuestScene } from "../QuestDetectors";
import { questWorldStore } from "../QuestStore";

const areas = [
    { id: "hall", name: "Hall", x: 0, y: 0, width: 64, height: 64 },
    { id: "garden", name: "Garden", x: 100, y: 0, width: 64, height: 64 },
    { id: "courtyard", name: "Courtyard", x: 1000, y: 1000, width: 64, height: 64 },
];

function fakeScene(): GameScene {
    return {
        MapPlayersByKey: {
            values: () => [][Symbol.iterator](),
            subscribe: () => () => {},
        },
        getGameMapFrontWrapper: () => ({
            areasManager: { getCollidingAreas: () => [] },
            getAreas: () => new Map(areas.map((area) => [area.id, area])),
            onEnterArea: () => {},
        }),
        CurrentPlayer: { x: 10, y: 10 },
        room: { roomName: "Lobby" },
        proximityChatRoom: undefined,
        onPlayerMovementEnded: () => {},
    } as unknown as GameScene;
}

afterEach(() => {
    history.replaceState(null, "", window.location.pathname);
});

describe("quest detectors", () => {
    it("picks up Orbit's Visit link on the room already open (a hash change, no new map)", async () => {
        const scene = fakeScene();
        current.scene = scene;
        const disarm = armQuestScene(scene);
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
        expect(get(questWorldStore).exploreTarget?.area.name).toBe("Garden");

        window.location.hash = "questArea=Courtyard&questHost=area:Hall";
        window.dispatchEvent(new HashChangeEvent("hashchange"));
        const world = get(questWorldStore);
        expect(world.exploreTarget?.area.name).toBe("Courtyard");
        expect(world.host).toMatchObject({ kind: "area", name: "Hall" });

        disarm();
        current.scene = undefined;
    });
});
