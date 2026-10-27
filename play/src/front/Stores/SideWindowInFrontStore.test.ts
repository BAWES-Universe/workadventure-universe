import { describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { modalIframeStore, modalVisibilityStore } from "./ModalStore";
import { bringOpenHereInFront, sideWindowInFrontStore } from "./SideWindowInFrontStore";

describe("sideWindowInFrontStore", () => {
    it("puts Orbit in front when it opens, and the Open here window when something opens in it", () => {
        expect(get(sideWindowInFrontStore)).toBe("openHere");

        modalVisibilityStore.set(true);
        expect(get(sideWindowInFrontStore)).toBe("orbit");

        bringOpenHereInFront();
        expect(get(sideWindowInFrontStore)).toBe("openHere");

        // Orbit stays open behind: nothing about it changes until it is tapped or opened again.
        expect(get(modalVisibilityStore)).toBe(true);
    });

    it("leaves the order alone when Orbit closes", () => {
        bringOpenHereInFront();
        modalVisibilityStore.set(false);
        modalVisibilityStore.set(true);
        modalVisibilityStore.set(false);
        expect(get(sideWindowInFrontStore)).toBe("orbit");
    });

    it("puts Orbit in front when a script opens the modal again while it shows", () => {
        modalVisibilityStore.set(true);
        bringOpenHereInFront();

        // The visibility does not change, but the modal is asked for again.
        modalIframeStore.set({ src: "https://example.com", title: "Orbit", position: "right" } as never);
        modalVisibilityStore.set(true);
        expect(get(sideWindowInFrontStore)).toBe("orbit");
    });
});
