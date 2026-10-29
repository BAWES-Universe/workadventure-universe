import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
});
import { tick } from "svelte";
import { get, writable } from "svelte/store";

vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../../Stores/CardOverWindowStore", () => ({ cardOverWindowStore: writable(false) }));
// The window's close is the "Close all" of the open items, and Esc closes the item in front: neither has anything to close here.
const closeAllOpenItems = vi.hoisted(() => vi.fn());
const closeFrontItem = vi.hoisted(() => vi.fn());
vi.mock("../../Stores/ClosedItemsStore", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    closeAllOpenItems,
    closeFrontItem,
}));

import { emoteMenuStore } from "../../Stores/EmoteStore";
import { expressTrayStore } from "../../Stores/ExpressStore";
import { lightboxOpenStore } from "../../Stores/UserInputStore";
import { askOpenHereForRoom } from "../../Stores/OpenHereSheetStore";
import { openHereTuckedStore } from "../../Stores/SideWindowInFrontStore";
import { coWebsiteRatio, fullScreenCowebsite } from "../../Stores/CoWebsiteStore";
import { gameManager } from "../../Phaser/Game/GameManager";
import type { GameScene } from "../../Phaser/Game/GameScene";
import OpenHereWindow from "./OpenHereWindow.svelte";

describe("OpenHereWindow Esc", () => {
    let component: OpenHereWindow | undefined;
    let target: HTMLDivElement;
    let scene: ReturnType<typeof vi.spyOn> | undefined;

    beforeEach(() => {
        // The window centres the map when it opens: there is no map here.
        scene = vi.spyOn(gameManager, "tryGetCurrentGameScene").mockReturnValue(undefined);
        target = document.createElement("div");
        document.body.append(target);
        component = new OpenHereWindow({ target, props: { floating: true } });
        closeAllOpenItems.mockClear();
        closeFrontItem.mockClear();
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        scene?.mockRestore();
        target.remove();
        emoteMenuStore.closeEmoteMenu();
        expressTrayStore.close();
        lightboxOpenStore.set(false);
    });

    it("closes the item in front on Esc, not everything", async () => {
        await tick();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
        expect(closeFrontItem).toHaveBeenCalledTimes(1);
        expect(closeAllOpenItems).not.toHaveBeenCalled();
    });

    it("leaves an Esc to the emote picker, the express tray or a picture shown large, even when they close on it", async () => {
        await tick();
        const cases: [() => void, () => void][] = [
            [() => emoteMenuStore.openEmoteMenu(), () => emoteMenuStore.closeEmoteMenu()],
            [() => expressTrayStore.open(), () => expressTrayStore.close()],
            [() => lightboxOpenStore.set(true), () => lightboxOpenStore.set(false)],
        ];
        for (const [open, close] of cases) {
            open();
            // Runs after the window's own capture listener, as these overlays' listeners do.
            window.addEventListener("keydown", close);
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
            window.removeEventListener("keydown", close);
            expect(closeFrontItem).not.toHaveBeenCalled();
        }
    });
});

describe("OpenHereWindow asked for room", () => {
    it("comes up from tucked when a list in it asks, and leaves an ask made before it opened alone", async () => {
        // The sheet centres the map as it settles: there is no map here.
        const scene = vi.spyOn(gameManager, "tryGetCurrentGameScene").mockReturnValue(undefined);
        const target = document.createElement("div");
        document.body.append(target);
        openHereTuckedStore.set(true);
        askOpenHereForRoom();
        const component = new OpenHereWindow({ target, props: { floating: false } });
        await tick();
        expect(get(openHereTuckedStore)).toBe(true);

        askOpenHereForRoom();
        await tick();
        expect(get(openHereTuckedStore)).toBe(false);

        // Tucked again by hand, it stays tucked: only a new ask brings it up.
        openHereTuckedStore.set(true);
        await tick();
        expect(get(openHereTuckedStore)).toBe(true);

        component.$destroy();
        target.remove();
        openHereTuckedStore.set(false);
        scene.mockRestore();
    });
});

describe("OpenHereWindow and the map", () => {
    const reposition = vi.fn();
    let component: OpenHereWindow | undefined;
    let target: HTMLDivElement;
    let scene: ReturnType<typeof vi.spyOn> | undefined;

    const frame = () => target.querySelector<HTMLElement>('[data-testid="openHereWindow"]');

    function transitionEnd(element: Element | null | undefined, propertyName: string): void {
        const event = new Event("transitionend", { bubbles: true });
        Object.defineProperty(event, "propertyName", { value: propertyName });
        element?.dispatchEvent(event);
    }

    beforeEach(async () => {
        reposition.mockClear();
        scene = vi.spyOn(gameManager, "tryGetCurrentGameScene").mockReturnValue({ reposition } as unknown as GameScene);
        target = document.createElement("div");
        document.body.append(target);
        component = new OpenHereWindow({ target, props: { floating: true } });
        await tick();
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        scene?.mockRestore();
        target.remove();
        fullScreenCowebsite.set(false);
    });

    it("takes its side of the screen, as Orbit's does, so the player is kept in the space beside it", () => {
        expect(frame()?.classList.contains("screen-blocker")).toBe(true);
        expect(reposition).toHaveBeenCalledTimes(1);
    });

    it("covers the whole map when expanded, and takes its side again when it comes back", async () => {
        reposition.mockClear();
        fullScreenCowebsite.set(true);
        await tick();
        expect(frame()?.classList.contains("screen-blocker")).toBe(false);
        expect(reposition).toHaveBeenCalledTimes(1);

        fullScreenCowebsite.set(false);
        await tick();
        expect(frame()?.classList.contains("screen-blocker")).toBe(true);
        expect(reposition).toHaveBeenCalledTimes(2);
    });

    it("centres the map again for a new width, and once more as the width stops moving", async () => {
        const width = get(coWebsiteRatio);
        try {
            reposition.mockClear();
            coWebsiteRatio.set(get(coWebsiteRatio) === 0.33 ? 0.5 : 0.33);
            await tick();
            expect(reposition).toHaveBeenCalledTimes(1);

            transitionEnd(frame(), "width");
            expect(reposition).toHaveBeenCalledTimes(2);
            // Not for another property, nor for something inside that moved.
            transitionEnd(frame(), "top");
            transitionEnd(frame()?.querySelector("#cowebsites-window"), "width");
            expect(reposition).toHaveBeenCalledTimes(2);
        } finally {
            coWebsiteRatio.set(width);
        }
    });

    it("gives the map its space back when it closes", () => {
        reposition.mockClear();
        component?.$destroy();
        component = undefined;
        expect(reposition).toHaveBeenCalledTimes(1);
    });
});
