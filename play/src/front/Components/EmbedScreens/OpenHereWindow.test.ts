import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
});
import { tick } from "svelte";
import { writable } from "svelte/store";

vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../../Stores/CardOverWindowStore", () => ({ cardOverWindowStore: writable(false) }));
// The window's close is the "Close all" of the open items, which has nothing to close here.
const closeAllOpenItems = vi.hoisted(() => vi.fn());
vi.mock("../../Stores/ClosedItemsStore", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    closeAllOpenItems,
}));

import { emoteMenuStore } from "../../Stores/EmoteStore";
import { expressTrayStore } from "../../Stores/ExpressStore";
import { lightboxOpenStore } from "../../Stores/UserInputStore";
import OpenHereWindow from "./OpenHereWindow.svelte";

describe("OpenHereWindow Esc", () => {
    let component: OpenHereWindow | undefined;
    let target: HTMLDivElement;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.append(target);
        component = new OpenHereWindow({ target, props: { floating: true } });
        closeAllOpenItems.mockClear();
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
        emoteMenuStore.closeEmoteMenu();
        expressTrayStore.close();
        lightboxOpenStore.set(false);
    });

    it("closes on Esc", async () => {
        await tick();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
        expect(closeAllOpenItems).toHaveBeenCalledTimes(1);
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
            expect(closeAllOpenItems).not.toHaveBeenCalled();
        }
    });
});
