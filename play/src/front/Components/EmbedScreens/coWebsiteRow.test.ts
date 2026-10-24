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

    it("keeps the title other sites always had", () => {
        expect(siteNameOf("https://www.example.com/page")).toBe("Example");
        expect(siteNameOf("https://docs.google.com/document/d/1")).toBe("Docs");
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
