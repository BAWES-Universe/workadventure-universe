import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { CoWebsite } from "../WebRtc/CoWebsite/CoWebsite";
import { coWebsiteManager, coWebsites, openedByPersonCoWebsite } from "./CoWebsiteStore";

function item(id: string): CoWebsite {
    return {
        getId: () => id,
        getUrl: () => new URL(`https://example.com/${id}`),
        getIframe: () => undefined,
        getLoadIframe: () => undefined,
        getWidthPercent: () => undefined,
        isClosable: () => true,
        getHideUrl: () => false,
    };
}

describe("what stays open when the game reconnects", () => {
    afterEach(() => {
        coWebsites.removeAll();
    });

    it("keeps what the person opened, in order, and closes the map's own pages", () => {
        const file = openedByPersonCoWebsite(item("file"));
        const mapPage = item("zone");
        const link = openedByPersonCoWebsite(item("link"));
        [file, mapPage, link].forEach((coWebsite) => coWebsites.add(coWebsite));

        coWebsiteManager.cleanup(true);

        expect(get(coWebsites)).toEqual([file, link]);
    });

    it("tells those who wait for removals that the map's pages went, and only those", () => {
        const file = openedByPersonCoWebsite(item("file"));
        const mapPage = item("zone");
        [file, mapPage].forEach((coWebsite) => coWebsites.add(coWebsite));
        const listener = vi.fn();
        const stop = coWebsites.onRemoval(listener);

        coWebsiteManager.cleanup(true);
        stop();

        expect(listener).toHaveBeenCalledTimes(1);
        const removes = listener.mock.calls[0][0] as (coWebsite: CoWebsite) => boolean;
        expect(removes(mapPage)).toBe(true);
        expect(removes(file)).toBe(false);
    });

    it("closes everything for a map change or leaving the room", () => {
        coWebsites.add(openedByPersonCoWebsite(item("file")));
        coWebsites.add(item("zone"));

        coWebsiteManager.cleanup();

        expect(get(coWebsites)).toEqual([]);
    });
});
