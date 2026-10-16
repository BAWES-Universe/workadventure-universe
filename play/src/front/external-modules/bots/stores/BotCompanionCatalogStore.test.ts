import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    room: { href: "https://play.test/_/universe/world/room1" } as { href: string } | undefined,
}));

vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        get currentMapRoom() {
            return mocks.room;
        },
    },
}));

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: () => "token" },
}));

vi.mock("../../../Enum/ComputedConst", () => ({
    ABSOLUTE_PUSHER_URL: "https://pusher.test/",
}));

function catalogResponse(name: string): Response {
    return new Response(JSON.stringify([{ name, textures: [] }]), { status: 200 });
}

async function loadModule() {
    vi.resetModules();
    return import("./BotCompanionCatalogStore");
}

// The page loads once; the list is the one of the map the player is on, not of the first one. #848
describe("BotCompanionCatalogStore", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.room = { href: "https://play.test/_/universe/world/room1" };
    });

    it("loads the list once for many callers in the same room", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(catalogResponse("a")));
        const { ensureBotCompanionCatalog, botCompanionCatalogStore } = await loadModule();

        await Promise.all([ensureBotCompanionCatalog(), ensureBotCompanionCatalog()]);
        await ensureBotCompanionCatalog();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(get(botCompanionCatalogStore)?.[0].name).toBe("a");
    });

    it("asks again for the room of the map the player moved to and drops the old list", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockImplementationOnce(() => Promise.resolve(catalogResponse("room1")))
            .mockImplementationOnce(() => Promise.resolve(catalogResponse("room2")));
        const { ensureBotCompanionCatalog, botCompanionCatalogStore } = await loadModule();

        await ensureBotCompanionCatalog();
        mocks.room = { href: "https://play.test/_/universe/world/room2" };
        const pending = ensureBotCompanionCatalog();
        expect(get(botCompanionCatalogStore)).toBeNull();
        await pending;

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(fetchSpy.mock.calls[1][0] as string).toContain(
            encodeURIComponent("https://play.test/_/universe/world/room2")
        );
        expect(get(botCompanionCatalogStore)?.[0].name).toBe("room2");
    });

    it("drops a list that arrives after the player moved to another world", async () => {
        let resolveFirst: (response: Response) => void = () => {};
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockImplementationOnce(
                () =>
                    new Promise<Response>((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockImplementationOnce(() => Promise.resolve(catalogResponse("room2")));
        const { ensureBotCompanionCatalog, botCompanionCatalogStore } = await loadModule();

        const pending = ensureBotCompanionCatalog();
        mocks.room = { href: "https://play.test/_/universe/world/room2" };
        resolveFirst(catalogResponse("room1"));
        await pending;

        expect(get(botCompanionCatalogStore)).toBeNull();

        await ensureBotCompanionCatalog();
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(get(botCompanionCatalogStore)?.[0].name).toBe("room2");
    });
});
