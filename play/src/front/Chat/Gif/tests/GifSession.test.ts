import { describe, expect, it } from "vitest";
import type { KlipyClient } from "../KlipyClient";
import { GIF_HOME_TTL_MS, gifSessionOf, holdGifPicture, markGifSessionLoaded } from "../GifSession";

function client(): KlipyClient {
    return {
        search: () => Promise.reject(new Error("no")),
        trending: () => Promise.reject(new Error("no")),
        categories: () => Promise.reject(new Error("no")),
    };
}

describe("GifSession", () => {
    it("keeps what the first screen learnt for five minutes", () => {
        const klipy = client();
        const session = gifSessionOf(klipy, 1000);
        session.categories = [{ name: "lol", query: "lol" }];
        session.trendingPreview = "https://static.klipy.com/t.webp";
        markGifSessionLoaded(session, 1000);
        holdGifPicture(session, "https://static.klipy.com/t.webp");

        const later = gifSessionOf(klipy, 1000 + GIF_HOME_TTL_MS - 1);
        expect(later).toBe(session);
        expect(later.categories).toHaveLength(1);
        expect(later.trendingPreview).toBe("https://static.klipy.com/t.webp");
        expect(later.pictures?.size).toBe(1);
    });

    it("forgets it all after five minutes, so the next opening asks Klipy again", () => {
        const klipy = client();
        const session = gifSessionOf(klipy, 1000);
        session.categories = [{ name: "lol", query: "lol" }];
        session.trendingPreview = "https://static.klipy.com/t.webp";
        markGifSessionLoaded(session, 1000);
        holdGifPicture(session, "https://static.klipy.com/t.webp");

        const expired = gifSessionOf(klipy, 1000 + GIF_HOME_TTL_MS);
        expect(expired.categories).toBeUndefined();
        expect(expired.trendingPreview).toBeUndefined();
        expect(expired.pictures).toBeUndefined();
        expect(expired.loadedAt).toBeUndefined();
    });

    it("counts the five minutes from the first thing kept, not from every opening", () => {
        const session = gifSessionOf(client(), 0);
        markGifSessionLoaded(session, 100);
        markGifSessionLoaded(session, 200);
        expect(session.loadedAt).toBe(100);
    });

    it("holds each picture once", () => {
        const session = gifSessionOf(client());
        holdGifPicture(session, "https://static.klipy.com/a.webp");
        holdGifPicture(session, "https://static.klipy.com/a.webp");
        holdGifPicture(session, undefined);
        expect(session.pictures?.size).toBe(1);
        expect(session.pictures?.get("https://static.klipy.com/a.webp")?.src).toBe("https://static.klipy.com/a.webp");
    });
});
