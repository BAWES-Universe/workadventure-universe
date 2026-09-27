import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { modalIframeStore, modalIframeWindowStore } from "../../Stores/ModalStore";
import Modal from "./Modal.svelte";

vi.mock("../../Api/IframeListener", () => ({
    iframeListener: {
        registerIframe: vi.fn(),
        unregisterIframe: vi.fn(),
        sendModalCloseTriggered: vi.fn(),
    },
}));

vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: { currentStartedRoom: { mapUrl: "https://play.example.com/map.json" } },
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
});
