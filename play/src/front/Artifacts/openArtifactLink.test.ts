import { get, writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    lowerChatSheet: vi.fn(),
    bringOpenHereInFront: vi.fn(),
}));

vi.mock("../Enum/EnvironmentVariable", () => ({ ADMIN_URL: "https://orbit.example" }));
vi.mock("./ArtifactApi", () => ({ fetchArtifact: vi.fn(), ArtifactRequestError: class {} }));
vi.mock("../Chat/ChatSheetStore", () => ({ lowerChatSheet: mocks.lowerChatSheet }));
vi.mock("../Stores/SideWindowInFrontStore", () => ({ bringOpenHereInFront: mocks.bringOpenHereInFront }));
vi.mock("../WebRtc/CoWebsite/ArtifactCoWebsite", () => ({
    ArtifactCoWebsite: class {
        version: ReturnType<typeof writable<number | undefined>>;
        constructor(public artifactId: string, public chat: unknown, public summary: unknown, version?: number) {
            this.version = writable(version);
        }
    },
}));
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
import { ArtifactCoWebsite } from "../WebRtc/CoWebsite/ArtifactCoWebsite";
import { openArtifactLink } from "./openArtifactLink";

const ID = "308f73c8-82a2-471d-9779-37068185d559";
const LINK = `https://orbit.example/a/${ID}`;
const items = coWebsites as unknown as { add(item: object): void; empty(): void };

describe("an object's link to an artifact (#1737)", () => {
    beforeEach(() => {
        items.empty();
        vi.clearAllMocks();
    });

    it("opens the artifact window at once, at the latest version, with the object's label until it loads", () => {
        expect(openArtifactLink(LINK, "View Artifact")).toBe(true);
        const open = get(coWebsites);
        expect(open).toHaveLength(1);
        expect(open[0]).toBeInstanceOf(ArtifactCoWebsite);
        const window = open[0] as unknown as ArtifactCoWebsite & { summary: unknown };
        expect(window.artifactId).toBe(ID);
        expect(window.chat).toBeUndefined();
        expect(window.summary).toEqual({ title: "View Artifact", kind: undefined, makerName: undefined });
        expect(get(window.version)).toBeUndefined();
        expect(mocks.lowerChatSheet).toHaveBeenCalledTimes(1);
    });

    it("brings its open window back to the front instead of opening a second", () => {
        openArtifactLink(LINK, "View Artifact");
        const first = get(coWebsites)[0];
        const other = {};
        items.add(other);
        openArtifactLink(LINK, "View Artifact");
        expect(get(coWebsites)).toEqual([other, first]);
        expect(mocks.bringOpenHereInFront).toHaveBeenCalledTimes(1);
    });

    it("leaves the version an open window shows as it is", () => {
        openArtifactLink(LINK, "View Artifact");
        const window = get(coWebsites)[0] as unknown as ArtifactCoWebsite;
        window.version.set(2);
        openArtifactLink(LINK, "View Artifact");
        expect(get(window.version)).toBe(2);
    });

    it("leaves every other link alone, look-alikes included", () => {
        expect(openArtifactLink("https://example.com/page", "x")).toBe(false);
        expect(openArtifactLink(`https://orbit.example.evil.com/a/${ID}`, "x")).toBe(false);
        expect(openArtifactLink(`https://orbit.example/admin/a/${ID}`, "x")).toBe(false);
        expect(get(coWebsites)).toHaveLength(0);
    });
});
