import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_PRESS_MS, longpress } from "../longpress";

function pointer(type: string, init: { pointerType?: string; clientX?: number; clientY?: number } = {}) {
    const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: init.clientX,
        clientY: init.clientY,
    });
    Object.defineProperty(event, "pointerType", { value: init.pointerType ?? "touch" });
    return event;
}

describe("longpress", () => {
    let node: HTMLButtonElement;
    let onLongPress: ReturnType<typeof vi.fn>;
    let onClick: ReturnType<typeof vi.fn>;
    let action: ReturnType<typeof longpress>;

    beforeEach(() => {
        vi.useFakeTimers();
        node = document.createElement("button");
        document.body.appendChild(node);
        onLongPress = vi.fn();
        onClick = vi.fn();
        node.addEventListener("click", onClick);
        action = longpress(node, onLongPress);
    });

    afterEach(() => {
        node.removeEventListener("click", onClick);
        action?.destroy?.();
        node.remove();
        vi.useRealTimers();
    });

    it("fires after a 500ms touch hold and swallows the click that follows", () => {
        node.dispatchEvent(pointer("pointerdown"));
        vi.advanceTimersByTime(LONG_PRESS_MS - 1);
        expect(onLongPress).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onLongPress).toHaveBeenCalledOnce();

        node.dispatchEvent(pointer("pointerup"));
        node.click();
        expect(onClick).not.toHaveBeenCalled();

        // The next ordinary tap works again.
        node.dispatchEvent(pointer("pointerdown"));
        node.dispatchEvent(pointer("pointerup"));
        node.click();
        expect(onClick).toHaveBeenCalledOnce();
    });

    it("a short tap is a normal click", () => {
        node.dispatchEvent(pointer("pointerdown"));
        vi.advanceTimersByTime(200);
        node.dispatchEvent(pointer("pointerup"));
        node.click();
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(onLongPress).not.toHaveBeenCalled();
        expect(onClick).toHaveBeenCalledOnce();
    });

    it("is cancelled by moving the finger", () => {
        node.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
        node.dispatchEvent(pointer("pointermove", { clientX: 0, clientY: 30 }));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(onLongPress).not.toHaveBeenCalled();
    });

    it("tolerates a small wobble", () => {
        node.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
        node.dispatchEvent(pointer("pointermove", { clientX: 3, clientY: 4 }));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(onLongPress).toHaveBeenCalledOnce();
    });

    it("is cancelled by pointercancel and by unmounting", () => {
        node.dispatchEvent(pointer("pointerdown"));
        node.dispatchEvent(pointer("pointercancel"));
        vi.advanceTimersByTime(LONG_PRESS_MS);

        node.dispatchEvent(pointer("pointerdown"));
        action?.destroy?.();
        action = undefined;
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(onLongPress).not.toHaveBeenCalled();
    });

    it("does not start a timer for a mouse; right-click fires instead", () => {
        node.dispatchEvent(pointer("pointerdown", { pointerType: "mouse" }));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(onLongPress).not.toHaveBeenCalled();

        const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        node.dispatchEvent(contextMenu);
        expect(contextMenu.defaultPrevented).toBe(true);
        expect(onLongPress).toHaveBeenCalledOnce();
    });

    it("fires only once when the browser's own long-press menu follows", () => {
        node.dispatchEvent(pointer("pointerdown"));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        expect(onLongPress).toHaveBeenCalledOnce();
    });
});
