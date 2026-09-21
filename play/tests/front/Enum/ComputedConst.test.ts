// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_MODULE = "../../../src/front/Enum/EnvironmentVariable";
const COMPUTED_CONST = "../../../src/front/Enum/ComputedConst";

/**
 * ComputedConst reads its env at import time, so each case needs a fresh module graph with a
 * controlled EnvironmentVariable module. Imports are sequential (concurrent dynamic imports of the
 * same mocked module race in vitest).
 */
async function loadComputedConst(pusherUrl: string, wsUrl: string | undefined) {
    vi.resetModules();
    vi.doMock(ENV_MODULE, () => ({ PUSHER_URL: pusherUrl, WS_URL: wsUrl }));
    return import(COMPUTED_CONST);
}

describe("ABSOLUTE_WS_URL", () => {
    afterEach(() => {
        vi.doUnmock(ENV_MODULE);
        vi.resetModules();
    });

    it("falls back to the pusher URL when WS_URL is not defined", async () => {
        const { ABSOLUTE_PUSHER_URL, ABSOLUTE_WS_URL } = await loadComputedConst("https://app.example.com/", undefined);

        expect(ABSOLUTE_PUSHER_URL).toBe("https://app.example.com/");
        expect(ABSOLUTE_WS_URL).toBe(ABSOLUTE_PUSHER_URL);
    });

    it("falls back to the pusher URL when WS_URL is an empty string", async () => {
        const { ABSOLUTE_WS_URL } = await loadComputedConst("https://app.example.com/", "");

        expect(ABSOLUTE_WS_URL).toBe("https://app.example.com/");
    });

    it("resolves a relative pusher URL against the front location", async () => {
        const { ABSOLUTE_WS_URL } = await loadComputedConst("/pusher/", undefined);

        expect(ABSOLUTE_WS_URL).toBe(new URL("/pusher/", window.location.toString()).toString());
    });

    it("uses WS_URL when set, leaving the pusher URL untouched", async () => {
        const { ABSOLUTE_PUSHER_URL, ABSOLUTE_WS_URL } = await loadComputedConst(
            "https://app.example.com/",
            "https://ws.example.com/"
        );

        expect(ABSOLUTE_PUSHER_URL).toBe("https://app.example.com/");
        expect(ABSOLUTE_WS_URL).toBe("https://ws.example.com/");
    });

    it("resolves a relative WS_URL against the front location", async () => {
        const { ABSOLUTE_WS_URL } = await loadComputedConst("https://app.example.com/", "/socket/");

        expect(ABSOLUTE_WS_URL).toBe(new URL("/socket/", window.location.toString()).toString());
    });

    it("puts the game socket on the configured host", async () => {
        const { ABSOLUTE_WS_URL } = await loadComputedConst("https://app.example.com/", "https://ws.example.com/");

        const socketUrl = new URL("ws/room", ABSOLUTE_WS_URL);
        socketUrl.protocol = socketUrl.protocol.replace("http", "ws");

        expect(socketUrl.toString()).toBe("wss://ws.example.com/ws/room");
    });

    it("keeps the game socket on the pusher host when WS_URL is not set", async () => {
        const { ABSOLUTE_WS_URL } = await loadComputedConst("https://app.example.com/", undefined);

        const socketUrl = new URL("ws/room", ABSOLUTE_WS_URL);
        socketUrl.protocol = socketUrl.protocol.replace("http", "ws");

        expect(socketUrl.toString()).toBe("wss://app.example.com/ws/room");
    });
});
