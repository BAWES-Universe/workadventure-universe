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

describe("Bar in view", () => {
    beforeEach(() => {
        vi.resetModules();
        localStorage.clear();
        windowSize.set({ width: 1440, height: 900 });
    });

    it("applies on desktops only and marks the page so the chat opens under the bar", async () => {
        const { barInViewStore } = await import("./BarInViewStore");
        expect(get(barInViewStore)).toBe(true);
        expect(document.documentElement.classList.contains("u-bar-in-view")).toBe(true);

        windowSize.set({ width: 900, height: 900 });
        expect(get(barInViewStore)).toBe(false);
        expect(document.documentElement.classList.contains("u-bar-in-view")).toBe(false);
    });

    it('ignores and clears an old saved "off" from the removed menu switch', async () => {
        localStorage.setItem("keepBarInView", "false");
        const { barInViewStore } = await import("./BarInViewStore");
        expect(get(barInViewStore)).toBe(true);
        expect(localStorage.getItem("keepBarInView")).toBeNull();
    });
});
