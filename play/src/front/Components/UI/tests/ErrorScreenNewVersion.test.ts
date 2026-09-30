import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        currentStartedRoom: { loginSceneLogo: "https://logos/login.png", errorSceneLogo: "https://logos/error.png" },
    },
}));
vi.mock("../../../Connection/ConnectionManager", () => ({ connectionManager: { logout: vi.fn() } }));
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const text = {
        menu: { profile: { logout: () => "Logout" } },
        warning: {
            reconnectingTitle: () => "Reconnecting",
            reconnectingDetails: () => "Getting you back in",
            offlineTitle: () => "You're offline",
            offlineDetails: () => "We'll reconnect as soon as you're back online",
            newVersion: {
                title: () => "Universe just got an update",
                countdown: ({ seconds }: { seconds: number }) => `Refreshing in ${seconds}s`,
                manual: () => "Refresh to load the latest version",
                refreshNow: () => "Refresh now",
            },
        },
    };
    return { default: readable(text), LL: readable(text) };
});

import { errorScreenStore } from "../../../Stores/ErrorScreenStore";
import { showReconnectingScreen } from "../../../Connection/ReconnectScreen";
import { MAX_AUTO_RELOADS, NEW_VERSION_COUNTDOWN_MS, recordAutoReload } from "../../../Connection/NewVersionReload";
import ErrorScreen from "../ErrorScreen.svelte";

// What the server sends when the page is older than it.
function showNewVersionScreen() {
    errorScreenStore.setErrorFromApi({
        status: "error",
        type: "retry",
        title: "Please refresh",
        subtitle: "New version available",
        code: "NEW_VERSION",
        details: "A new version of Universe is available. Please refresh the page.",
        canRetryManual: true,
        buttonTitle: "Refresh",
        timeToRetry: 999999,
    });
}

describe("ErrorScreen when a new version is out", () => {
    let component: ErrorScreen | undefined;
    let target: HTMLElement;
    const reload = vi.fn();
    const originalLocation = window.location;

    beforeEach(() => {
        vi.useFakeTimers();
        window.sessionStorage.clear();
        Object.defineProperty(window, "location", { value: { ...originalLocation, reload }, configurable: true });
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        errorScreenStore.delete();
        document.body.innerHTML = "";
        Object.defineProperty(window, "location", { value: originalLocation, configurable: true });
        reload.mockReset();
        vi.useRealTimers();
    });

    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const images = () => Array.from(target.querySelectorAll("img")).map((img) => img.getAttribute("src"));

    it("replaces the reconnecting screen cleanly: one logo, the update copy, no log out", async () => {
        showReconnectingScreen("https://logos/error.png");
        component = new ErrorScreen({ target });
        await tick();
        expect(text()).toContain("Getting you back in");

        showNewVersionScreen();
        await tick();

        expect(images()).toEqual(["https://logos/login.png"]);
        expect(target.querySelector("h2")?.textContent?.trim()).toBe("Universe just got an update");
        expect(text()).toContain("Refreshing in 10s");
        expect(text()).not.toContain("Getting you back in");
        expect(text()).not.toMatch(/log ?out/i);
        expect(target.querySelectorAll("button")).toHaveLength(1);
        expect(target.querySelector("button")?.textContent?.trim()).toBe("Refresh now");
    });

    it("counts down from ten seconds and then reloads", async () => {
        showNewVersionScreen();
        component = new ErrorScreen({ target });
        await tick();

        vi.advanceTimersByTime(3000);
        await tick();
        expect(text()).toContain("Refreshing in 7s");
        expect(reload).not.toHaveBeenCalled();

        vi.advanceTimersByTime(NEW_VERSION_COUNTDOWN_MS);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("stops reloading on its own after recent reloads still landed on the old version", async () => {
        for (let i = 0; i < MAX_AUTO_RELOADS; i++) recordAutoReload();
        showNewVersionScreen();
        component = new ErrorScreen({ target });
        await tick();

        expect(text()).toContain("Refresh to load the latest version");
        vi.advanceTimersByTime(NEW_VERSION_COUNTDOWN_MS * 2);
        expect(reload).not.toHaveBeenCalled();

        target.querySelector("button")?.click();
        expect(reload).toHaveBeenCalledTimes(1);
    });
});
