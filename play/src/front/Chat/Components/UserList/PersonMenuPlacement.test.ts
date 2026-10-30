import { beforeEach, describe, expect, it, vi } from "vitest";

const computePosition = vi.fn();
vi.mock("@floating-ui/dom", () => ({
    computePosition: (...args: unknown[]) => computePosition(...args),
    flip: () => ({}),
    offset: () => ({}),
    shift: () => ({}),
    platform: { getElementRects: () => undefined, getOffsetParent: () => undefined },
}));

import { placePersonMenu } from "./PersonMenuPlacement";

/** A menu whose measured box is wherever the browser put it: `fixed` counted from `origin` (the screen, or the sheet). */
function menuFixedTo(origin: { left: number; top: number }): HTMLDivElement {
    const menu = document.createElement("div");
    menu.getBoundingClientRect = () =>
        ({
            left: origin.left + parseFloat(menu.style.left || "0"),
            top: origin.top + parseFloat(menu.style.top || "0"),
        } as DOMRect);
    return menu;
}

async function place(menu: HTMLElement) {
    placePersonMenu(document.createElement("button"), menu);
    await new Promise((resolve) => {
        setTimeout(resolve);
    });
}

describe("placePersonMenu", () => {
    beforeEach(() => {
        computePosition.mockReset();
        computePosition.mockResolvedValue({ x: 220, y: 522 });
    });

    it("asks floating-ui for screen coordinates, whatever the menu is fixed to", async () => {
        await place(menuFixedTo({ left: 0, top: 0 }));
        const { platform } = computePosition.mock.calls[0][2];
        expect(platform.getOffsetParent()).toBe(window);
    });

    it("leaves the menu where floating-ui put it when fixed counts from the screen", async () => {
        const menu = menuFixedTo({ left: 0, top: 0 });
        await place(menu);
        expect(menu.style.left).toBe("220px");
        expect(menu.style.top).toBe("522px");
    });

    it("moves it back onto the button when fixed counts from the phone sheet below the top of the screen", async () => {
        const menu = menuFixedTo({ left: 0, top: 352 });
        await place(menu);
        expect(menu.style.left).toBe("220px");
        expect(menu.style.top).toBe("170px");
        expect(menu.getBoundingClientRect().top).toBe(522);
    });

    it("moves it back sideways too", async () => {
        const menu = menuFixedTo({ left: 16, top: 352 });
        await place(menu);
        expect(menu.getBoundingClientRect().left).toBe(220);
        expect(menu.getBoundingClientRect().top).toBe(522);
    });
});
