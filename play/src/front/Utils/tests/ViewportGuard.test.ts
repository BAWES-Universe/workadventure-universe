import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewportGuardWindow } from "../ViewportGuard";
import { MOMENTUM_MS, REVEAL_WINDOW_MS, installViewportGuard, resetPagePosition } from "../ViewportGuard";

type Listener = (event?: Event) => void;

interface FakeEvent {
    target?: EventTarget | null;
    touches?: { clientX: number; clientY: number }[];
    cancelable: boolean;
    defaultPrevented: boolean;
    preventDefault(): void;
}

function fakeEvent(init: Partial<FakeEvent> = {}): FakeEvent {
    const event: FakeEvent = {
        cancelable: true,
        defaultPrevented: false,
        preventDefault() {
            event.defaultPrevented = true;
        },
        ...init,
    };
    return event;
}

/** A window whose visual viewport and page pan behave like iOS Safari's around the on-screen keyboard. */
function fakeIosWindow(options: { scale?: number } = {}) {
    let time = 0;
    const windowListeners = new Map<string, Set<Listener>>();
    const viewportListeners = new Map<string, Set<Listener>>();
    const on = (map: Map<string, Set<Listener>>, type: string, listener: Listener) => {
        if (!map.has(type)) map.set(type, new Set());
        map.get(type)?.add(listener);
    };
    const off = (map: Map<string, Set<Listener>>, type: string, listener: Listener) => map.get(type)?.delete(listener);
    const fire = (map: Map<string, Set<Listener>>, type: string, event?: FakeEvent) =>
        map.get(type)?.forEach((listener) => listener(event as unknown as Event));

    const viewport = {
        height: 800,
        scale: options.scale ?? 1,
        pageLeft: 0,
        pageTop: 0,
        addEventListener: (type: string, listener: Listener) => on(viewportListeners, type, listener),
        removeEventListener: (type: string, listener: Listener) => off(viewportListeners, type, listener),
    };
    const moveTo = (x: number, y: number) => {
        viewport.pageLeft = x;
        viewport.pageTop = y;
    };
    const win = {
        innerHeight: 800,
        scrollX: 0,
        scrollY: 0,
        visualViewport: viewport,
        document,
        scrollTo: vi.fn((x: number, y: number) => moveTo(x, y)),
        setTimeout: (handler: () => void) => {
            handler();
            return 0;
        },
        addEventListener: (type: string, listener: Listener) => on(windowListeners, type, listener),
        removeEventListener: (type: string, listener: Listener) => off(windowListeners, type, listener),
    };
    /** iOS moves the page and says so. */
    const pan = (x: number, y: number) => {
        moveTo(x, y);
        fire(viewportListeners, "scroll");
    };

    return {
        win: win as unknown as ViewportGuardWindow,
        scrollTo: win.scrollTo,
        viewport,
        now: () => time,
        wait(ms: number) {
            time += ms;
        },
        /** The keyboard opens and iOS pans the page to show the field. */
        openKeyboard(revealAt = 300) {
            viewport.height = 420;
            fire(viewportListeners, "resize");
            pan(0, revealAt);
        },
        /** The keyboard closes; iOS leaves the pan where it was. */
        closeKeyboard() {
            viewport.height = 800;
            fire(viewportListeners, "resize");
        },
        pan,
        focusChange() {
            fire(windowListeners, "focusout");
        },
        /** A thumb drag on this element: the page pans unless the drag was cancelled. */
        drag(target: Element, dy: number) {
            fire(windowListeners, "touchstart", fakeEvent({ target, touches: [{ clientX: 100, clientY: 400 }] }));
            const move = fakeEvent({ target, touches: [{ clientX: 100, clientY: 400 + dy }] });
            fire(windowListeners, "touchmove", move);
            if (!move.defaultPrevented) pan(viewport.pageLeft, viewport.pageTop - dy);
            fire(windowListeners, "touchend", fakeEvent({ target, touches: [] }));
            return move;
        },
        pinch(target: Element) {
            const move = fakeEvent({
                target,
                touches: [
                    { clientX: 100, clientY: 400 },
                    { clientX: 200, clientY: 500 },
                ],
            });
            fire(windowListeners, "touchmove", move);
            const gesture = fakeEvent({ target });
            fire(windowListeners, "gesturestart", gesture);
            return { move, gesture };
        },
        fire: (type: string, event?: FakeEvent) => fire(windowListeners, type, event),
    };
}

