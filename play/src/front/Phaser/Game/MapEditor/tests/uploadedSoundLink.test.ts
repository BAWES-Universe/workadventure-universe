import { describe, expect, it, vi } from "vitest";
import { isUploadedSoundLink, playableSoundLink, uploadedSoundLink } from "../uploadedSoundLink";

const mapStorageUrl = new URL("https://map-storage.example.com/");

describe("uploaded sound links (#1626)", () => {
    it("stores a sound at the map-storage root, named after the file and the property", () => {
        expect(uploadedSoundLink(mapStorageUrl, "Rain at night.mp3", "a1b2")).toBe(
            "https://map-storage.example.com/private/sounds/Rain%20at%20night-a1b2.mp3"
        );
    });

    it("keeps a #, ? or % in the file name as part of the path", () => {
        const link = uploadedSoundLink(mapStorageUrl, "Track #1? 100%.mp3", "a1b2");
        expect(link).toBe("https://map-storage.example.com/private/sounds/Track%20%231%3F%20100%25-a1b2.mp3");
        const url = new URL(link);
        expect(url.hash).toBe("");
        expect(url.search).toBe("");
        expect(decodeURIComponent(url.pathname)).toBe("/private/sounds/Track #1? 100%-a1b2.mp3");
        expect(isUploadedSoundLink(link, mapStorageUrl)).toBe(true);
    });

    it("tells an uploaded sound from a pasted link", () => {
        expect(isUploadedSoundLink("https://map-storage.example.com/private/sounds/rain-a1b2.mp3", mapStorageUrl)).toBe(
            true
        );
        expect(isUploadedSoundLink("https://example.com/private/sounds/rain.mp3", mapStorageUrl)).toBe(false);
        expect(isUploadedSoundLink("https://map-storage.example.com/private/files/notes.pdf", mapStorageUrl)).toBe(
            false
        );
        expect(isUploadedSoundLink("rain.mp3", mapStorageUrl)).toBe(false);
        expect(isUploadedSoundLink("https://map-storage.example.com/private/sounds/a.mp3", undefined)).toBe(false);
    });

    it("adds the map's access token to an uploaded sound only", async () => {
        const queryToken = vi.fn(() => Promise.resolve({ jwt: "abc" }));
        await expect(
            playableSoundLink("https://map-storage.example.com/private/sounds/rain-a1b2.mp3", mapStorageUrl, queryToken)
        ).resolves.toBe("https://map-storage.example.com/private/sounds/rain-a1b2.mp3?token=abc");
        await expect(playableSoundLink("https://example.com/birds.mp3", mapStorageUrl, queryToken)).resolves.toBe(
            "https://example.com/birds.mp3"
        );
        expect(queryToken).toHaveBeenCalledTimes(1);
    });
});
