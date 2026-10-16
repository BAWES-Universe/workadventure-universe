import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
    return { currentMapRoom: { href: "" } };
});

vi.mock("../../Game/GameManager", () => ({
    gameManager: {
        get currentMapRoom() {
            return mocks.currentMapRoom;
        },
    },
}));
vi.mock("../../../Connection/LocalUserStore", () => ({ localUserStore: { getAuthToken: () => "token" } }));

import { companionListMetakey, CompanionTexturesLoadingManager } from "../CompanionTexturesLoadingManager";

const DEFAULT_WORLD = "https://play.example.com/@/default/hub/lobby";
const OTHER_UNIVERSE = "https://play.example.com/@/studio/film/stage";

// The page loads once; the companion picker must list the companions of the map the player is on. #848
describe("companion list", () => {
    beforeEach(() => {
        mocks.currentMapRoom = { href: DEFAULT_WORLD };
    });

    it("is cached per map, so a trip to another world is not served the first world's list", () => {
        const first = companionListMetakey();
        mocks.currentMapRoom = { href: OTHER_UNIVERSE };
        expect(companionListMetakey()).not.toBe(first);
        expect(companionListMetakey()).toBe("companion-list" + OTHER_UNIVERSE);
    });

    it("is requested for the room of the map the player is on", () => {
        const json = vi.fn().mockResolvedValue(undefined);
        const manager = new CompanionTexturesLoadingManager({ json } as never, {} as never);

        mocks.currentMapRoom = { href: OTHER_UNIVERSE };
        manager.loadTextures(vi.fn());

        const url = new URL(json.mock.calls[0][1] as string);
        expect(url.searchParams.get("roomUrl")).toBe(OTHER_UNIVERSE);
    });
});
