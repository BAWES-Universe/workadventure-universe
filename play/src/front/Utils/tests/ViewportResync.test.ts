import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewportResyncWindow } from "../ViewportResync";
import { RESYNC_DELAYS_MS, installViewportResync } from "../ViewportResync";

/** A window whose size can change with or without a `resize` event, like a phone restoring a background tab. */
function fakeWindow(size: { width: number; height: number }) {
    const listeners = new Map<string, Set<EventListener>>();
    const docListeners = new Map<string, Set<EventListener>>();
    const on = (map: Map<string, Set<EventListener>>, type: string, listener: EventListener) => {
        if (!map.has(type)) map.set(type, new Set());
        map.get(type)?.add(listener);
    };
    const off = (map: Map<string, Set<EventListener>>, type: string, listener: EventListener) =>
        map.get(type)?.delete(listener);
    const fire = (map: Map<string, Set<EventListener>>, type: string) => {
        for (const listener of [...(map.get(type) ?? [])]) listener(new Event(type));
    };
    const resizes = vi.fn();
    const document = {
        visibilityState: "visible" as DocumentVisibilityState,
        addEventListener: (type: string, listener: EventListener) => on(docListeners, type, listener),
        removeEventListener: (type: string, listener: EventListener) => off(docListeners, type, listener),
    };
    const win = {
        innerWidth: size.width,
        innerHeight: size.height,
        document,
        setTimeout: (handler: () => void, timeout?: number) => setTimeout(handler, timeout) as unknown as number,
        clearTimeout: (id: number) => clearTimeout(id),
        addEventListener: (type: string, listener: EventListener) => on(listeners, type, listener),
        removeEventListener: (type: string, listener: EventListener) => off(listeners, type, listener),
        dispatchEvent: (event: Event) => {
            if (event.type === "resize") resizes();
            fire(listeners, event.type);
            return true;
        },
    };
    return {
        win: win as unknown as ViewportResyncWindow,
        resizes,
        /** The phone changes the window size without telling the page. */
        setSizeSilently(width: number, height: number) {
            win.innerWidth = width;
            win.innerHeight = height;
        },
        /** The phone changes the window size and sends `resize`, as usual. */
        resize(width: number, height: number) {
            win.innerWidth = width;
            win.innerHeight = height;
            win.dispatchEvent(new Event("resize"));
            resizes.mockClear();
        },
        hide() {
            document.visibilityState = "hidden";
            fire(docListeners, "visibilitychange");
        },
        show() {
            document.visibilityState = "visible";
            fire(docListeners, "visibilitychange");
        },
        pageShow() {
            fire(listeners, "pageshow");
        },
    };
}

describe("installViewportResync", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("resizes the app when the page comes back at a size it never got a resize for", () => {
        // Loaded in a background tab, measured as a wide screen.
        const phone = fakeWindow({ width: 980, height: 1800 });
        const onResync = vi.fn();
        installViewportResync(phone.win, { onResync });

        phone.hide();
        phone.setSizeSilently(390, 844);
        phone.show();
        vi.advanceTimersByTime(0);

        expect(phone.resizes).toHaveBeenCalledTimes(1);
        expect(onResync).toHaveBeenCalledWith({
            fromWidth: 980,
            fromHeight: 1800,
            toWidth: 390,
            toHeight: 844,
            reason: "visible",
        });

        // Once in line, the later checks do nothing.
        vi.advanceTimersByTime(Math.max(...RESYNC_DELAYS_MS));
        expect(phone.resizes).toHaveBeenCalledTimes(1);
    });

    it("catches a size the phone settles on a moment after showing the page", () => {
        const phone = fakeWindow({ width: 980, height: 1800 });
        installViewportResync(phone.win);

        phone.pageShow();
        vi.advanceTimersByTime(100);
        expect(phone.resizes).not.toHaveBeenCalled();

        phone.setSizeSilently(390, 844);
        vi.advanceTimersByTime(Math.max(...RESYNC_DELAYS_MS));
        expect(phone.resizes).toHaveBeenCalledTimes(1);
    });

    it("does nothing when the size is the one the app already has", () => {
        const phone = fakeWindow({ width: 390, height: 844 });
        const onResync = vi.fn();
        installViewportResync(phone.win, { onResync });

        phone.hide();
        phone.show();
        phone.pageShow();
        vi.runAllTimers();

        expect(phone.resizes).not.toHaveBeenCalled();
        expect(onResync).not.toHaveBeenCalled();
    });

    it("leaves sizes the phone did announce alone (rotating, the keyboard on Android)", () => {
        const phone = fakeWindow({ width: 390, height: 844 });
        installViewportResync(phone.win);

        phone.resize(844, 390);
        phone.hide();
        phone.show();
        vi.runAllTimers();

        expect(phone.resizes).not.toHaveBeenCalled();
    });

    it("stops checking once uninstalled", () => {
        const phone = fakeWindow({ width: 980, height: 1800 });
        const stop = installViewportResync(phone.win);

        phone.show();
        stop();
        phone.setSizeSilently(390, 844);
        vi.runAllTimers();
        phone.show();
        vi.runAllTimers();

        expect(phone.resizes).not.toHaveBeenCalled();
    });
});
