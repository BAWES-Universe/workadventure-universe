import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
});

// A player standing inside the Lounge, which others filled or locked: the closest spot outside is below it.
function sceneWithPlayerInsideClosedRoom() {
    const player = { x: 48, y: 48, teleportTo: vi.fn() };
    const wrapper = { initializeAreaManager: vi.fn() };
    const scene = {
        connection: {
            userCanEdit: false,
            getAllTags: () => [],
            hasPermission: () => false,
            emitSetAreaLock: vi.fn(),
        },
        gameMapFrontWrapper: wrapper,
        areaLiveState: undefined,
        CurrentPlayer: player,
        findSpotOutsideClosedRooms: () => ({ x: 48, y: 120 }),
    };
    return { scene, player, wrapper };
}

describe("setting up the rooms on the map", () => {
    async function initializeAreaManager(scene: unknown, arriving?: boolean): Promise<void> {
        const { GameScene } = await import("../GameScene");
        (
            GameScene.prototype as unknown as { initializeAreaManager(this: unknown, arriving?: boolean): void }
        ).initializeAreaManager.call(scene, arriving);
    }

    it("puts a player who arrives inside a room others filled or locked just outside it", async () => {
        const { scene, player, wrapper } = sceneWithPlayerInsideClosedRoom();

        await initializeAreaManager(scene);

        expect(wrapper.initializeAreaManager).toHaveBeenCalled();
        expect(player.teleportTo).toHaveBeenCalledWith(48, 120);
    }, 60_000);

    it("leaves a player inside a locked room where they are when a map script loads a tileset", async () => {
        const { scene, player, wrapper } = sceneWithPlayerInsideClosedRoom();

        await initializeAreaManager(scene, false);

        expect(wrapper.initializeAreaManager).toHaveBeenCalled();
        expect(player.teleportTo).not.toHaveBeenCalled();
    }, 60_000);
});
