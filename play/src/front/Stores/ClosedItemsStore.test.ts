import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { CoWebsite } from "../WebRtc/CoWebsite/CoWebsite";
import {
    closedItemsStore,
    closeAllOpenItems,
    dismissClosedItems,
    pickedAfterUndoStore,
    undoClosedItems,
    CLOSED_ITEMS_UNDO_MS,
} from "./ClosedItemsStore";
import { activeCoWebsiteStore, coWebsites, fullScreenCowebsite } from "./CoWebsiteStore";

vi.mock("../Administration/AnalyticsClient", () => ({
    analyticsClient: { closeCowebsite: vi.fn() },
}));

function item(id: string, closable = true): CoWebsite {
    return {
        getId: () => id,
        getUrl: () => new URL("about:blank"),
        getIframe: () => undefined,
        getLoadIframe: () => undefined,
        getWidthPercent: () => undefined,
        isClosable: () => closable,
        getHideUrl: () => false,
    };
}

const ids = () => get(coWebsites).map((c) => c.getId());

describe("closing several items at once", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        coWebsites.removeAll();
        dismissClosedItems();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("can be undone, each item back where it was", () => {
        const [a, b, c] = [item("a"), item("b"), item("c")];
        [a, b, c].forEach((i) => coWebsites.add(i));

        closeAllOpenItems();
        expect(ids()).toEqual([]);
        expect(get(closedItemsStore)?.closed).toHaveLength(3);

        undoClosedItems();
        expect(ids()).toEqual(["a", "b", "c"]);
        expect(get(closedItemsStore)).toBeUndefined();
    });

    it("brings the window back full screen when it was", () => {
        [item("a"), item("b")].forEach((i) => coWebsites.add(i));
        fullScreenCowebsite.set(true);

        closeAllOpenItems();
        expect(get(fullScreenCowebsite)).toBe(false);

        undoClosedItems();
        expect(get(fullScreenCowebsite)).toBe(true);
        fullScreenCowebsite.set(false);
    });

    it("does not bring back an item that something asked to remove meanwhile", () => {
        const [a, b, c] = [item("a"), item("b"), item("c")];
        [a, b, c].forEach((i) => coWebsites.add(i));

        closeAllOpenItems();
        coWebsites.remove(b);
        expect(get(closedItemsStore)?.closed.map((i) => i.getId())).toEqual(["a", "c"]);

        undoClosedItems();
        expect(ids()).toEqual(["a", "c"]);
    });

    it("changes nothing when only pages that may not be closed are open", () => {
        const [a, b, kept] = [item("a"), item("b"), item("kept", false)];
        [a, b].forEach((i) => coWebsites.add(i));
        closeAllOpenItems();
        expect(get(closedItemsStore)).toBeDefined();
        coWebsites.removeAll();
        coWebsites.add(kept);
        fullScreenCowebsite.set(true);

        closeAllOpenItems();
        expect(ids()).toEqual(["kept"]);
        expect(get(fullScreenCowebsite)).toBe(true);
        fullScreenCowebsite.set(false);
    });

    it("offers no Undo once what is left to bring back is a single item", () => {
        const [a, b] = [item("a"), item("b")];
        [a, b].forEach((i) => coWebsites.add(i));

        closeAllOpenItems();
        coWebsites.keepOnly((coWebsite) => coWebsite.getId() !== "a");
        expect(get(closedItemsStore)).toBeUndefined();
    });

    it("offers no Undo after a map script closed everything", () => {
        [item("a"), item("b")].forEach((i) => coWebsites.add(i));

        closeAllOpenItems();
        coWebsites.removeAll();
        expect(get(closedItemsStore)).toBeUndefined();
    });

    it("keeps a page that may not be closed, and counts only what it closed", () => {
        const kept = item("kept", false);
        [item("a"), kept, item("b")].forEach((i) => coWebsites.add(i));

        closeAllOpenItems();
        expect(ids()).toEqual(["kept"]);
        expect(get(closedItemsStore)?.closed.map((i) => i.getId())).toEqual(["a", "b"]);

        undoClosedItems();
        expect(ids()).toEqual(["a", "kept", "b"]);
    });

    it("leaves what was opened since after the restored items, when the store is asked to restore", () => {
        const [a, b] = [item("a"), item("b")];
        [a, b].forEach((i) => coWebsites.add(i));
        coWebsites.removeAll();
        coWebsites.add(item("new"));

        coWebsites.restore([a, b], [a, b]);
        expect(ids()).toEqual(["a", "b", "new"]);
    });

    it("goes away by itself after a few seconds", () => {
        [item("a"), item("b")].forEach((i) => coWebsites.add(i));
        closeAllOpenItems();
        expect(get(closedItemsStore)).toBeDefined();

        vi.advanceTimersByTime(CLOSED_ITEMS_UNDO_MS + 1);
        expect(get(closedItemsStore)).toBeUndefined();

        undoClosedItems();
        expect(ids()).toEqual([]);
    });

    it("asks for no undo when only one item closes", () => {
        coWebsites.add(item("a"));
        closeAllOpenItems();
        expect(ids()).toEqual([]);
        expect(get(closedItemsStore)).toBeUndefined();
    });
    it("hands the window the item that was picked, to pick again", () => {
        const [a, b, c] = [item("a"), item("b"), item("c")];
        [a, b, c].forEach((i) => coWebsites.add(i));
        activeCoWebsiteStore.set(a);

        closeAllOpenItems();
        undoClosedItems();

        expect(get(pickedAfterUndoStore)).toBe(a);
        pickedAfterUndoStore.set(undefined);
    });

    it("is not offered any more once something else opened", () => {
        [item("a"), item("b")].forEach((i) => coWebsites.add(i));

        closeAllOpenItems();
        expect(get(closedItemsStore)).toBeDefined();

        coWebsites.add(item("meeting"));
        expect(get(closedItemsStore)).toBeUndefined();
        expect(ids()).toEqual(["meeting"]);
    });
});
