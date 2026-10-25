import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWebPreview = vi.fn();
const openChatLinkHere = vi.fn();
vi.mock("../LinkPreviewFetcher", () => ({ fetchWebPreview: (url: string) => fetchWebPreview(url) }));
vi.mock("../openChatLinkHere", () => ({ openChatLinkHere: (url: string) => openChatLinkHere(url) }));

import { rememberEmbeddable } from "../EmbeddableLinks";
import { isProfileLinkList, openProfileLinkHere, profileLinksOpeningHere } from "../ProfileLinks";

const ABOUT = "https://mishari.example/about";
const LINKEDIN = "https://www.linkedin.com/in/mishari";

describe("profile links", () => {
    beforeEach(() => {
        fetchWebPreview.mockReset();
        openChatLinkHere.mockReset();
        // The real fetcher remembers the server's answer as it comes back.
        fetchWebPreview.mockImplementation((url: string) => {
            const preview = { url, embeddable: url === ABOUT };
            rememberEmbeddable(url, preview);
            return Promise.resolve(preview);
        });
    });

    it("says which links open in the window, checking each page as a chat link is checked", async () => {
        await expect(profileLinksOpeningHere([ABOUT, LINKEDIN, ABOUT])).resolves.toEqual([ABOUT]);
        expect(fetchWebPreview).toHaveBeenCalledTimes(2);
    });

    it("never checks an http link or something that isn't an address", async () => {
        await expect(profileLinksOpeningHere(["http://mishari.example", "not a link"])).resolves.toEqual([]);
        expect(fetchWebPreview).not.toHaveBeenCalled();
    });

    it("leaves out a link whose preview couldn't load", async () => {
        fetchWebPreview.mockResolvedValue(undefined);
        await expect(profileLinksOpeningHere(["https://offline.example/"])).resolves.toEqual([]);
    });

    it("opens only a link that was checked and may be shown", async () => {
        await profileLinksOpeningHere([ABOUT, LINKEDIN]);
        expect(openProfileLinkHere(LINKEDIN)).toBe(false);
        expect(openProfileLinkHere("https://never-checked.example/")).toBe(false);
        expect(openChatLinkHere).not.toHaveBeenCalled();

        expect(openProfileLinkHere(ABOUT)).toBe(true);
        expect(openChatLinkHere).toHaveBeenCalledWith(ABOUT);
    });

    it("accepts a list of 1 to 10 addresses", () => {
        expect(isProfileLinkList([ABOUT])).toBe(true);
        expect(isProfileLinkList([])).toBe(false);
        expect(isProfileLinkList(Array(11).fill(ABOUT))).toBe(false);
        expect(isProfileLinkList([ABOUT, 3])).toBe(false);
        expect(isProfileLinkList(ABOUT)).toBe(false);
    });
});
