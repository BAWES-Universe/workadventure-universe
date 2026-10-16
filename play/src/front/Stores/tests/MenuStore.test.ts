import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
});
vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));

import { closeMenuOfHiddenBarItem, openedMenuStore } from "../MenuStore";

describe("closeMenuOfHiddenBarItem", () => {
    beforeEach(() => {
        openedMenuStore.closeAll();
    });

    it("closes the Tools menu when the Tools button leaves the bar", () => {
        openedMenuStore.open("mapMenu");
        closeMenuOfHiddenBarItem("maps");
        expect(get(openedMenuStore)).toBeUndefined();
    });

    it("leaves another open menu alone", () => {
        openedMenuStore.open("profileMenu");
        closeMenuOfHiddenBarItem("maps");
        expect(get(openedMenuStore)).toBe("profileMenu");
    });

    it("ignores a button that opens no menu of its own", () => {
        openedMenuStore.open("mapMenu");
        closeMenuOfHiddenBarItem("orbit");
        expect(get(openedMenuStore)).toBe("mapMenu");
    });
});
