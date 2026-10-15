import { describe, expect, it } from "vitest";
import type { FullViewportWindow } from "../FullViewportHeight";
import { fullViewportHeight, installFullViewportHeight } from "../FullViewportHeight";

/** A window whose `100lvh` measures `large` px, in the installed app or not. */
function fakeWindow(innerHeight: number, large: number, standalone: boolean) {
    const listeners = new Map<string, () => void>();
    const style = new Map<string, string>();
    const classes = new Set<string>();
    const documentElement = {
        appendChild: (node: unknown) => node,
        classList: {
            add: (name: string) => classes.add(name),
            remove: (name: string) => classes.delete(name),
        },
        style: {
            setProperty: (name: string, value: string) => style.set(name, value),
            removeProperty: (name: string) => style.delete(name),
        },
    };
    const win = {
        innerHeight,
        navigator: { standalone },
        document: {
            documentElement,
            createElement: () => ({
                style: { cssText: "" },
                getBoundingClientRect: () => ({ height: large }),
                remove: () => undefined,
            }),
        },
        addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
    };
    return { win, style, classes, listeners };
}

describe("fullViewportHeight", () => {
    it("takes the whole screen when iOS gives the installed app a viewport short by the status bar", () => {
        const { win } = fakeWindow(879, 926, true);
        expect(fullViewportHeight(win as unknown as FullViewportWindow)).toBe(926);
    });

    it("keeps innerHeight in a browser tab", () => {
        const { win } = fakeWindow(879, 926, false);
        expect(fullViewportHeight(win as unknown as FullViewportWindow)).toBe(879);
    });

    it("keeps innerHeight when iOS sizes the installed app right", () => {
        const { win } = fakeWindow(926, 926, true);
        expect(fullViewportHeight(win as unknown as FullViewportWindow)).toBe(926);
    });

    it("ignores a difference far larger than a status bar", () => {
        const { win } = fakeWindow(500, 926, true);
        expect(fullViewportHeight(win as unknown as FullViewportWindow)).toBe(500);
    });
});

describe("installFullViewportHeight", () => {
    it("sizes the page to the screen while the viewport is short, and stops when it is right", () => {
        const fake = fakeWindow(879, 926, true);
        const stop = installFullViewportHeight(fake.win as unknown as Parameters<typeof installFullViewportHeight>[0]);
        expect(fake.classes.has("u-full-viewport")).toBe(true);
        expect(fake.style.get("--u-app-height")).toBe("926px");

        fake.win.innerHeight = 926;
        fake.listeners.get("resize")?.();
        expect(fake.classes.has("u-full-viewport")).toBe(false);
        expect(fake.style.has("--u-app-height")).toBe(false);

        stop();
        expect(fake.listeners.size).toBe(0);
    });

    it("does nothing in a browser tab", () => {
        const fake = fakeWindow(879, 926, false);
        installFullViewportHeight(fake.win as unknown as Parameters<typeof installFullViewportHeight>[0]);
        expect(fake.classes.has("u-full-viewport")).toBe(false);
    });
});
