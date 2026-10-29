import { get, writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    refresh: vi.fn(() => Promise.resolve()),
    lowerChatSheet: vi.fn(),
    bringOpenHereInFront: vi.fn(),
}));

vi.mock("../Chat/ChatSheetStore", () => ({ lowerChatSheet: mocks.lowerChatSheet }));
vi.mock("../Stores/SideWindowInFrontStore", () => ({ bringOpenHereInFront: mocks.bringOpenHereInFront }));
vi.mock("./chatArtifactsList", () => ({ yourArtifactsList: () => ({ refresh: mocks.refresh }) }));
vi.mock("../WebRtc/CoWebsite/YourArtifactsCoWebsite", () => ({ YourArtifactsCoWebsite: class {} }));
vi.mock("../Stores/CoWebsiteStore", () => {
    const items = writable<object[]>([]);
    return {
        coWebsites: {
            subscribe: items.subscribe,
            add: (item: object) => items.update((all) => [...all, item]),
            remove: (item: object) => items.update((all) => all.filter((one) => one !== item)),
            empty: () => items.set([]),
        },
        openedByPersonCoWebsite: <T>(item: T) => item,
    };
});

import { coWebsites } from "../Stores/CoWebsiteStore";
import { YourArtifactsCoWebsite } from "../WebRtc/CoWebsite/YourArtifactsCoWebsite";
import { openYourArtifacts } from "./openYourArtifacts";

const items = coWebsites as unknown as { add(item: object): void; empty(): void };

describe("opening Your artifacts (#1609)", () => {
    beforeEach(() => {
        items.empty();
        vi.clearAllMocks();
    });

    it("opens it once in the window, read again from the top, with the chat sheet lowered", () => {
        openYourArtifacts();
        const open = get(coWebsites);
        expect(open).toHaveLength(1);
        expect(open[0]).toBeInstanceOf(YourArtifactsCoWebsite);
        expect(mocks.refresh).toHaveBeenCalledTimes(1);
        expect(mocks.lowerChatSheet).toHaveBeenCalledTimes(1);
    });

    it("brings the open one back to the front instead of opening a second", () => {
        openYourArtifacts();
        const list = get(coWebsites)[0];
        const artifact = {};
        items.add(artifact);
        openYourArtifacts();
        expect(get(coWebsites)).toEqual([artifact, list]);
        expect(mocks.bringOpenHereInFront).toHaveBeenCalledTimes(1);
        expect(mocks.refresh).toHaveBeenCalledTimes(2);
    });
});
