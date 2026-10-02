import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const { windowSize } = vi.hoisted(() => {
    let value = { width: 1440, height: 900 };
    const subscribers = new Set<(v: typeof value) => void>();
    return {
        windowSize: {
            subscribe(run: (v: typeof value) => void) {
                subscribers.add(run);
                run(value);
                return () => subscribers.delete(run);
            },
            set(next: typeof value) {
                value = next;
                subscribers.forEach((run) => run(value));
            },
        },
    };
});
vi.mock("./CoWebsiteStore", () => ({ windowSize }));

describe("Keep the bar in view", () => {
    beforeEach(() => {
        vi.resetModules();
        localStorage.clear();
        windowSize.set({ width: 1440, height: 900 });
    });

    it("is on by default, on desktops only, and marks the page so the chat opens under the bar", async () => {
        const { barInViewStore, keepBarInViewStore } = await import("./BarInViewStore");
        expect(get(keepBarInViewStore)).toBe(true);
        expect(get(barInViewStore)).toBe(true);
        expect(document.documentElement.classList.contains("u-bar-in-view")).toBe(true);

        windowSize.set({ width: 900, height: 900 });
        expect(get(barInViewStore)).toBe(false);
        expect(document.documentElement.classList.contains("u-bar-in-view")).toBe(false);
    });

    it("is kept on this device when switched off", async () => {
        const first = await import("./BarInViewStore");
        first.keepBarInViewStore.set(false);
        expect(localStorage.getItem("keepBarInView")).toBe("false");

        vi.resetModules();
        const second = await import("./BarInViewStore");
        expect(get(second.keepBarInViewStore)).toBe(false);
        expect(get(second.barInViewStore)).toBe(false);
    });
});
