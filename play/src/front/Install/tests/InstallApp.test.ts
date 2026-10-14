import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";
import type { BeforeInstallPromptEvent, InstallAnalytics, InstallCardRecord, InstallStorage } from "../InstallApp";
import {
    APP_INSTALLED_VARIABLE,
    CARD_GAP_MS,
    FIRST_MOMENT_MS,
    INSTALLED_TOAST_MS,
    InstallApp,
    LONG_CARD_GAP_MS,
} from "../InstallApp";
import type { InstallEnvironment } from "../InstallPlatform";

const IPHONE_SAFARI =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const CHROME =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0";

function env(userAgent: string, overrides: Partial<InstallEnvironment> = {}): InstallEnvironment {
    return {
        userAgent,
        platform: "",
        maxTouchPoints: 0,
        displayModeInstalled: false,
        navigatorStandalone: false,
        ...overrides,
    };
}

function memoryStorage(
    record: InstallCardRecord | undefined = undefined,
    reported = false
): InstallStorage & { record: InstallCardRecord | undefined; reported: boolean } {
    const storage = {
        record,
        reported,
        readCardRecord: () => storage.record,
        writeCardRecord: (next: InstallCardRecord) => {
            storage.record = next;
        },
        clearCardRecord: () => {
            storage.record = undefined;
        },
        isInstallReported: () => storage.reported,
        markInstallReported: () => {
            storage.reported = true;
        },
        clearInstallReported: () => {
            storage.reported = false;
        },
    };
    return storage;
}

function fakeAnalytics() {
    return { cardShown: vi.fn(), cardDismissed: vi.fn(), installed: vi.fn() } satisfies InstallAnalytics;
}

/** A browser window that lets the test fire the browser's events. */
function fakeWindow() {
    const handlers = new Map<string, ((event: Event) => void)[]>();
    return {
        addEventListener: (type: string, handler: (event: Event) => void) => {
            handlers.set(type, [...(handlers.get(type) ?? []), handler]);
        },
        removeEventListener: (type: string, handler: (event: Event) => void) => {
            handlers.set(
                type,
                (handlers.get(type) ?? []).filter((candidate) => candidate !== handler)
            );
        },
        fire(type: string, event: Event = new Event(type)) {
            for (const handler of handlers.get(type) ?? []) handler(event);
        },
    };
}

function installEvent(outcome: "accepted" | "dismissed") {
    const prompt = vi.fn(() => Promise.resolve());
    const event = new Event("beforeinstallprompt", { cancelable: true }) as BeforeInstallPromptEvent;
    event.prompt = prompt;
    event.userChoice = Promise.resolve({ outcome });
    return { event, prompt };
}

