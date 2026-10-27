import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { formatConversationTime, pickFitLevel } from "../TitleBarFit";
import type { FitLevel } from "../TitleBarFit";
import type { WindowControlsOverlayApi } from "../WindowControlsOverlay";
import {
    appViewportHeight,
    startTitleBar,
    TITLE_BAR_CLASS,
    titleBarGeometryStore,
    titleBarHeightStore,
} from "../WindowControlsOverlay";

describe("pickFitLevel", () => {
    // Which levels fit, tried in the order the strip tries them.
    async function pick(fits: (level: FitLevel) => boolean): Promise<{ level: FitLevel; tried: FitLevel[] }> {
        const tried: FitLevel[] = [];
        const level = await pickFitLevel((candidate) => {
            tried.push(candidate);
            return Promise.resolve(fits(candidate));
        });
        return { level, tried };
    }

    it("keeps every word when everything fits", async () => {
        expect(await pick(() => true)).toEqual({ level: 0, tried: [0] });
    });

    it("drops the bots count before anything else goes", async () => {
        expect(await pick((level) => level >= 1)).toEqual({ level: 1, tried: [0, 1] });
    });

    it("turns the two buttons into icons when the shorter count and a shorter room name are not enough", async () => {
        expect(await pick((level) => level >= 2)).toEqual({ level: 2, tried: [0, 1, 2] });
    });

    it("drops the faces last, when icons alone are not enough", async () => {
        expect(await pick((level) => level >= 3)).toEqual({ level: 3, tried: [0, 1, 2, 3] });
    });

    it("ends on the smallest layout when nothing fits, and leaves it laid out that way", async () => {
        expect(await pick(() => false)).toEqual({ level: 3, tried: [0, 1, 2, 3] });
    });
});

describe("formatConversationTime", () => {
    it("counts minutes and seconds", () => {
        expect(formatConversationTime(0)).toBe("00:00");
        expect(formatConversationTime(134.9)).toBe("02:14");
        expect(formatConversationTime(3600)).toBe("60:00");
        expect(formatConversationTime(-5)).toBe("00:00");
    });
});

describe("startTitleBar", () => {
    class FakeOverlay implements WindowControlsOverlayApi {
        visible = true;
        rect = { x: 0, y: 0, width: 1100, height: 33 };
        private listeners = new Set<() => void>();
        getTitlebarAreaRect() {
            return this.rect;
        }
        addEventListener(_type: "geometrychange", listener: () => void) {
            this.listeners.add(listener);
        }
        removeEventListener(_type: "geometrychange", listener: () => void) {
            this.listeners.delete(listener);
        }
        change() {
            this.listeners.forEach((listener) => listener());
        }
    }

    let overlay: FakeOverlay;
    let stop: () => void = () => {};

    function install(value: WindowControlsOverlayApi | undefined) {
        Object.defineProperty(window.navigator, "windowControlsOverlay", { value, configurable: true });
    }

    beforeEach(() => {
        overlay = new FakeOverlay();
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            callback(0);
            return 0;
        });
        Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    });

    afterEach(() => {
        stop();
        install(undefined);
        vi.restoreAllMocks();
    });

    it("does nothing where the browser has no title bar to hand over (phones, tabs, other browsers)", () => {
        install(undefined);
        stop = startTitleBar();
        expect(get(titleBarGeometryStore)).toBeUndefined();
        expect(get(titleBarHeightStore)).toBe(0);
        expect(document.documentElement.classList.contains(TITLE_BAR_CLASS)).toBe(false);
    });

    it("shows the strip once the app owns it and puts the page below it", () => {
        install(overlay);
        stop = startTitleBar();
        expect(get(titleBarGeometryStore)).toEqual({ x: 0, width: 1100, height: 33 });
        expect(get(titleBarHeightStore)).toBe(33);
        expect(appViewportHeight()).toBe(767);
        expect(document.documentElement.classList.contains(TITLE_BAR_CLASS)).toBe(true);
        expect(document.documentElement.style.getPropertyValue("--u-titlebar-h")).toBe("33px");
    });

    it("stays out of the way while Chrome's bar is on (the player has not clicked its arrow yet)", () => {
        overlay.visible = false;
        install(overlay);
        stop = startTitleBar();
        expect(get(titleBarGeometryStore)).toBeUndefined();
        expect(appViewportHeight()).toBe(800);
        expect(document.documentElement.classList.contains(TITLE_BAR_CLASS)).toBe(false);
    });

    it("follows the browser when its size changes or the player switches the strip on and off", () => {
        install(overlay);
        stop = startTitleBar();
        overlay.rect = { x: 0, y: 0, width: 700, height: 40 };
        overlay.change();
        expect(get(titleBarGeometryStore)).toEqual({ x: 0, width: 700, height: 40 });
        expect(get(titleBarHeightStore)).toBe(40);

        overlay.visible = false;
        overlay.change();
        expect(get(titleBarGeometryStore)).toBeUndefined();
        expect(get(titleBarHeightStore)).toBe(0);
        expect(document.documentElement.classList.contains(TITLE_BAR_CLASS)).toBe(false);
        expect(document.documentElement.style.getPropertyValue("--u-titlebar-h")).toBe("");
    });

    it("steps aside in full screen, where the browser has no window buttons", () => {
        install(overlay);
        stop = startTitleBar();
        Object.defineProperty(document, "fullscreenElement", { value: document.body, configurable: true });
        document.dispatchEvent(new Event("fullscreenchange"));
        expect(get(titleBarGeometryStore)).toBeUndefined();
        Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
        document.dispatchEvent(new Event("fullscreenchange"));
        expect(get(titleBarGeometryStore)).toEqual({ x: 0, width: 1100, height: 33 });
    });

    it("lets the rest of the app lay itself out again after the strip changes", () => {
        const resized = vi.fn();
        window.addEventListener("resize", resized);
        install(overlay);
        stop = startTitleBar();
        expect(resized).toHaveBeenCalledTimes(1);
        window.removeEventListener("resize", resized);
    });
});
