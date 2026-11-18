import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ startOAuth: vi.fn() }));
vi.mock("./BotApiService", () => ({ botApiService: api }));

import { reconnectBotServer } from "./reconnectServer";

describe("reconnectBotServer (#1819)", () => {
    let windows: Array<{ location: { href: string }; close: ReturnType<typeof vi.fn>; closed: boolean }>;
    let open: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        windows = [];
        open = vi.fn(() => {
            const popup = { location: { href: "" }, close: vi.fn(), closed: false };
            windows.push(popup);
            return popup;
        });
        vi.stubGlobal("open", open);
        api.startOAuth.mockImplementation((_bot: string, serverId: string) => Promise.resolve(`https://provider.test/${serverId}`));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // jsdom takes only a real window as a message's source, so it is set on the event after it is made
    const tell = (type: string, from: unknown) => {
        const event = new MessageEvent("message", { data: { type }, origin: window.location.origin });
        Object.defineProperty(event, "source", { value: from });
        window.dispatchEvent(event);
    };

    it("is blocked when the browser opens no window", async () => {
        open.mockReturnValueOnce(null);
        expect(await reconnectBotServer("b1", "s1")).toBe("blocked");
    });

    it("gives each attempt a window of its own, so two started together never share one", async () => {
        const first = reconnectBotServer("b1", "s1");
        const second = reconnectBotServer("b1", "s2");
        expect(new Set(open.mock.calls.map((call) => call[1])).size).toBe(2);
        await vi.waitFor(() => expect(windows.every((popup) => popup.location.href !== "")).toBe(true));
        expect(windows.map((popup) => popup.location.href)).toEqual(["https://provider.test/s1", "https://provider.test/s2"]);
        tell("oauth-success", windows[0]);
        tell("oauth-failure", windows[1]);
        expect(await first).toBe("done");
        expect(await second).toBe("cancelled");
    });

    it("takes a result only from the window of its own attempt", async () => {
        const first = reconnectBotServer("b1", "s1");
        const second = reconnectBotServer("b1", "s2");
        await vi.waitFor(() => expect(windows.every((popup) => popup.location.href !== "")).toBe(true));
        let firstSettled = false;
        void first.then(() => (firstSettled = true));
        // The second window finishes: it settles only the second attempt
        tell("oauth-success", windows[1]);
        expect(await second).toBe("done");
        await new Promise((resolve) => {
            setTimeout(resolve, 20);
        });
        expect(firstSettled).toBe(false);
        tell("oauth-success", windows[0]);
        expect(await first).toBe("done");
    });

    it("is blocked, and closes its window, when the sign-in cannot be started", async () => {
        api.startOAuth.mockRejectedValueOnce(new Error("no"));
        expect(await reconnectBotServer("b1", "s1")).toBe("blocked");
        expect(windows[0].close).toHaveBeenCalled();
    });
});