describe("InstallApp", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    function setup(
        options: {
            env?: InstallEnvironment;
            storage?: ReturnType<typeof memoryStorage>;
            installedApps?: () => Promise<readonly unknown[]>;
        } = {}
    ) {
        const quiet = writable(true);
        const storage = options.storage ?? memoryStorage();
        const analytics = fakeAnalytics();
        const win = fakeWindow();
        const app = new InstallApp({ env: options.env ?? env(IPHONE_SAFARI), quiet, storage, analytics });
        app.start(win, options.installedApps);
        return { app, quiet, storage, analytics, win };
    }

    describe("where it is possible", () => {
        it("is possible on iPhone Safari at once, by the guide", () => {
            const { app } = setup();
            expect(get(app.canInstallStore)).toBe(true);
            expect(app.guide).toBe("iphone-safari");
        });

        it("is possible on Chrome only once the browser sends its install event", () => {
            const { app, win } = setup({ env: env(CHROME) });
            expect(get(app.canInstallStore)).toBe(false);
            win.fire("beforeinstallprompt", installEvent("accepted").event);
            expect(get(app.canInstallStore)).toBe(true);
        });

        it("is not possible on Firefox for a computer", () => {
            const { app } = setup({ env: env(FIREFOX) });
            expect(get(app.canInstallStore)).toBe(false);
        });

        it("is not possible, and never shows, inside the native Universe app", () => {
            const webView =
                "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
            const { app, storage } = setup({ env: env(webView, { nativeShell: true }) });
            expect(get(app.canInstallStore)).toBe(false);
            app.noteConversationEnded();
            expect(get(app.cardVisibleStore)).toBe(false);
            expect(storage.record).toBeUndefined();
        });

        it("is not possible, and never shows, inside the installed app", () => {
            const { app, storage } = setup({ env: env(IPHONE_SAFARI, { navigatorStandalone: true }) });
            expect(get(app.canInstallStore)).toBe(false);
            app.noteConversationEnded();
            expect(get(app.cardVisibleStore)).toBe(false);
            expect(storage.record).toBeUndefined();
        });

        it("keeps the browser's own mini bar away, so the card picks the moment", () => {
            const { win } = setup({ env: env(CHROME) });
            const { event } = installEvent("accepted");
            win.fire("beforeinstallprompt", event);
            expect(event.defaultPrevented).toBe(true);
        });
    });

    describe("the card", () => {
        it("does not show on arrival", () => {
            const { app } = setup();
            app.noteInRoom();
            expect(get(app.cardVisibleStore)).toBe(false);
        });

        it("shows after the first conversation ends", () => {
            const { app, analytics } = setup();
            app.noteInRoom();
            app.noteConversationEnded();
            expect(get(app.cardVisibleStore)).toBe(true);
            expect(analytics.cardShown).toHaveBeenCalledTimes(1);
        });

        it("shows five seconds after being in a room when there was no conversation", () => {
            const { app } = setup();
            app.noteInRoom();
            vi.advanceTimersByTime(FIRST_MOMENT_MS - 1);
            expect(get(app.cardVisibleStore)).toBe(false);
            vi.advanceTimersByTime(1);
            expect(get(app.cardVisibleStore)).toBe(true);
        });

        it("waits out a call, the chat or a menu, and comes back when they end", () => {
            const { app, quiet, analytics } = setup();
            quiet.set(false);
            app.noteConversationEnded();
            expect(get(app.cardVisibleStore)).toBe(false);
            expect(analytics.cardShown).not.toHaveBeenCalled();
            quiet.set(true);
            expect(get(app.cardVisibleStore)).toBe(true);
            quiet.set(false);
            expect(get(app.cardVisibleStore)).toBe(false);
            quiet.set(true);
            expect(get(app.cardVisibleStore)).toBe(true);
            // Counted once, however often it came and went.
            expect(analytics.cardShown).toHaveBeenCalledTimes(1);
        });

        it("is remembered the moment it shows, with no closes yet", () => {
            const { app, storage } = setup();
            app.noteConversationEnded();
            expect(storage.record).toEqual({ lastShownAt: Date.now(), closeStreak: 0, lastClosed: false });
        });

        it("does not come back within a day after it was ignored, and comes back after a day", () => {
            const first = setup();
            first.app.noteConversationEnded();
            expect(get(first.app.cardVisibleStore)).toBe(true);

            vi.advanceTimersByTime(CARD_GAP_MS - 1);
            const early = setup({ storage: first.storage });
            early.app.noteInRoom();
            early.app.noteConversationEnded();
            expect(get(early.app.cardVisibleStore)).toBe(false);
            expect(early.analytics.cardShown).not.toHaveBeenCalled();

            vi.advanceTimersByTime(1);
            const later = setup({ storage: first.storage });
            later.app.noteInRoom();
            vi.advanceTimersByTime(FIRST_MOMENT_MS);
            expect(get(later.app.cardVisibleStore)).toBe(true);
            expect(later.analytics.cardShown).toHaveBeenCalledTimes(1);
        });

        it("goes with the ✕ and is counted as dismissed and as a close", () => {
            const { app, analytics, storage } = setup();
            app.noteConversationEnded();
            app.dismissCard();
            expect(get(app.cardVisibleStore)).toBe(false);
            expect(analytics.cardDismissed).toHaveBeenCalledTimes(1);
            expect(storage.record).toEqual({ lastShownAt: Date.now(), closeStreak: 1, lastClosed: true });
        });

        it("does not come back on this load after the ✕", () => {
            const { app, quiet } = setup();
            app.noteConversationEnded();
            app.dismissCard();
            quiet.set(false);
            quiet.set(true);
            app.noteConversationEnded();
            expect(get(app.cardVisibleStore)).toBe(false);
        });

        /** Shows the card on a new visit, a gap after the last one, and closes it with the ✕. */
        function closeOnNewVisit(storage: ReturnType<typeof memoryStorage>, gap: number) {
            vi.advanceTimersByTime(gap);
            const visit = setup({ storage });
            visit.app.noteConversationEnded();
            expect(get(visit.app.cardVisibleStore)).toBe(true);
            visit.app.dismissCard();
        }

        it("waits a week after three closes in a row", () => {
            const storage = memoryStorage();
            const first = setup({ storage });
            first.app.noteConversationEnded();
            first.app.dismissCard();
            closeOnNewVisit(storage, CARD_GAP_MS);
            closeOnNewVisit(storage, CARD_GAP_MS);
            expect(storage.record?.closeStreak).toBe(3);

            vi.advanceTimersByTime(LONG_CARD_GAP_MS - 1);
            const early = setup({ storage });
            early.app.noteConversationEnded();
            expect(get(early.app.cardVisibleStore)).toBe(false);

            vi.advanceTimersByTime(1);
            const later = setup({ storage });
            later.app.noteConversationEnded();
            expect(get(later.app.cardVisibleStore)).toBe(true);
        });

        it("waits only a day after two closes in a row", () => {
            const storage = memoryStorage();
            const first = setup({ storage });
            first.app.noteConversationEnded();
            first.app.dismissCard();
            closeOnNewVisit(storage, CARD_GAP_MS);
            expect(storage.record?.closeStreak).toBe(2);
            vi.advanceTimersByTime(CARD_GAP_MS);
            const later = setup({ storage });
            later.app.noteConversationEnded();
            expect(get(later.app.cardVisibleStore)).toBe(true);
        });

        it("starts the row of closes again after a showing that was ignored", () => {
            const storage = memoryStorage();
            const first = setup({ storage });
            first.app.noteConversationEnded();
            first.app.dismissCard();
            closeOnNewVisit(storage, CARD_GAP_MS);
            expect(storage.record?.closeStreak).toBe(2);

            // Shown, then ignored: the streak is cleared at the next showing, not before.
            vi.advanceTimersByTime(CARD_GAP_MS);
            const ignored = setup({ storage });
            ignored.app.noteConversationEnded();
            expect(get(ignored.app.cardVisibleStore)).toBe(true);
            expect(storage.record).toEqual({ lastShownAt: Date.now(), closeStreak: 2, lastClosed: false });

            closeOnNewVisit(storage, CARD_GAP_MS);
            expect(storage.record).toEqual({ lastShownAt: Date.now(), closeStreak: 1, lastClosed: true });
            // One close in the new row: a day is enough again.
            vi.advanceTimersByTime(CARD_GAP_MS);
            const later = setup({ storage });
            later.app.noteConversationEnded();
            expect(get(later.app.cardVisibleStore)).toBe(true);
        });

        it("does not show when the record says it showed a moment ago, even after a conversation", () => {
            const storage = memoryStorage({ lastShownAt: Date.now(), closeStreak: 0, lastClosed: false });
            const { app, analytics } = setup({ storage });
            app.noteInRoom();
            vi.advanceTimersByTime(FIRST_MOMENT_MS);
            app.noteConversationEnded();
            expect(get(app.cardVisibleStore)).toBe(false);
            expect(analytics.cardShown).not.toHaveBeenCalled();
        });

        it("waits for the browser's install event on Chrome before it shows", () => {
            const { app, win } = setup({ env: env(CHROME) });
            app.noteConversationEnded();
            expect(get(app.cardVisibleStore)).toBe(false);
            win.fire("beforeinstallprompt", installEvent("accepted").event);
            expect(get(app.cardVisibleStore)).toBe(true);
        });
    });

    describe("installing", () => {
        it("opens the iPhone guide from the menu", async () => {
            const { app } = setup();
            await app.install("menu");
            expect(get(app.guideOpenStore)).toBe("iphone-safari");
            app.closeGuide();
            expect(get(app.guideOpenStore)).toBeUndefined();
        });

        it("closes the card when Install is tapped on it, and opens the guide", async () => {
            const { app } = setup();
            app.noteConversationEnded();
            await app.install("card");
            expect(get(app.cardVisibleStore)).toBe(false);
            expect(get(app.guideOpenStore)).toBe("iphone-safari");
        });

        it("opens the browser's own window on Chrome, and says so when the app was added", async () => {
            const { app, win, analytics, storage } = setup({ env: env(CHROME) });
            const { event, prompt } = installEvent("accepted");
            win.fire("beforeinstallprompt", event);
            await app.install("menu");
            expect(prompt).toHaveBeenCalledTimes(1);
            expect(get(app.installedToastStore)).toBe(true);
            expect(get(app.canInstallStore)).toBe(false);
            expect(analytics.installed).toHaveBeenCalledWith("menu");
            expect(storage.reported).toBe(true);
            vi.advanceTimersByTime(INSTALLED_TOAST_MS);
            expect(get(app.installedToastStore)).toBe(false);
        });

        it("counts an install once when the browser then says the app was installed", async () => {
            const { app, win, analytics } = setup({ env: env(CHROME) });
            win.fire("beforeinstallprompt", installEvent("accepted").event);
            await app.install("card");
            win.fire("appinstalled");
            expect(analytics.installed).toHaveBeenCalledTimes(1);
        });

        it("says nothing when the player cancels the browser's window", async () => {
            const { app, win, analytics } = setup({ env: env(CHROME) });
            win.fire("beforeinstallprompt", installEvent("dismissed").event);
            await app.install("menu");
            expect(get(app.installedToastStore)).toBe(false);
            expect(analytics.installed).not.toHaveBeenCalled();
        });

        it("keeps the row after a cancel and points at the browser's own menu, since its window cannot open twice", async () => {
            const { app, win } = setup({ env: env(CHROME) });
            const { event, prompt } = installEvent("dismissed");
            win.fire("beforeinstallprompt", event);
            await app.install("menu");
            expect(get(app.canInstallStore)).toBe(true);
            await app.install("menu");
            expect(prompt).toHaveBeenCalledTimes(1);
            expect(get(app.guideOpenStore)).toBe("browser-chrome-android");
            app.closeGuide();
            expect(get(app.guideOpenStore)).toBeUndefined();
        });

        it("points a computer at the browser's menu too", async () => {
            const { app, win } = setup({ env: env(DESKTOP_CHROME) });
            win.fire("beforeinstallprompt", installEvent("dismissed").event);
            await app.install("menu");
            await app.install("menu");
            expect(get(app.guideOpenStore)).toBe("browser-chrome-desktop");
        });

        it("keeps the row when the browser's window fails to open", async () => {
            const { app, win } = setup({ env: env(CHROME) });
            const { event } = installEvent("accepted");
            event.prompt = vi.fn(() => Promise.reject(new Error("used already")));
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            win.fire("beforeinstallprompt", event);
            await app.install("menu");
            expect(get(app.canInstallStore)).toBe(true);
        });

        it("counts a cancel from the menu as a close that also sets the time the card showed, so it waits its gap", async () => {
            const { app, win, storage } = setup({ env: env(CHROME) });
            win.fire("beforeinstallprompt", installEvent("dismissed").event);
            await app.install("menu");
            expect(storage.record).toEqual({ lastShownAt: Date.now(), closeStreak: 1, lastClosed: true });
            app.noteConversationEnded();
            expect(get(app.cardVisibleStore)).toBe(false);

            vi.advanceTimersByTime(CARD_GAP_MS);
            const later = setup({ env: env(CHROME), storage });
            later.win.fire("beforeinstallprompt", installEvent("accepted").event);
            later.app.noteConversationEnded();
            expect(get(later.app.cardVisibleStore)).toBe(true);
        });

        it("counts a cancel from the card as one close of that showing", async () => {
            const { app, win, storage } = setup({ env: env(CHROME) });
            win.fire("beforeinstallprompt", installEvent("dismissed").event);
            app.noteConversationEnded();
            const shownAt = Date.now();
            vi.advanceTimersByTime(1000);
            await app.install("card");
            expect(storage.record).toEqual({ lastShownAt: shownAt, closeStreak: 1, lastClosed: true });
        });

        it("counts a window that fails to open as a close", async () => {
            const { app, win, storage } = setup({ env: env(CHROME) });
            const { event } = installEvent("accepted");
            event.prompt = vi.fn(() => Promise.reject(new Error("used already")));
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            win.fire("beforeinstallprompt", event);
            await app.install("menu");
            expect(storage.record?.closeStreak).toBe(1);
            expect(storage.record?.lastClosed).toBe(true);
        });

        it("counts nothing when the player installs", async () => {
            const { app, win, storage } = setup({ env: env(CHROME) });
            win.fire("beforeinstallprompt", installEvent("accepted").event);
            await app.install("menu");
            expect(storage.record).toBeUndefined();
        });

        it("does not bring the card back after a cancel from the menu when the card was waiting", async () => {
            const { app, win, quiet } = setup({ env: env(CHROME) });
            win.fire("beforeinstallprompt", installEvent("dismissed").event);
            app.noteConversationEnded();
            expect(get(app.cardVisibleStore)).toBe(true);
            // the player opens the menu instead of using the card
            quiet.set(false);
            await app.install("menu");
            quiet.set(true);
            expect(get(app.cardVisibleStore)).toBe(false);
        });

        it("uses the browser's window again when it offers a new one after a cancel", async () => {
            const { app, win } = setup({ env: env(CHROME) });
            win.fire("beforeinstallprompt", installEvent("dismissed").event);
            await app.install("menu");
            const second = installEvent("accepted");
            win.fire("beforeinstallprompt", second.event);
            await app.install("menu");
            expect(second.prompt).toHaveBeenCalledTimes(1);
            expect(get(app.guideOpenStore)).toBeUndefined();
            expect(get(app.installedToastStore)).toBe(true);
        });

        it("counts an app installed from the browser's own menu", () => {
            const { app, win, analytics } = setup({ env: env(CHROME) });
            win.fire("appinstalled");
            expect(analytics.installed).toHaveBeenCalledWith("browser");
            expect(get(app.canInstallStore)).toBe(false);
        });
    });

    describe("an app installed earlier in this browser", () => {
        it("brings the row back when the browser offers the install again (the app was removed)", () => {
            const { app, win } = setup({ env: env(CHROME), storage: memoryStorage(undefined, true) });
            win.fire("beforeinstallprompt", installEvent("accepted").event);
            // the browser offers the install again: the app was removed, so the row is back
            expect(get(app.canInstallStore)).toBe(true);
        });

        it("keeps the row hidden when the browser sends no install offer", () => {
            const { app } = setup({ env: env(CHROME), storage: memoryStorage(undefined, true) });
            expect(get(app.canInstallStore)).toBe(false);
        });

        it("forgets the old install when the browser offers it again, so a new one counts", () => {
            const storage = memoryStorage(undefined, true);
            const { win } = setup({ env: env(CHROME), storage });
            win.fire("beforeinstallprompt", installEvent("accepted").event);
            expect(storage.reported).toBe(false);
        });

        it("steps aside when the browser says the app is installed, with no toast and no count", async () => {
            const { app, analytics } = setup({ env: env(CHROME), installedApps: () => Promise.resolve([{}]) });
            await vi.advanceTimersByTimeAsync(0);
            expect(get(app.canInstallStore)).toBe(false);
            expect(get(app.installedToastStore)).toBe(false);
            expect(analytics.installed).not.toHaveBeenCalled();
        });

        it("stays when the browser lists no installed app, or cannot say", async () => {
            const none = setup({ env: env(CHROME), installedApps: () => Promise.resolve([]) });
            none.win.fire("beforeinstallprompt", installEvent("accepted").event);
            await vi.advanceTimersByTimeAsync(0);
            expect(get(none.app.canInstallStore)).toBe(true);
            const broken = setup({ env: env(CHROME), installedApps: () => Promise.reject(new Error("no")) });
            broken.win.fire("beforeinstallprompt", installEvent("accepted").event);
            await vi.advanceTimersByTimeAsync(0);
            expect(get(broken.app.canInstallStore)).toBe(true);
        });

        it("ignores a lookup that comes after the browser's own install offer", async () => {
            let answer: (apps: readonly unknown[]) => void = () => undefined;
            const { app, win } = setup({
                env: env(CHROME),
                installedApps: () =>
                    new Promise((resolve) => {
                        answer = resolve;
                    }),
            });
            win.fire("beforeinstallprompt", installEvent("accepted").event);
            answer([{}]);
            await vi.advanceTimersByTimeAsync(0);
            expect(get(app.canInstallStore)).toBe(true);
        });

        it("keeps the row on iPhone Safari, which cannot tell", () => {
            const { app } = setup({ storage: memoryStorage(undefined, true) });
            expect(get(app.canInstallStore)).toBe(true);
        });
    });

    describe("an app already installed", () => {
        it("counts a first launch, once, on the device that holds its own storage", () => {
            const storage = memoryStorage();
            const first = setup({ env: env(IPHONE_SAFARI, { navigatorStandalone: true }), storage });
            expect(first.analytics.installed).toHaveBeenCalledWith("app");
            const second = setup({ env: env(IPHONE_SAFARI, { navigatorStandalone: true }), storage });
            expect(second.analytics.installed).not.toHaveBeenCalled();
        });
    });

    describe("an app installed", () => {
        it("never shows the card again after the player installed it, whatever the record says", async () => {
            const storage = memoryStorage();
            const first = setup({ env: env(CHROME), storage });
            first.win.fire("beforeinstallprompt", installEvent("accepted").event);
            await first.app.install("menu");
            vi.advanceTimersByTime(LONG_CARD_GAP_MS);
            const later = setup({ env: env(CHROME), storage });
            later.app.noteInRoom();
            vi.advanceTimersByTime(FIRST_MOMENT_MS);
            later.app.noteConversationEnded();
            expect(get(later.app.canInstallStore)).toBe(false);
            expect(get(later.app.cardVisibleStore)).toBe(false);
            expect(later.analytics.cardShown).not.toHaveBeenCalled();
        });

        it("never shows the card inside the app, however long ago it showed", () => {
            const storage = memoryStorage({
                lastShownAt: Date.now() - LONG_CARD_GAP_MS,
                closeStreak: 0,
                lastClosed: false,
            });
            const { app } = setup({ env: env(IPHONE_SAFARI, { navigatorStandalone: true }), storage });
            app.noteInRoom();
            vi.advanceTimersByTime(FIRST_MOMENT_MS);
            app.noteConversationEnded();
            expect(get(app.cardVisibleStore)).toBe(false);
        });
    });

    describe("the app on the account", () => {
        const onAccount = new Map<string, unknown>([[APP_INSTALLED_VARIABLE, true]]);
        const account = { isLogged: () => true, setVariable: vi.fn() };

        it("keeps the card away on Apple's browsers, and the menu row stays", () => {
            const { app, analytics } = setup();
            app.noteRoomJoined(onAccount, account);
            app.noteConversationEnded();
            expect(get(app.cardVisibleStore)).toBe(false);
            expect(analytics.cardShown).not.toHaveBeenCalled();
            expect(get(app.canInstallStore)).toBe(true);
        });

        it("hides a card that is already on screen", () => {
            const { app } = setup();
            app.noteConversationEnded();
            expect(get(app.cardVisibleStore)).toBe(true);
            app.noteAppOnAccount();
            expect(get(app.cardVisibleStore)).toBe(false);
        });

        it("shows the card on Apple's browsers when the account has no mark", () => {
            const { app } = setup();
            app.noteRoomJoined(new Map([[APP_INSTALLED_VARIABLE, false]]), account);
            app.noteConversationEnded();
            expect(get(app.cardVisibleStore)).toBe(true);
        });

        it("is ignored on Chromium, which sees its own install", () => {
            const { app, win } = setup({ env: env(CHROME) });
            win.fire("beforeinstallprompt", installEvent("accepted").event);
            app.noteRoomJoined(onAccount, account);
            app.noteAppOnAccount();
            app.noteConversationEnded();
            expect(get(app.cardVisibleStore)).toBe(true);
        });

        it("marks a logged in account once per load, from inside the app", () => {
            const setVariable = vi.fn();
            const { app } = setup({ env: env(IPHONE_SAFARI, { navigatorStandalone: true }) });
            app.noteRoomJoined(new Map(), { isLogged: () => true, setVariable });
            app.noteRoomJoined(new Map(), { isLogged: () => true, setVariable });
            expect(setVariable).toHaveBeenCalledTimes(1);
            expect(setVariable).toHaveBeenCalledWith({
                key: "universeAppInstalled",
                value: true,
                public: false,
                persist: true,
                scope: "world",
            });
        });

        it("marks nothing for a guest, nor from a browser tab", () => {
            const setVariable = vi.fn();
            const inApp = setup({ env: env(IPHONE_SAFARI, { navigatorStandalone: true }) });
            inApp.app.noteRoomJoined(new Map(), { isLogged: () => false, setVariable });
            const inBrowser = setup();
            inBrowser.app.noteRoomJoined(new Map(), { isLogged: () => true, setVariable });
            expect(setVariable).not.toHaveBeenCalled();
        });
    });

    describe("the test link", () => {
        const account = { isLogged: () => true, setVariable: vi.fn() };
        const closed = { lastShownAt: Date.now(), closeStreak: 5, lastClosed: true };

        it("forgets the record and shows without waiting for the first moment", () => {
            const storage = memoryStorage(closed);
            const { app, analytics } = setup({ storage });
            app.showForTestLink();
            expect(get(app.cardVisibleStore)).toBe(true);
            expect(analytics.cardShown).toHaveBeenCalledTimes(1);
            expect(storage.record).toEqual({ lastShownAt: Date.now(), closeStreak: 0, lastClosed: false });
        });

        it("ignores the mark on the account", () => {
            const { app } = setup();
            app.showForTestLink();
            app.noteRoomJoined(new Map([[APP_INSTALLED_VARIABLE, true]]), account);
            expect(get(app.cardVisibleStore)).toBe(true);
        });

        it("still shows only where installing is possible and while quiet", () => {
            const chrome = setup({ env: env(CHROME) });
            chrome.app.showForTestLink();
            expect(get(chrome.app.cardVisibleStore)).toBe(false);
            chrome.win.fire("beforeinstallprompt", installEvent("accepted").event);
            expect(get(chrome.app.cardVisibleStore)).toBe(true);

            const firefox = setup({ env: env(FIREFOX) });
            firefox.app.showForTestLink();
            expect(get(firefox.app.cardVisibleStore)).toBe(false);

            const busy = setup();
            busy.quiet.set(false);
            busy.app.showForTestLink();
            expect(get(busy.app.cardVisibleStore)).toBe(false);
            busy.quiet.set(true);
            expect(get(busy.app.cardVisibleStore)).toBe(true);
        });
    });
});