describe("ViewportGuard", () => {
    let input: HTMLInputElement;
    let other: HTMLInputElement;
    let game: HTMLDivElement;
    let stop: (() => void) | undefined;

    beforeEach(() => {
        input = document.createElement("input");
        other = document.createElement("input");
        game = document.createElement("div");
        document.body.append(input, other, game);
    });

    afterEach(() => {
        stop?.();
        stop = undefined;
        document.body.innerHTML = "";
        document.head.innerHTML = "";
    });

    it("puts the page back when the keyboard closes", () => {
        const ios = fakeIosWindow();
        stop = installViewportGuard(ios.win, { now: ios.now });
        input.focus();
        ios.openKeyboard(300);
        // While the keyboard is open, iOS keeps the field in view: its pan is left alone.
        expect(ios.viewport.pageTop).toBe(300);

        input.blur();
        ios.closeKeyboard();
        expect(ios.viewport.pageTop).toBe(0);
    });

    it("ignores a thumb drag on the game while the keyboard is up", () => {
        const ios = fakeIosWindow();
        stop = installViewportGuard(ios.win, { now: ios.now });
        input.focus();
        ios.openKeyboard(300);
        ios.wait(REVEAL_WINDOW_MS);

        const move = ios.drag(game, 120);
        expect(move.defaultPrevented).toBe(true);
        expect(ios.viewport.pageTop).toBe(300);
    });

    it("undoes a pan it could not stop, as a drag on an embedded page (the Orbit frame)", () => {
        const ios = fakeIosWindow();
        const frame = document.createElement("iframe");
        document.body.append(frame);
        stop = installViewportGuard(ios.win, { now: ios.now });
        frame.focus();
        ios.openKeyboard(300);
        ios.wait(REVEAL_WINDOW_MS);

        // The finger is on the frame: this page sees no touch, only the page moving.
        ios.pan(0, 80);
        expect(ios.viewport.pageTop).toBe(300);
        ios.pan(0, 380);
        expect(ios.viewport.pageTop).toBe(300);
    });

    it("lets iOS reveal the next field when focus moves, then holds it there", () => {
        const ios = fakeIosWindow();
        stop = installViewportGuard(ios.win, { now: ios.now });
        input.focus();
        ios.openKeyboard(300);
        ios.wait(REVEAL_WINDOW_MS);

        other.focus();
        ios.focusChange();
        ios.pan(0, 200);
        expect(ios.viewport.pageTop).toBe(200);
        expect(ios.scrollTo).not.toHaveBeenCalled();

        ios.wait(REVEAL_WINDOW_MS);
        ios.pan(0, 350);
        expect(ios.viewport.pageTop).toBe(200);
    });

    it("never takes a drag that glides on after the finger lifts for iOS revealing a field", () => {
        const ios = fakeIosWindow();
        stop = installViewportGuard(ios.win, { now: ios.now });
        input.focus();
        ios.openKeyboard(300);
        ios.drag(game, 40);
        ios.pan(0, 250);
        expect(ios.viewport.pageTop).toBe(300);

        // Once the page has settled, iOS may reveal again after a focus change.
        ios.wait(MOMENTUM_MS);
        ios.focusChange();
        ios.pan(0, 250);
        expect(ios.viewport.pageTop).toBe(250);
    });

    it("keeps lists scrolling while the keyboard is up", () => {
        const ios = fakeIosWindow();
        const list = document.createElement("div");
        list.style.overflowY = "auto";
        const row = document.createElement("div");
        list.append(row);
        document.body.append(list);
        Object.defineProperty(list, "scrollHeight", { value: 1000 });
        Object.defineProperty(list, "clientHeight", { value: 300 });
        list.scrollTop = 200;
        stop = installViewportGuard(ios.win, { now: ios.now });
        input.focus();
        ios.openKeyboard(300);

        const move = ios.drag(row, -60);
        expect(move.defaultPrevented).toBe(false);
    });

    it("keeps dragging inside a text field (the caret, its own scroll)", () => {
        const ios = fakeIosWindow();
        stop = installViewportGuard(ios.win, { now: ios.now });
        input.focus();
        ios.openKeyboard(300);
        ios.wait(REVEAL_WINDOW_MS);

        const move = ios.drag(input, 30);
        expect(move.defaultPrevented).toBe(false);
    });

    it("leaves drags alone when the keyboard is closed", () => {
        const ios = fakeIosWindow();
        stop = installViewportGuard(ios.win, { now: ios.now });
        const move = ios.drag(game, 60);
        expect(move.defaultPrevented).toBe(false);
    });

    it("puts the page back when the field loses focus", () => {
        const ios = fakeIosWindow();
        stop = installViewportGuard(ios.win, { now: ios.now });
        input.focus();
        ios.openKeyboard(300);
        ios.closeKeyboard();
        ios.viewport.pageTop = 300;

        input.blur();
        ios.focusChange();
        expect(ios.viewport.pageTop).toBe(0);
    });

    it("undoes a stray page scroll when no field is focused and the keyboard is closed", () => {
        const ios = fakeIosWindow();
        stop = installViewportGuard(ios.win, { now: ios.now });
        ios.pan(40, 120);
        expect(ios.viewport.pageLeft).toBe(0);
        expect(ios.viewport.pageTop).toBe(0);
    });

    it("does nothing when the page never moved (desktop, Android)", () => {
        const ios = fakeIosWindow();
        stop = installViewportGuard(ios.win, { now: ios.now });
        input.focus();
        input.blur();
        ios.focusChange();
        ios.closeKeyboard();
        expect(ios.scrollTo).not.toHaveBeenCalled();
    });

    it("keeps the page from zooming on a pinch, and leaves the pinch to the game", () => {
        const ios = fakeIosWindow();
        stop = installViewportGuard(ios.win, { now: ios.now });
        const { move, gesture } = ios.pinch(game);
        expect(move.defaultPrevented).toBe(true);
        expect(gesture.defaultPrevented).toBe(true);
    });

    it("undoes a page zoom found on load, and says so", () => {
        const meta = document.createElement("meta");
        meta.name = "viewport";
        meta.content = "width=device-width, initial-scale=1.0, maximum-scale=1.0";
        document.head.append(meta);
        const ios = fakeIosWindow({ scale: 1.8 });
        const setContent = vi.spyOn(meta, "setAttribute");
        const onZoomReset = vi.fn();

        stop = installViewportGuard(ios.win, { now: ios.now, onZoomReset });

        expect(onZoomReset).toHaveBeenCalledWith(1.8, "load");
        expect(setContent).toHaveBeenCalledTimes(2);
        expect(meta.content).toBe("width=device-width, initial-scale=1.0, maximum-scale=1.0");
    });

    it("undoes a page zoom when coming back to the app", () => {
        const ios = fakeIosWindow();
        const onZoomReset = vi.fn();
        stop = installViewportGuard(ios.win, { now: ios.now, onZoomReset });
        expect(onZoomReset).not.toHaveBeenCalled();

        ios.viewport.scale = 2;
        ios.fire("pageshow");
        expect(onZoomReset).toHaveBeenCalledWith(2, "pageshow");
    });

    it("does not mistake a zoomed page for an open keyboard", () => {
        const ios = fakeIosWindow({ scale: 1.5 });
        ios.viewport.height = 530;
        stop = installViewportGuard(ios.win, { now: ios.now });
        const move = ios.drag(game, 60);
        expect(move.defaultPrevented).toBe(false);
    });

    it("stops listening once removed", () => {
        const ios = fakeIosWindow();
        installViewportGuard(ios.win, { now: ios.now })();
        ios.pan(0, 200);
        expect(ios.viewport.pageTop).toBe(200);
    });

    it("also resets the root elements' own scroll", () => {
        const ios = fakeIosWindow();
        document.body.scrollLeft = 30;
        resetPagePosition(ios.win);
        expect(document.body.scrollLeft).toBe(0);
    });
});
