import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));

import type { CoWebsite } from "../../WebRtc/CoWebsite/CoWebsite";
import { coWebsiteIconBackground, coWebsiteIconUrl, coWebsiteSiteName } from "./coWebsiteRow";

const coWebsiteOf = (url: string) => ({ getUrl: () => new URL(url) } as unknown as CoWebsite);
const siteNameOf = (url: string) => coWebsiteSiteName(coWebsiteOf(url));

describe("coWebsiteSiteName", () => {
    it("says YouTube for every address a YouTube video plays from", () => {
        expect(siteNameOf("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1")).toBe("YouTube");
        expect(siteNameOf("https://youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe("YouTube");
        expect(siteNameOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("YouTube");
        expect(siteNameOf("https://youtu.be/dQw4w9WgXcQ")).toBe("YouTube");
    });

    it("names a site, not the part of it that is open", () => {
        expect(siteNameOf("https://en.wikipedia.org/wiki/Universe")).toBe("Wikipedia");
        expect(siteNameOf("https://www.example.com/page")).toBe("Example");
        expect(siteNameOf("https://docs.google.com/document/d/1")).toBe("Google");
        expect(siteNameOf("https://a.b.shop.example.com/x")).toBe("Example");
    });

    it("looks past a country ending", () => {
        expect(siteNameOf("https://www.bbc.co.uk/news")).toBe("Bbc");
        expect(siteNameOf("https://news.bbc.co.uk/")).toBe("Bbc");
        expect(siteNameOf("https://www.example.com.au/")).toBe("Example");
        expect(siteNameOf("https://example.co/")).toBe("Example");
    });

    it("shows an address with no name in it as it is", () => {
        expect(siteNameOf("http://localhost:8080/page")).toBe("Localhost");
        expect(siteNameOf("http://192.168.1.20/page")).toBe("192.168.1.20");
    });
});

describe("coWebsiteIconUrl", () => {
    it("uses the YouTube icon for YouTube and the icon service for other sites", () => {
        const youtube = coWebsiteOf("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
        expect(coWebsiteIconUrl(youtube)).not.toContain("/icon?url=");
        expect(coWebsiteIconBackground(youtube)).toBe("transparent");

        const other = coWebsiteOf("https://www.example.com/page");
        expect(coWebsiteIconUrl(other)).toContain("/icon?url=");
        expect(coWebsiteIconBackground(other)).toBeUndefined();
    });
});
