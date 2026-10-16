import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

const { gameManager } = vi.hoisted(() => ({
    gameManager: {
        currentStartedRoom: { loginSceneLogo: "https://logos/login.png", errorSceneLogo: "https://logos/error.png" } as
            | Record<string, string>
            | undefined,
    },
}));
vi.mock("../../../Phaser/Game/GameManager", () => ({ gameManager }));
vi.mock("../../../Connection/ConnectionManager", () => ({ connectionManager: { logout: vi.fn() } }));
vi.mock("../../../Connection/LocalUserStore", () => ({ localUserStore: { setLastRoomUrl: vi.fn() } }));
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
import { showReconnectingScreen } from "../../../Connection/ReconnectScreen";
import ErrorScreen from "../ErrorScreen.svelte";
import { universeLogo } from "../../images/universeLogo";

describe("ErrorScreen logos", () => {
    let component: ErrorScreen | undefined;
    let target: HTMLElement;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        gameManager.currentStartedRoom = {
            loginSceneLogo: "https://logos/login.png",
            errorSceneLogo: "https://logos/error.png",
        };
        component?.$destroy();
        component = undefined;
        errorScreenStore.delete();
        document.body.innerHTML = "";
    });

    const images = () => Array.from(target.querySelectorAll("img")).map((img) => img.getAttribute("src"));

    it("shows one logo on an error screen, not the room's picture under it", async () => {
        errorScreenStore.setError({
            type: "error",
            code: "NETWORK_ERROR",
            title: "Network error",
            subtitle: "An error occurred while loading a resource",
        } as never);
        component = new ErrorScreen({ target });
        await tick();

        expect(images()).toEqual(["https://logos/login.png"]);
    });

    it("keeps a picture the error itself brings", async () => {
        errorScreenStore.setError({
            type: "error",
            code: "SOMETHING",
            title: "Title",
            image: "https://logos/custom.png",
        } as never);
        component = new ErrorScreen({ target });
        await tick();

        expect(images()).toEqual(["https://logos/login.png", "https://logos/custom.png"]);
    });

    it("shows the room's logo alone on the Reconnecting screen", async () => {
        showReconnectingScreen("https://logos/error.png");
        component = new ErrorScreen({ target });
        await tick();

        expect(images().filter((src) => src?.startsWith("https://"))).toEqual(["https://logos/error.png"]);
    });
    it("shows Universe's own logo, not the word, when no room has loaded yet", async () => {
        gameManager.currentStartedRoom = undefined;
        errorScreenStore.setError({
            type: "error",
            code: "NETWORK_ERROR",
            title: "Network error",
            subtitle: "Network Error",
        } as never);
        component = new ErrorScreen({ target });
        await tick();

        expect(images()).toEqual([universeLogo]);
        expect(universeLogo.startsWith("data:image/svg+xml,")).toBe(true);
        expect(target.querySelector(".logo")?.textContent?.trim()).toBe("");
    });

    it("shows Universe's own logo when the room's logo fails to load", async () => {
        errorScreenStore.setError({ type: "error", code: "SOMETHING", title: "Title" } as never);
        component = new ErrorScreen({ target });
        await tick();

        target.querySelector("img")?.dispatchEvent(new Event("error"));
        await tick();

        expect(images()).toEqual([universeLogo]);
    });
});
