import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { modalFullScreenStore, modalIframeStore, modalIframeWindowStore } from "../../Stores/ModalStore";
import Modal from "./Modal.svelte";

vi.mock("../../Api/IframeListener", () => ({
    iframeListener: {
        registerIframe: vi.fn(),
        unregisterIframe: vi.fn(),
        sendModalCloseTriggered: vi.fn(),
    },
}));

const { reposition } = vi.hoisted(() => ({ reposition: vi.fn() }));

const { chatVisible, chatFloatInset } = vi.hoisted(() => {
    // Plain stores: the real ones read the game's settings from the page.
    const store = <T>(value: T) => {
        const subscribers = new Set<(v: T) => void>();
        return {
            subscribe(run: (v: T) => void) {
                subscribers.add(run);
                run(value);
                return () => subscribers.delete(run);
            },
            set(next: T) {
                value = next;
                subscribers.forEach((run) => run(value));
            },
        };
    };
    return { chatVisible: store(false), chatFloatInset: store(0) };
});

vi.mock("../../Stores/ChatStore", () => ({ chatVisibilityStore: chatVisible }));
vi.mock("../../Chat/ChatSidebarWidthStore", () => ({ chatFloatInsetStore: chatFloatInset }));

vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: {
        currentStartedRoom: { mapUrl: "https://play.example.com/map.json" },
        tryGetCurrentGameScene: () => ({ reposition }),
    },
}));

describe("Orbit's live modal frame", () => {
    let modal: Modal | undefined;
    let target: HTMLDivElement;

    beforeEach(() => {
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe = vi.fn();
                disconnect = vi.fn();
            }
        );
        target = document.createElement("div");
        document.body.append(target);
        modalIframeStore.set({
            title: "Orbit",
            src: "https://admin.example.com/admin",
            allow: null,
            allowApi: true,
            position: "right",
            allowFullScreen: true,
        });
    });

    afterEach(() => {
        modal?.$destroy();
        target.remove();
        modalIframeStore.set(null);
        modalIframeWindowStore.set(null);
        modalFullScreenStore.set(false);
        reposition.mockClear();
        chatVisible.set(false);
        chatFloatInset.set(0);
        vi.unstubAllGlobals();
    });

    it("changes pages inside the same iframe", async () => {
        modal = new Modal({ target });
        await tick();
        const iframe = target.querySelector("iframe")!;

        modalIframeStore.update((current) => ({ ...current!, src: "https://admin.example.com/admin/profile" }));
        await tick();

        expect(target.querySelector("iframe") === iframe).toBe(true);
        expect(iframe.src).toBe("https://admin.example.com/admin/profile");
    });

    it("keeps its frame and place while it closes, and closes cleanly, when the store is emptied at once", async () => {
        // Opening Explore or the menu closes the panel and empties the store in one turn.
        modal = new Modal({ target });
        await tick();
        const iframe = target.querySelector("iframe")!;

        modalIframeStore.set(null);
        await tick();

        expect(target.querySelector("iframe") === iframe).toBe(true);
        expect(target.querySelector(".menu-container")?.classList.contains("right")).toBe(true);
        expect(() => modal?.$destroy()).not.toThrow();
        modal = undefined;
        expect(target.querySelector(".menu-container")).toBeNull();
    });

    it("takes its side of the screen like the chat, so the player stays in view beside it", async () => {
        modal = new Modal({ target });
        await tick();
        const panel = target.querySelector(".menu-container")!;

        expect(panel.classList.contains("screen-blocker")).toBe(true);
        expect(reposition).toHaveBeenCalled();

        // The full-screen view covers the whole map: nothing is left to centre the player in.
        reposition.mockClear();
        modalFullScreenStore.set(true);
        await tick();
        expect(panel.classList.contains("screen-blocker")).toBe(false);
        expect(reposition).toHaveBeenCalled();

        // Closing gives the map back.
        reposition.mockClear();
        modal.$destroy();
        modal = undefined;
        expect(reposition).toHaveBeenCalled();
    });

    it("does not take a side when it is a centred window", async () => {
        modalIframeStore.update((current) => ({ ...current!, position: "center" }));
        modal = new Modal({ target });
        await tick();

        expect(target.querySelector(".menu-container")?.classList.contains("screen-blocker")).toBe(false);
    });

    it("offers the full-screen view at the same window widths when the chat floats beside it", async () => {
        const fullScreenButton = () => target.querySelector<HTMLButtonElement>('[aria-label="Open full-screen view"]');
        modal = new Modal({ target });
        await tick();
        expect(fullScreenButton()?.className).toContain("@lg/main-layout:flex");

        // The floating chat takes its 16px inset from the layout, so the threshold drops by as much.
        chatVisible.set(true);
        chatFloatInset.set(16);
        await tick();
        expect(fullScreenButton()?.className).toContain("@[1008px]/main-layout:flex");
        expect(fullScreenButton()?.className).not.toContain("@lg/main-layout:flex");

        // A chat that does not float (phones, small windows) keeps the usual threshold.
        chatFloatInset.set(0);
        await tick();
        expect(fullScreenButton()?.className).toContain("@lg/main-layout:flex");
    });
});
