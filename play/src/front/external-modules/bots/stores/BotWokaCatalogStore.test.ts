import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    room: { href: "https://play.test/_/universe/world/room1" } as { href: string } | undefined,
}));

vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        get currentStartedRoom() {
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
    return new Response(JSON.stringify({ woka: { collections: [{ name, position: 0, textures: [] }] } }), {
        status: 200,
    });
}

async function loadModule() {
    vi.resetModules();
    return import("./BotWokaCatalogStore");
}

describe("BotWokaCatalogStore", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.room = { href: "https://play.test/_/universe/world/room1" };
    });

    it("loads the catalogue once for many callers in the same room", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(catalogResponse("a")));
        const { ensureBotWokaCatalog, botWokaCatalogStore } = await loadModule();

        await Promise.all([ensureBotWokaCatalog(), ensureBotWokaCatalog(), ensureBotWokaCatalog()]);
        await ensureBotWokaCatalog();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(get(botWokaCatalogStore)?.woka.collections[0].name).toBe("a");
    });

    it("reloads and clears the old catalogue when the room changes", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockImplementationOnce(() => Promise.resolve(catalogResponse("room1")))
            .mockImplementationOnce(() => Promise.resolve(catalogResponse("room2")));
        const { ensureBotWokaCatalog, botWokaCatalogStore } = await loadModule();

        await ensureBotWokaCatalog();
        mocks.room = { href: "https://play.test/_/universe/world/room2" };
        const pending = ensureBotWokaCatalog();
        expect(get(botWokaCatalogStore)).toBeNull();
        await pending;

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(get(botWokaCatalogStore)?.woka.collections[0].name).toBe("room2");
    });

    it("retries after a failed load", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockImplementationOnce(() => Promise.resolve(new Response("", { status: 500 })))
            .mockImplementationOnce(() => Promise.resolve(catalogResponse("a")));
        const { ensureBotWokaCatalog, botWokaCatalogStore } = await loadModule();

        await ensureBotWokaCatalog();
        expect(get(botWokaCatalogStore)).toBeNull();
        await ensureBotWokaCatalog();

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(get(botWokaCatalogStore)).not.toBeNull();
    });
});
