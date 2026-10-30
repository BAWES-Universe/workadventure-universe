import { describe, expect, it, vi } from "vitest";
import { GameMapFrontWrapper } from "../GameMapFrontWrapper";

vi.hoisted(() => {
    // The wrapper only needs the Phaser name it aliases at import time, and the browser environment settings.
    (globalThis as unknown as { Phaser: unknown }).Phaser = { Tilemaps: { TilemapLayer: class {} } };
    (window as unknown as { env: Record<string, unknown> }).env = {};
});
vi.mock("../EntitiesManager", () => ({ EntitiesManager: class {} }));
vi.mock("../AreasManager", () => ({ AreasManager: class {} }));
vi.mock("../../../../Chat/Stores/AreaPresenceStore", () => ({ areaChatRooms: {}, collectAreaChatRoomIds: () => [] }));
vi.mock("../../../../Utils/PathfindingManager", () => ({ PathTileType: { Walkable: 0, Collider: 1 } }));

describe("closing the map", () => {
    it("removes its rooms and their pills, so a map rebuilt in place (WA.room.loadTileset) can set up its own", () => {
        const wrapper = Object.create(GameMapFrontWrapper.prototype) as GameMapFrontWrapper;
        const entitiesManager = { close: vi.fn() };
        const areasManager = { destroy: vi.fn() };
        const phaserMap = { removeLayer: vi.fn() };
        Object.assign(wrapper, { entitiesManager, areasManager, phaserMap });

        wrapper.close();

        expect(entitiesManager.close).toHaveBeenCalled();
        expect(areasManager.destroy).toHaveBeenCalledTimes(1);
        expect(wrapper.areasManager).toBeUndefined();
        // The new map creates its collision layers again under the same names
        expect(phaserMap.removeLayer).toHaveBeenCalledWith("__entitiesCollisionLayer");
        expect(phaserMap.removeLayer).toHaveBeenCalledWith("__areasCollisionLayer");
    });

    it("closes a map that never set up its rooms (a public map)", () => {
        const wrapper = Object.create(GameMapFrontWrapper.prototype) as GameMapFrontWrapper;
        const entitiesManager = { close: vi.fn() };
        Object.assign(wrapper, { entitiesManager, areasManager: undefined, phaserMap: { removeLayer: vi.fn() } });

        expect(() => wrapper.close()).not.toThrow();
        expect(entitiesManager.close).toHaveBeenCalled();
    });
});
