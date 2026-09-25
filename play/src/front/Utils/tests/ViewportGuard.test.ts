import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewportGuardWindow } from "../ViewportGuard";
import { installViewportGuard, resetPagePosition } from "../ViewportGuard";

type Listener = (event?: Event) => void;

/** A window whose visual viewport and page scroll behave like iOS Safari's around the on-screen keyboard. */
function fakeIosWindow() {
    const windowListeners = new Map<string, Set<Listener>>();
    const viewportListeners = new Map<string, Set<Listener>>();
    const on = (map: Map<string, Set<Listener>>, type: string, listener: Listener) => {
        if (!map.has(type)) map.set(type, new Set());
        map.get(type)?.add(listener);
    };
    const off = (map: Map<string, Set<Listener>>, type: string, listener: Listener) => map.get(type)?.delete(listener);
    const fire = (map: Map<string, Set<Listener>>, type: string) => map.get(type)?.forEach((listener) => listener());

    const viewport = {
        height: 800,
        addEventListener: (type: string, listener: Listener) => on(viewportListeners, type, listener),
        removeEventListener: (type: string, listener: Listener) => off(viewportListeners, type, listener),
    };
    const win = {
        innerHeight: 800,
        scrollX: 0,
        scrollY: 0,
        visualViewport: viewport,
        document,
        scrollTo: vi.fn((x: number, y: number) => {
            win.scrollX = x;
            win.scrollY = y;
        }),
        setTimeout: (handler: () => void) => {
            handler();
            return 0;
        },
        addEventListener: (type: string, listener: Listener) => on(windowListeners, type, listener),
        removeEventListener: (type: string, listener: Listener) => off(windowListeners, type, listener),
    };

    return {
        win: win as unknown as ViewportGuardWindow & { scrollX: number; scrollY: number },
        scrollTo: win.scrollTo,
        viewport,
        /** The keyboard opens and iOS pans the page to show the field (or a thumb drags it further). */
        openKeyboardAndPan(x: number, y: number) {
            viewport.height = 420;
            win.scrollX = x;
            win.scrollY = y;
            fire(viewportListeners, "resize");
        },
        /** The keyboard closes; iOS leaves the pan where it was. */
        closeKeyboard() {
            viewport.height = 800;
            fire(viewportListeners, "resize");
        },
        focusOut() {
            fire(windowListeners, "focusout");
        },
        scroll(x: number, y: number) {
            win.scrollX = x;
            win.scrollY = y;
            fire(windowListeners, "scroll");
        },
    };
}

describe("ViewportGuard", () => {
    let input: HTMLInputElement;
    let other: HTMLInputElement;
    let stop: (() => void) | undefined;

    beforeEach(() => {
        input = document.createElement("input");
        other = document.createElement("input");
        document.body.append(input, other);
    });

    afterEach(() => {
        stop?.();
        stop = undefined;
        document.body.innerHTML = "";
    });

    it("puts the page back when the keyboard closes after the app was dragged off-screen", () => {
        const ios = fakeIosWindow();
        stop = installViewportGuard(ios.win);
        input.focus();

        ios.openKeyboardAndPan(115, 380);
        // While the keyboard is open, iOS keeps the field in view: the pan is left alone.
        expect(ios.scrollTo).not.toHaveBeenCalled();

        input.blur();
        ios.closeKeyboard();
        expect(ios.win.scrollX).toBe(0);
        expect(ios.win.scrollY).toBe(0);
    });

    it("puts the page back when the field loses focus", () => {
        const ios = fakeIosWindow();
        stop = installViewportGuard(ios.win);
        input.focus();
        ios.openKeyboardAndPan(0, 300);

        input.blur();
        ios.focusOut();
        expect(ios.win.scrollY).toBe(0);
    });

    it("leaves the pan alone when focus moves to another text field (the keyboard stays up)", () => {
        const ios = fakeIosWindow();
        stop = installViewportGuard(ios.win);
        input.focus();
        ios.openKeyboardAndPan(0, 300);

        other.focus();
        ios.focusOut();
        expect(ios.scrollTo).not.toHaveBeenCalled();
    });

    it("undoes a stray page scroll when no field is focused and the keyboard is closed", () => {
        const ios = fakeIosWindow();
        stop = installViewportGuard(ios.win);

        ios.scroll(40, 120);
        expect(ios.win.scrollX).toBe(0);
        expect(ios.win.scrollY).toBe(0);
    });

    it("does nothing when the page never moved (desktop, Android)", () => {
        const ios = fakeIosWindow();
        stop = installViewportGuard(ios.win);
        input.focus();
        input.blur();
        ios.focusOut();
        ios.closeKeyboard();
        expect(ios.scrollTo).not.toHaveBeenCalled();
    });

    it("stops listening once removed", () => {
        const ios = fakeIosWindow();
        installViewportGuard(ios.win)();
        ios.scroll(0, 200);
        expect(ios.win.scrollY).toBe(200);
    });

    it("also resets the root elements' own scroll", () => {
        const ios = fakeIosWindow();
        document.documentElement.scrollTop = 0;
        document.body.scrollLeft = 30;
        resetPagePosition(ios.win);
        expect(document.body.scrollLeft).toBe(0);
    });
});
