import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

const game = vi.hoisted(() => ({
    connectListedApp: vi.fn<(key: string) => Promise<string>>(),
    connectReadyMadeApp: vi.fn<(key: string, returnUrl: string) => Promise<unknown>>(),
    getMyApps: vi.fn<() => Promise<unknown>>(),
    signInInPopup: vi.fn<(id: string | Promise<string>) => Promise<"done" | "stopped" | "blocked">>(),
}));
vi.mock("../../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: {
        connectListedApp: game.connectListedApp,
        connectReadyMadeApp: game.connectReadyMadeApp,
        getMyApps: game.getMyApps,
    },
}));
vi.mock("../../../../Stores/MenuStore", async () => {
    const store = await import("svelte/store");
    return { userIsConnected: store.writable(true) };
});
vi.mock("../Reconnect", () => ({ signInInPopup: game.signInInPopup }));

import { connectApp } from "../ConnectApp";
import { forgetMyApps } from "../AppsStore";
import type { Connectable } from "../Connectable";

const listed: Connectable = {
    kind: "listed",
    key: "notion",
    name: "Notion",
    blurb: "Notes and docs",
    connectionId: null,
};
const ready: Connectable = { kind: "readyMade", key: "linear", name: "Linear", blurb: "", connectionId: null };

const row = (over: Record<string, unknown> = {}) => ({
    id: "c9",
    name: "Linear",
    authType: "none",
    source: "ready_made",
    connected: true,
    reconnectRequired: false,
    signInLostAt: null,
    connectedAt: "2026-11-13T09:00:00.000Z",
    lendable: false,
    bricks: [],
    ...over,
});

describe("Connect on an app (#2001)", () => {
    let popup: { location: { href: string }; close: ReturnType<typeof vi.fn>; closed: boolean };
    let open: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        forgetMyApps();
        popup = { location: { href: "" }, close: vi.fn(), closed: false };
        open = vi.fn(() => popup);
        vi.stubGlobal("open", open);
        game.getMyApps.mockResolvedValue({ apps: [row()], bricks: [] });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const tell = (type: string) =>
        window.dispatchEvent(new MessageEvent("message", { data: { type }, origin: window.location.origin }));

    it("opens the sign-in window from a listed app and answers its connection once it signed in", async () => {
        game.connectListedApp.mockResolvedValue("c1");
        game.signInInPopup.mockResolvedValue("done");
        expect(await connectApp(listed)).toEqual({ status: "connected", appId: "c1" });
        expect(game.connectListedApp).toHaveBeenCalledWith("notion");
        // The connection is handed over as a promise, so the window can open before it is made
        expect(game.signInInPopup.mock.calls[0][0]).toBeInstanceOf(Promise);
    });

    it("says stopped when the window was closed or the sign-in failed, and blocked when it could not open", async () => {
        game.connectListedApp.mockResolvedValue("c1");
        game.signInInPopup.mockResolvedValueOnce("stopped").mockResolvedValueOnce("blocked");
        expect(await connectApp(listed)).toEqual({ status: "stopped" });
        expect(await connectApp(listed)).toEqual({ status: "blocked" });
    });

    it("opens a window first for a ready-made app, sends it to the app's page, and waits for the return", async () => {
        game.connectReadyMadeApp.mockResolvedValue({ id: "c9", redirectUrl: "https://provider.test/sign-in" });
        const result = connectApp(ready);
        expect(open).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(popup.location.href).toBe("https://provider.test/sign-in"));
        expect(game.connectReadyMadeApp).toHaveBeenCalledWith(
            "linear",
            `${window.location.origin}/oauth-popup-callback.html?oauth=success`
        );
        tell("oauth-success");
        expect(await result).toEqual({ status: "connected", appId: "c9" });
    });

    it("does not call a ready-made app connected when its provider has not confirmed the sign-in", async () => {
        game.connectReadyMadeApp.mockResolvedValue({ id: "c9", redirectUrl: "https://provider.test/sign-in" });
        game.getMyApps.mockResolvedValue({ apps: [row({ connected: false })], bricks: [] });
        const result = connectApp(ready);
        await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
        tell("oauth-success");
        expect(await result).toEqual({ status: "stopped" });
    });

    it("asks Orbit once more when the first check after the sign-in fails, and connects when it confirms", async () => {
        game.connectReadyMadeApp.mockResolvedValue({ id: "c9", redirectUrl: "https://provider.test/sign-in" });
        game.getMyApps.mockRejectedValueOnce(new Error("network")).mockResolvedValue({ apps: [row()], bricks: [] });
        const result = connectApp(ready);
        await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
        tell("oauth-success");
        expect(await result).toEqual({ status: "connected", appId: "c9" });
    });

    it("says unchecked, not stopped, when Orbit cannot be asked after a finished sign-in", async () => {
        game.connectReadyMadeApp.mockResolvedValue({ id: "c9", redirectUrl: "https://provider.test/sign-in" });
        game.getMyApps.mockRejectedValue(new Error("network"));
        const result = connectApp(ready);
        await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
        tell("oauth-success");
        expect(await result).toEqual({ status: "unchecked" });
        expect(game.getMyApps).toHaveBeenCalledTimes(2);
    });

    it("says stopped when the window was closed while the sign-in was still being started", async () => {
        game.connectReadyMadeApp.mockImplementation(() => {
            popup.closed = true;
            return Promise.resolve({ id: "c9", redirectUrl: "https://provider.test/sign-in" });
        });
        expect(await connectApp(ready)).toEqual({ status: "stopped" });
    });

    it("says stopped when the window is closed by hand while it waits, without this window getting focus", async () => {
        game.connectReadyMadeApp.mockResolvedValue({ id: "c9", redirectUrl: "https://provider.test/sign-in" });
        const result = connectApp(ready);
        await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
        popup.closed = true;
        expect(await result).toEqual({ status: "stopped" });
    });

    it("says stopped when a ready-made sign-in fails", async () => {
        game.connectReadyMadeApp.mockResolvedValue({ id: "c9", redirectUrl: "https://provider.test/sign-in" });
        const result = connectApp(ready);
        await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
        tell("oauth-failure");
        expect(await result).toEqual({ status: "stopped" });
    });

    it("closes the window and connects at once for a ready-made app the person is already signed in to", async () => {
        game.connectReadyMadeApp.mockResolvedValue({ id: "c9" });
        expect(await connectApp(ready)).toEqual({ status: "connected", appId: "c9" });
        expect(popup.close).toHaveBeenCalled();
    });

    it("closes the window and says blocked when the ready-made connection cannot be made", async () => {
        game.connectReadyMadeApp.mockRejectedValue(new Error("API error: 404"));
        expect(await connectApp(ready)).toEqual({ status: "blocked" });
        expect(popup.close).toHaveBeenCalled();
    });

    it("says blocked when the browser does not let a window open", async () => {
        open.mockReturnValue(null);
        expect(await connectApp(ready)).toEqual({ status: "blocked" });
        expect(game.connectReadyMadeApp).not.toHaveBeenCalled();
    });
});
