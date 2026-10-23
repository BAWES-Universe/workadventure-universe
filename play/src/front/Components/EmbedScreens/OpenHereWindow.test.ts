import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
});
import { tick } from "svelte";
import { writable } from "svelte/store";

vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../../Stores/CardOverWindowStore", () => ({ cardOverWindowStore: writable(false) }));

import { emoteMenuStore } from "../../Stores/EmoteStore";
import { expressTrayStore } from "../../Stores/ExpressStore";
import { lightboxOpenStore } from "../../Stores/UserInputStore";
import { fullScreenCowebsite } from "../../Stores/CoWebsiteStore";
import OpenHereWindow from "./OpenHereWindow.svelte";

describe("OpenHereWindow Esc", () => {
    let component: OpenHereWindow | undefined;
    let target: HTMLDivElement;
    let closed: number;
    let unsubscribe: () => void;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.append(target);
        component = new OpenHereWindow({ target, props: { floating: true } });
        closed = 0;
        // Closing the window turns the full-screen view off first.
        fullScreenCowebsite.set(true);
        unsubscribe = fullScreenCowebsite.subscribe((value) => {
            if (!value) closed++;
        });
    });

    afterEach(() => {
        unsubscribe();
        component?.$destroy();
        component = undefined;
        target.remove();
        emoteMenuStore.closeEmoteMenu();
        expressTrayStore.close();
        lightboxOpenStore.set(false);
    });

    it("closes on Esc", async () => {
        await tick();
        const before = closed;
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
        expect(closed).toBeGreaterThan(before);
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
            const before = closed;
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
            window.removeEventListener("keydown", close);
            expect(closed).toBe(before);
        }
    });
});
