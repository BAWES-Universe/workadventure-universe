import { beforeEach, describe, expect, it, vi } from "vitest";

const { getChatPusher, setPusher } = vi.hoisted(() => ({
    getChatPusher: vi.fn(),
    setPusher: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: { getChatPusher } }));
vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: { getChatConnection: () => Promise.resolve({ setPusher }) },
}));

const pusher = {
    kind: "http",
    app_id: "net.bawes.universe.web",
    pushkey: "d1",
    app_display_name: "Universe",
    device_display_name: "Chrome on Windows",
    lang: "en",
    data: { url: "https://orbit.example/_matrix/push/v1/notify", secret: "s" },
};

describe("direct messages to this device", () => {
    beforeEach(() => vi.clearAllMocks());

    it("sets Orbit's pusher on the chat, once per device and page", async () => {
        const { linkChatToDevice } = await import("../PushChatLink");
        getChatPusher.mockResolvedValue(pusher);
        await linkChatToDevice("d1");
        await linkChatToDevice("d1");
        expect(setPusher).toHaveBeenCalledOnce();
        expect(setPusher).toHaveBeenCalledWith(pusher);
    });

    it("sets nothing when Orbit has no pusher for it, and tries again next time", async () => {
        const { linkChatToDevice } = await import("../PushChatLink");
        getChatPusher.mockResolvedValueOnce(null).mockResolvedValueOnce(pusher);
        await linkChatToDevice("d2");
        expect(setPusher).not.toHaveBeenCalled();
        await linkChatToDevice("d2");
        expect(setPusher).toHaveBeenCalledOnce();
    });

    it("tries again next time when this room has no chat to set it on", async () => {
        const { linkChatToDevice } = await import("../PushChatLink");
        getChatPusher.mockResolvedValue(pusher);
        setPusher.mockResolvedValueOnce(false);
        await linkChatToDevice("d3");
        await linkChatToDevice("d3");
        expect(setPusher).toHaveBeenCalledTimes(2);
    });
});
