import { afterEach, describe, expect, it, vi } from "vitest";
import { keepFocusInside } from "../keepFocusInside";

describe("a dialog keeps the keyboard inside it", () => {
    let host: HTMLElement;
    afterEach(() => host.remove());

    function dialog(html: string) {
        host = document.createElement("div");
        host.innerHTML = html;
        document.body.appendChild(host);
        return host.firstElementChild as HTMLElement;
    }

    it("never stops on a disabled field: Tab goes round without it, and the first focus is not on it", () => {
        const node = dialog(
            '<div><input id="off" disabled /><input id="a" /><button id="b">B</button><input id="c" disabled /></div>'
        );
        const action = keepFocusInside(node, vi.fn());
        expect(document.activeElement?.id).toBe("a");
        // Tab from the last real stop goes back to the first, not to a disabled field
        host.querySelector<HTMLElement>("#b")?.focus();
        const tab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
        document.dispatchEvent(tab);
        expect(tab.defaultPrevented).toBe(true);
        expect(document.activeElement?.id).toBe("a");
        // Shift+Tab from the first goes to the last real stop
        const back = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true });
        document.dispatchEvent(back);
        expect(document.activeElement?.id).toBe("b");
        action?.destroy?.();
    });
});
