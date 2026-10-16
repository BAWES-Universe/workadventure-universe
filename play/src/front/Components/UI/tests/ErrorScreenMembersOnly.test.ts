import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

const scene = vi.hoisted(() => ({ key: "/@/uni/world/denied" as string | undefined }));
vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        currentStartedRoom: { loginSceneLogo: "https://logos/login.png", errorSceneLogo: "https://logos/error.png" },
        tryGetCurrentGameScene: () => (scene.key ? { room: { key: scene.key } } : undefined),
    },
}));
vi.mock("../../../Connection/ConnectionManager", () => ({ connectionManager: { logout: vi.fn() } }));
const save = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../../../Connection/LocalUserStore", () => ({ localUserStore: { setLastRoomUrl: save } }));
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const text = {
        warning: {
            membersOnly: {
                back: ({ room }: { room: string }) => `Back to ${room}`,
                backToLastRoom: () => "Back to the last room",
                startRoom: () => "Go to the start room",
            },
        },
    };
    return { default: readable(text), LL: readable(text) };
});

import { errorScreenStore } from "../../../Stores/ErrorScreenStore";
import { rememberRoomLeft } from "../../../Connection/MembersOnlyExit";
import ErrorScreen from "../ErrorScreen.svelte";

function showMembersOnly() {
    errorScreenStore.setErrorFromApi({
        status: "error",
        type: "error",
        title: "Members only",
        subtitle: "This place is only open to its members",
        code: "MEMBERS_ONLY",
        details: "Ask one of its admins to invite you, then come back.",
    });
}

describe("ErrorScreen on Members only", () => {
    let component: ErrorScreen | undefined;
    let target: HTMLElement;
    const assign = vi.fn();
    const originalLocation = window.location;

    beforeEach(() => {
        assign.mockReset();
        Object.defineProperty(window, "location", {
            value: { ...originalLocation, href: "https://universe.example/@/uni/world/denied", assign },
            configurable: true,
        });
        save.mockClear();
        scene.key = "/@/uni/world/denied";
        rememberRoomLeft({ href: "https://universe.example/@/other" }, { key: "/@/other/room" });
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        errorScreenStore.delete();
        Object.defineProperty(window, "location", { value: originalLocation, configurable: true });
        document.body.innerHTML = "";
    });

    const button = () => target.querySelector<HTMLButtonElement>('[data-testid="membersOnlyExitButton"]');

    it("has a button back to the room the player came from", async () => {
        rememberRoomLeft(
            { href: "https://universe.example/@/uni/world/cedar-hall", roomName: "Cedar Hall" },
            { key: "/@/uni/world/denied" }
        );
        showMembersOnly();
        component = new ErrorScreen({ target });
        await tick();

        expect(button()?.textContent?.trim()).toBe("Back to Cedar Hall");
        // The denied room is not kept as the last room: the room they came from is.
        expect(save).toHaveBeenCalledWith("https://universe.example/@/uni/world/cedar-hall");
        button()?.click();
        expect(assign).toHaveBeenCalledWith("https://universe.example/@/uni/world/cedar-hall");
    });

    it("has a Go to the start room button after a shared link", async () => {
        showMembersOnly();
        component = new ErrorScreen({ target });
        await tick();

        expect(button()?.textContent?.trim()).toBe("Go to the start room");
        expect(save).toHaveBeenCalledWith("https://universe.example/");
        button()?.click();
        expect(assign).toHaveBeenCalledWith("https://universe.example/");
    });

    it("has no such button on other error screens", async () => {
        errorScreenStore.setError({ type: "error", code: "NETWORK_ERROR", title: "Network error" } as never);
        component = new ErrorScreen({ target });
        await tick();

        expect(button()).toBeNull();
        expect(save).not.toHaveBeenCalled();
    });
});
