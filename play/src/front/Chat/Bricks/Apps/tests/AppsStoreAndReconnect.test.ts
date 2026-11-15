import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

const game = vi.hoisted(() => ({
    getMyApps: vi.fn<() => Promise<unknown>>(),
    startAppSignIn: vi.fn<(id: string, from: string, callback: string) => Promise<string>>(),
}));
vi.mock("../../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: { getMyApps: game.getMyApps, startAppSignIn: game.startAppSignIn },
}));
vi.mock("../../../../Stores/MenuStore", async () => {
    const store = await import("svelte/store");
    return { userIsConnected: store.writable(true) };
});

import { forgetMyApps, loadMyApps, myAppsStore } from "../AppsStore";
import { reconnectApp } from "../Reconnect";

const app = (id: string) => ({
    id,
    name: id,
    authType: "api-key",
    source: "link",
    connected: true,
    reconnectRequired: false,
    signInLostAt: null,
    connectedAt: "2026-11-04T09:00:00.000Z",
    lendable: true,
    bricks: [],
});

/** A read the test finishes by hand */
function pending() {
    let done: (answer: unknown) => void = () => undefined;
    const promise = new Promise<unknown>((resolve) => {
        done = resolve;
    });
    return { promise, done };
}

describe("the person's apps (#2001)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        forgetMyApps();
    });

    it("starts one refresh behind the read on its way for every change that comes meanwhile", async () => {
        const first = pending();
        const second = pending();
        game.getMyApps.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const reading = loadMyApps();
        const afterOne = loadMyApps(true);
        const afterTwo = loadMyApps(true);
        // Only the read on its way has started
        expect(game.getMyApps).toHaveBeenCalledTimes(1);
        first.done({ apps: [app("old")], bricks: [] });
        await reading;
        await Promise.resolve();
        await Promise.resolve();
        // One refresh for both changes, started after the first read ended
        expect(game.getMyApps).toHaveBeenCalledTimes(2);
        second.done({ apps: [app("new")], bricks: [] });
        await Promise.all([afterOne, afterTwo]);
        expect(game.getMyApps).toHaveBeenCalledTimes(2);
        expect(get(myAppsStore)?.map((one) => one.id)).toEqual(["new"]);
    });

    it("starts no refresh for a change that was waiting when the person signed out", async () => {
        const first = pending();
        game.getMyApps.mockReturnValueOnce(first.promise);
        const reading = loadMyApps();
        const afterChange = loadMyApps(true);
        forgetMyApps();
        first.done({ apps: [app("theirs")], bricks: [] });
        await reading;
        await afterChange;
        expect(game.getMyApps).toHaveBeenCalledTimes(1);
        expect(get(myAppsStore)).toBeUndefined();
    });

    it("does not bring back the apps of someone who signed out while a read was on its way", async () => {
        const slow = pending();
        game.getMyApps.mockReturnValueOnce(slow.promise);
        const reading = loadMyApps();
        forgetMyApps();
        slow.done({ apps: [app("theirs")], bricks: [] });
        await reading;
        expect(get(myAppsStore)).toBeUndefined();
    });
});

describe("Reconnect (#2001)", () => {
    const original = window.open;
    afterEach(() => {
        window.open = original;
    });

    it("stops, and never navigates, when the window was closed while the sign-in was starting", async () => {
        const popup = { closed: false, close: vi.fn(), location: { href: "" } };
        window.open = vi.fn(() => popup as unknown as Window);
        game.startAppSignIn.mockImplementation(() => {
            popup.closed = true;
            return Promise.resolve("https://sign.in/start");
        });
        expect(await reconnectApp("gmail")).toBe("stopped");
        expect(popup.location.href).toBe("");
    });

    it("says it was blocked when the window cannot be sent to the sign-in page", async () => {
        const popup = {
            closed: false,
            close: vi.fn(),
            location: {
                set href(_: string) {
                    throw new Error("gone");
                },
            },
        };
        window.open = vi.fn(() => popup as unknown as Window);
        game.startAppSignIn.mockResolvedValue("https://sign.in/start");
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(await reconnectApp("gmail")).toBe("blocked");
    });
});
