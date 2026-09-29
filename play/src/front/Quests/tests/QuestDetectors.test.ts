import { afterEach, describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";

const current = vi.hoisted(() => ({ scene: undefined as unknown }));
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
vi.mock("../../Stores/EmoteStore", async () => {
    const { writable } = await import("svelte/store");
    return { emotePlayedStore: writable(undefined) };
});

import type { GameScene } from "../../Phaser/Game/GameScene";
import { armQuestScene, CHAT_ROOM_RETRY_MS } from "../QuestDetectors";
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

    it("starts watching the proximity chat once the scene has created it", () => {
        vi.useFakeTimers();
        try {
            const holder: { chat?: unknown } = {};
            const subscribed = vi.fn();
            const scene = fakeScene();
            Object.defineProperty(scene, "proximityChatRoom", {
                get: () => {
                    if (!holder.chat) throw new Error("_proximityChatRoom not yet initialized");
                    return holder.chat;
                },
            });
            current.scene = scene;
            const disarm = armQuestScene(scene);
            expect(subscribed).not.toHaveBeenCalled();

            const messages = writable<unknown[]>([]);
            holder.chat = {
                currentSessionId: undefined,
                participants: writable([]),
                messages: {
                    subscribe: (run: (value: unknown[]) => void) => {
                        subscribed();
                        return messages.subscribe(run);
                    },
                },
            };
            vi.advanceTimersByTime(CHAT_ROOM_RETRY_MS);
            const calls = subscribed.mock.calls.length;
            expect(calls).toBeGreaterThan(0);

            // Found once: it doesn't keep looking or subscribe again.
            vi.advanceTimersByTime(CHAT_ROOM_RETRY_MS * 4);
            expect(subscribed).toHaveBeenCalledTimes(calls);
            disarm();
        } finally {
            vi.useRealTimers();
            current.scene = undefined;
        }
    });

    it("registers one area callback per map, however often it is armed", () => {
        const onEnterArea = vi.fn();
        const onPlayerMovementEnded = () => {};
        const map = {
            areasManager: { getCollidingAreas: () => [] },
            getAreas: () => new Map(areas.map((area) => [area.id, area])),
            onEnterArea,
        };
        const scene = {
            ...fakeScene(),
            getGameMapFrontWrapper: () => map,
            onPlayerMovementEnded,
        } as unknown as GameScene;
        current.scene = scene;
        const first = armQuestScene(scene);
        first();
        const second = armQuestScene(scene);
        second();
        expect(onEnterArea).toHaveBeenCalledTimes(1);
        current.scene = undefined;
    });
});
