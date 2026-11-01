import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ArtifactLinkCard from "./artifactLinkCard";

const mocks = vi.hoisted(() => ({
    refresh: vi.fn(),
    openFromCard: vi.fn(),
}));

vi.mock("../Enum/EnvironmentVariable", () => ({ ADMIN_URL: "https://orbit.example" }));
vi.mock("./ArtifactApi", () => ({ fetchArtifact: vi.fn(), ArtifactRequestError: class {} }));
vi.mock("./openArtifact", () => ({ openArtifactFromCard: mocks.openFromCard }));
vi.mock("./artifactLinkCard", async (original) => ({
    ...(await original<typeof ArtifactLinkCard>()),
    refreshLinkedArtifactCard: mocks.refresh,
}));

import { openArtifactLink } from "./openArtifactLink";

const ID = "308f73c8-82a2-471d-9779-37068185d559";
const LINK = `https://orbit.example/a/${ID}`;
const CARD = { id: ID, version: 3, title: "Arcade", kind: "page", maker: "Imagine" };

const settle = () =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });

describe("an object's link to an artifact (#1737)", () => {
    beforeEach(() => vi.clearAllMocks());

    it("opens the artifact window when this person may open it", async () => {
        mocks.refresh.mockResolvedValue(CARD);
        const openTab = vi.fn();
        expect(openArtifactLink(LINK, openTab)).toBe(true);
        await settle();
        expect(mocks.refresh).toHaveBeenCalledWith(ID, undefined);
        expect(mocks.openFromCard).toHaveBeenCalledWith(CARD, undefined);
        expect(openTab).not.toHaveBeenCalled();
    });

    it("opens the link in a new tab when this person may not open it from here", async () => {
        mocks.refresh.mockResolvedValue(undefined);
        const openTab = vi.fn();
        expect(openArtifactLink(LINK, openTab)).toBe(true);
        await settle();
        expect(mocks.openFromCard).not.toHaveBeenCalled();
        expect(openTab).toHaveBeenCalledWith(LINK);
    });

    it("leaves every other link alone, look-alikes included", () => {
        const openTab = vi.fn();
        expect(openArtifactLink("https://example.com/page", openTab)).toBe(false);
        expect(openArtifactLink(`https://orbit.example.evil.com/a/${ID}`, openTab)).toBe(false);
        expect(openArtifactLink(`https://orbit.example/admin/a/${ID}`, openTab)).toBe(false);
        expect(mocks.refresh).not.toHaveBeenCalled();
        expect(openTab).not.toHaveBeenCalled();
    });
});
