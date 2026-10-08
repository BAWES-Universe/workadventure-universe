import { afterEach, describe, expect, it, vi } from "vitest";
import { get, readable } from "svelte/store";

vi.mock("../../../i18n/i18n-svelte", () => {
    const text = {
        warning: {
            reconnectingTitle: () => "Reconnecting",
            reconnectingDetails: () => "Getting you back in",
        },
    };
    return { default: readable(text), LL: readable(text) };
});

import { errorScreenStore } from "../../Stores/ErrorScreenStore";
import {
    OFFLINE_NOTICE_AFTER_MS,
    RECONNECTING_CODE,
    keepLogoInMemory,
    logoFromMemory,
    reconnectingCopy,
    showReconnectingScreen,
    waitForNetwork,
    waitOrOnline,
} from "../ReconnectScreen";

/** A window whose network state and clock the test drives. */
function fakeWindow(onLine: boolean) {
    const listeners = new Set<() => void>();
    const timers = new Map<number, () => void>();
    let nextTimer = 1;
    return {
        navigator: { onLine },
        addEventListener: (_type: "online", listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: "online", listener: () => void) => listeners.delete(listener),
        setTimeout: (handler: () => void) => {
            timers.set(nextTimer, handler);
            return nextTimer++;
        },
        clearTimeout: (id: unknown) => timers.delete(id as number),
        goOnline() {
            [...listeners].forEach((listener) => listener());
        },
        runTimers() {
            [...timers.values()].forEach((handler) => handler());
        },
        listenerCount: () => listeners.size,
        timerCount: () => timers.size,
    };
}

const settled = async (promise: Promise<void>) => {
    let done = false;
    void promise.then(() => (done = true));
    await Promise.resolve();
    await Promise.resolve();
    return done;
};

describe("ReconnectScreen", () => {
    afterEach(() => errorScreenStore.delete());

    it("shows the calm reconnecting screen with the room's logo", () => {
        showReconnectingScreen("https://example.test/logo.png");

        const screen = get(errorScreenStore);
        expect(screen?.type).toBe("reconnecting");
        expect(screen?.code).toBe(RECONNECTING_CODE);
        expect(screen?.title).toBe("Reconnecting");
        expect(screen?.details).toBe("Getting you back in");
        expect(screen?.image).toBe("https://example.test/logo.png");
    });

    it("keeps a screen already up, such as a real error", () => {
        errorScreenStore.setError({
            type: "error",
            code: "BANNED",
            title: "Banned",
            subtitle: "",
            details: "",
            image: "",
            imageLogo: "",
            timeToRetry: undefined,
            buttonTitle: undefined,
            canRetryManual: undefined,
            urlToRedirect: undefined,
        });

        showReconnectingScreen(undefined);

        expect(get(errorScreenStore)?.code).toBe("BANNED");
    });

    it("tries at once when the network is there", async () => {
        const win = fakeWindow(true);
        expect(await settled(waitForNetwork(3000, win))).toBe(true);
        expect(win.timerCount()).toBe(0);
    });

    it("waits for the network when offline, and stops listening once it is back", async () => {
        const win = fakeWindow(false);
        const wait = waitForNetwork(3000, win);
        expect(await settled(wait)).toBe(false);

        win.goOnline();

        expect(await settled(wait)).toBe(true);
        expect(win.listenerCount()).toBe(0);
        expect(win.timerCount()).toBe(0);
    });

    it("never waits longer than its limit, even if the network never reports back", async () => {
        const win = fakeWindow(false);
        const wait = waitForNetwork(3000, win);

        win.runTimers();

        expect(await settled(wait)).toBe(true);
        expect(win.listenerCount()).toBe(0);
    });

    it("cuts a retry wait short when the browser comes back online", async () => {
        const win = fakeWindow(true);
        const wait = waitOrOnline(5000, win);
        expect(await settled(wait)).toBe(false);

        win.goOnline();

        expect(await settled(wait)).toBe(true);
    });

    it("says offline only after a while, and only without network", () => {
        expect(reconnectingCopy(0, false)).toBe("reconnecting");
        expect(reconnectingCopy(OFFLINE_NOTICE_AFTER_MS - 1, false)).toBe("reconnecting");
        expect(reconnectingCopy(OFFLINE_NOTICE_AFTER_MS, false)).toBe("offline");
        expect(reconnectingCopy(OFFLINE_NOTICE_AFTER_MS * 4, true)).toBe("reconnecting");
    });

    describe("the room's logo, kept in memory", () => {
        // Lets the download's promise chain finish.
        const flush = () =>
            new Promise<void>((resolve) => {
                setTimeout(resolve, 0);
            });

        afterEach(() => vi.unstubAllGlobals());

        it("is copied while the network is up, so the screen shows it without the network", async () => {
            const fetchLogo = vi.fn(() => Promise.resolve(new Response(new Blob(["png"]), { status: 200 })));
            vi.stubGlobal("fetch", fetchLogo);
            // The test page has no object URLs: a URL class that has them.
            vi.stubGlobal(
                "URL",
                class extends URL {
                    static createObjectURL = () => "blob:logo-copy";
                }
            );

            keepLogoInMemory("https://example.test/kept.png");
            keepLogoInMemory("https://example.test/kept.png");
            await flush();

            expect(fetchLogo).toHaveBeenCalledTimes(1);
            expect(logoFromMemory("https://example.test/kept.png")).toBe("blob:logo-copy");
            showReconnectingScreen("https://example.test/kept.png");
            expect(get(errorScreenStore)?.image).toBe("blob:logo-copy");
        });

        it("keeps the address, and the picture loaded, when no copy can be made", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn(() => Promise.reject(new TypeError("CORS")))
            );
            const loaded: string[] = [];
            vi.stubGlobal(
                "Image",
                class {
                    set src(value: string) {
                        loaded.push(value);
                    }
                    decode() {
                        return Promise.resolve();
                    }
                }
            );

            keepLogoInMemory("https://example.test/no-cors.png");
            await flush();

            expect(loaded).toEqual(["https://example.test/no-cors.png"]);
            expect(logoFromMemory("https://example.test/no-cors.png")).toBe("https://example.test/no-cors.png");
        });

        it("leaves a logo that needs no network, or no logo, as it is", () => {
            const fetchLogo = vi.fn();
            vi.stubGlobal("fetch", fetchLogo);

            keepLogoInMemory("data:image/png;base64,AAAA");
            keepLogoInMemory(undefined);

            expect(fetchLogo).not.toHaveBeenCalled();
            expect(logoFromMemory("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
            expect(logoFromMemory(undefined)).toBeUndefined();
        });
    });
});
