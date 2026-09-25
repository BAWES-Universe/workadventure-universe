import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

vi.mock("../../../Phaser/Game/GameManager", () => ({ gameManager: { currentStartedRoom: undefined } }));
vi.mock("../../../Connection/ConnectionManager", () => ({ connectionManager: { logout: vi.fn() } }));
vi.mock("../../../Stores/MenuStore", async () => {
    const { writable } = await import("svelte/store");
    return { userIsConnected: writable(false) };
});
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const text = {
        menu: { profile: { logout: () => "Logout" } },
        warning: {
            reconnectingTitle: () => "Reconnecting",
            reconnectingDetails: () => "Getting you back in",
            offlineTitle: () => "You're offline",
            offlineDetails: () => "We'll reconnect as soon as you're back online",
        },
    };
    return { default: readable(text), LL: readable(text) };
});

import { errorScreenStore } from "../../../Stores/ErrorScreenStore";
import { OFFLINE_NOTICE_AFTER_MS, showReconnectingScreen } from "../../../Connection/ReconnectScreen";
import ErrorScreen from "../ErrorScreen.svelte";

function setOnline(online: boolean) {
    Object.defineProperty(navigator, "onLine", { value: online, configurable: true });
    window.dispatchEvent(new Event(online ? "online" : "offline"));
}

describe("ErrorScreen while reconnecting", () => {
    let component: ErrorScreen | undefined;
    let target: HTMLElement;

    beforeEach(() => {
        vi.useFakeTimers();
        setOnline(true);
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        errorScreenStore.delete();
        document.body.innerHTML = "";
        setOnline(true);
        vi.useRealTimers();
    });

    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";

    it("says it is reconnecting, calmly, with the spinner under the text", async () => {
        showReconnectingScreen(undefined);
        component = new ErrorScreen({ target });
        await tick();

        expect(target.querySelector("h2")?.textContent?.trim()).toBe("Reconnecting");
        expect(text()).toContain("Getting you back in");
        expect(text()).not.toMatch(/error|code/i);
        const details = target.querySelector('[data-testid="reconnectingDetails"]');
        expect(details?.classList.contains("flex-col")).toBe(true);
        // Text first, then the spinner under it.
        expect(details?.firstElementChild?.tagName).toBe("SPAN");
        expect(details?.lastElementChild?.tagName.toLowerCase()).toBe("svg");
    });

    it("says the device is offline only after a while without network, and goes back when online", async () => {
        showReconnectingScreen(undefined);
        component = new ErrorScreen({ target });
        await tick();
        setOnline(false);

        vi.advanceTimersByTime(OFFLINE_NOTICE_AFTER_MS - 2000);
        await tick();
        expect(target.querySelector("h2")?.textContent?.trim()).toBe("Reconnecting");

        vi.advanceTimersByTime(3000);
        await tick();
        expect(target.querySelector("h2")?.textContent?.trim()).toBe("You're offline");
        expect(text()).toContain("We'll reconnect as soon as you're back online");
        expect(target.querySelector('[data-testid="reconnectingDetails"] svg')).not.toBeNull();

        setOnline(true);
        await tick();
        expect(target.querySelector("h2")?.textContent?.trim()).toBe("Reconnecting");
    });

    it("keeps saying reconnecting while the network is there, however long it takes", async () => {
        showReconnectingScreen(undefined);
        component = new ErrorScreen({ target });
        await tick();

        vi.advanceTimersByTime(OFFLINE_NOTICE_AFTER_MS * 3);
        await tick();

        expect(target.querySelector("h2")?.textContent?.trim()).toBe("Reconnecting");
    });

    it("leaves other screens as they were: an error keeps its code line and no reconnect block", async () => {
        errorScreenStore.setError({
            type: "error",
            code: "SOME_ERROR",
            title: "Something went wrong",
            subtitle: "",
            details: "details",
            image: "",
            imageLogo: "",
            timeToRetry: undefined,
            buttonTitle: undefined,
            canRetryManual: undefined,
            urlToRedirect: undefined,
        });
        component = new ErrorScreen({ target });
        await tick();

        expect(target.querySelector("h2")?.textContent?.trim()).toBe("Something went wrong");
        expect(text()).toContain("Code : SOME_ERROR");
        expect(target.querySelector('[data-testid="reconnectingDetails"]')).toBeNull();
        expect(target.querySelector("p.details")).not.toBeNull();
    });
});
