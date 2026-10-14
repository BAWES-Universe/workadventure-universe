// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { chatVisibilityStore } from "../../Stores/ChatStore";
import ChatSidebar from "../ChatSidebar.svelte";

const { scene } = vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
    return { scene: { current: { reposition: vi.fn() } } };
});

// The tests run Svelte's server build, where onMount does nothing; the chat needs the browser one.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));

vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => scene.current,
        tryGetCurrentGameScene: () => scene.current,
    },
}));

vi.mock("../Components/Chat.svelte", async () => await import("./ChatStub.svelte"));

vi.mock("../../Administration/AnalyticsClient", () => ({
    analyticsClient: { chatPanelOpened: vi.fn() },
}));

vi.mock("../../../i18n/i18n-svelte", async () => (await import("../../Components/Woka/tests/i18nStub")).i18nStub);

describe("ChatSidebar and the map's camera", () => {
    let sidebar: ChatSidebar | undefined;
    let target: HTMLDivElement;

    beforeEach(() => {
        scene.current = { reposition: vi.fn() };
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        sidebar?.$destroy();
        sidebar = undefined;
        target.remove();
        chatVisibilityStore.set(false);
    });

    it("centres the map at once when the chat comes back already open (after a reconnect)", async () => {
        chatVisibilityStore.set(true);

        sidebar = new ChatSidebar({ target });
        await tick();

        expect(scene.current.reposition).toHaveBeenCalledWith(true);
    });

    it("leaves the map alone when it mounts with the chat closed", async () => {
        sidebar = new ChatSidebar({ target });
        await tick();

        expect(scene.current.reposition).not.toHaveBeenCalled();
    });

    it("moves the scene of the moment, not the one there when the chat mounted", async () => {
        chatVisibilityStore.set(true);
        sidebar = new ChatSidebar({ target });
        await tick();
        const before = scene.current;
        // A reconnect replaces the scene while the chat stays open.
        scene.current = { reposition: vi.fn() };

        // Resizing the chat beside the game (a double click on its edge) moves the map again.
        target.querySelector("#resize-bar")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

        expect(before.reposition).toHaveBeenCalledTimes(1);
        expect(scene.current.reposition).toHaveBeenCalledTimes(1);
    });
});
