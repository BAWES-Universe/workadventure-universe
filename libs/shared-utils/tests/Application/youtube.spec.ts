import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    getCanonicalYoutubeUrl,
    getYoutubeEmbedUrl,
    getYoutubeStartSeconds,
    getYoutubeVideoId,
    isEmbeddableYoutubeLink,
    isYoutubeLink,
} from "../../src/Application/YoutubeService";

const { axiosGet } = vi.hoisted(() => ({ axiosGet: vi.fn() }));

vi.mock("axios", () => ({
    default: { get: axiosGet },
}));

const ID = "IsnXdZtuhIk";
const WATCH = `https://www.youtube.com/watch?v=${ID}`;

describe("isYoutubeLink", () => {
    it.each([
        `https://youtu.be/${ID}?si=AH1cTE3qDf`,
        `https://youtu.be/${ID}?t=42`,
        `https://www.youtube.com/watch?v=${ID}&si=abc&t=1m30s&feature=shared&list=PL123`,
        `https://youtube.com/watch?v=${ID}`,
        `https://m.youtube.com/watch?v=${ID}`,
        `https://music.youtube.com/watch?v=${ID}`,
        `https://www.youtube.com/shorts/${ID}`,
        `https://www.youtube.com/live/${ID}`,
        `https://www.youtube.com/embed/${ID}`,
        `https://www.youtube-nocookie.com/embed/${ID}`,
        `https://youtube-nocookie.com/embed/${ID}`,
        "https://www.youtube.com/playlist?list=PL123",
    ])("is true for %s", (link) => {
        expect(isYoutubeLink(new URL(link))).toBe(true);
    });

    it.each([
        "https://example.com/youtube",
        "https://example.com/watch?v=youtube",
        "https://example.com/?url=https://www.youtube.com/watch?v=IsnXdZtuhIk",
        "https://example.com/youtu.be/IsnXdZtuhIk",
        "https://notyoutube.com/watch?v=IsnXdZtuhIk",
        "https://youtube.com.evil.example/watch?v=IsnXdZtuhIk",
        "https://youtu.be.evil.example/IsnXdZtuhIk",
        "https://www.youtube-nocookie.com.evil.example/embed/IsnXdZtuhIk",
        "https://youtube.example.com/watch?v=IsnXdZtuhIk",
    ])("is false for %s", (link) => {
        expect(isYoutubeLink(new URL(link))).toBe(false);
    });
});

describe("isEmbeddableYoutubeLink", () => {
    it.each([`https://www.youtube.com/embed/${ID}`, `https://www.youtube-nocookie.com/embed/${ID}?start=3`])(
        "is true for %s",
        (link) => {
            expect(isEmbeddableYoutubeLink(new URL(link))).toBe(true);
        }
    );

    it.each([
        `https://youtu.be/${ID}`,
        WATCH,
        `https://www.youtube.com/watch?v=${ID}&feature=embed`,
        "https://www.youtube.com/playlist?list=embed",
        "https://example.com/embed/foo",
    ])("is false for %s", (link) => {
        expect(isEmbeddableYoutubeLink(new URL(link))).toBe(false);
    });
});

describe("getYoutubeVideoId", () => {
    it.each([
        [`https://youtu.be/${ID}?si=AH1cTE3qDf`, ID],
        [`https://youtu.be/${ID}?t=42`, ID],
        [`https://www.youtube.com/watch?v=${ID}&si=abc&t=1m30s&feature=shared&list=PL123`, ID],
        [`https://m.youtube.com/watch?v=${ID}`, ID],
        [`https://music.youtube.com/watch?v=${ID}`, ID],
        [`https://www.youtube.com/shorts/${ID}`, ID],
        [`https://www.youtube.com/live/${ID}?feature=share`, ID],
        [`https://www.youtube.com/embed/${ID}`, ID],
        [`https://www.youtube-nocookie.com/embed/${ID}`, ID],
        [`https://www.youtube.com/v/${ID}`, ID],
        [`https://www.youtube.com/e/${ID}`, ID],
        ["https://www.youtube.com/watch?v=Ab-_Cd12345", "Ab-_Cd12345"],
    ])("reads the id of %s", (link, expected) => {
        expect(getYoutubeVideoId(new URL(link))).toBe(expected);
    });

    it.each([
        "https://www.youtube.com/playlist?list=PL123",
        "https://www.youtube.com/embed/videoseries?list=PL123",
        "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/watch",
        "https://www.youtube.com/",
        "https://www.youtube.com/@somechannel",
        `https://example.com/watch?v=${ID}`,
        `https://example.com/shorts/${ID}`,
    ])("finds no id in %s", (link) => {
        expect(getYoutubeVideoId(new URL(link))).toBeUndefined();
    });
});

describe("getYoutubeStartSeconds", () => {
    it.each([
        [`https://youtu.be/${ID}?t=42`, 42],
        [`${WATCH}&t=90`, 90],
        [`${WATCH}&t=90s`, 90],
        [`${WATCH}&t=1m30s`, 90],
        [`${WATCH}&t=1h2m3s`, 3723],
        [`${WATCH}&t=2m`, 120],
        [`https://www.youtube.com/embed/${ID}?start=15`, 15],
        [`${WATCH}&t=0`, 0],
    ])("reads the start time of %s", (link, expected) => {
        expect(getYoutubeStartSeconds(new URL(link))).toBe(expected);
    });

    it.each([WATCH, `${WATCH}&t=`, `${WATCH}&t=abc`, `${WATCH}&t=1x`, `${WATCH}&t=-5`])(
        "finds no start time in %s",
        (link) => {
            expect(getYoutubeStartSeconds(new URL(link))).toBeUndefined();
        }
    );
});

describe("getCanonicalYoutubeUrl", () => {
    it.each([
        [`https://youtu.be/${ID}?si=AH1cTE3qDf`, WATCH],
        [`https://youtu.be/${ID}?t=42`, WATCH],
        [`${WATCH}&si=abc&t=1m30s&feature=shared`, WATCH],
        [`${WATCH}&si=abc&list=PL123`, `${WATCH}&list=PL123`],
        [`https://m.youtube.com/watch?v=${ID}`, WATCH],
        [`https://music.youtube.com/watch?v=${ID}`, WATCH],
        [`https://www.youtube.com/shorts/${ID}`, WATCH],
        [`https://www.youtube.com/live/${ID}`, WATCH],
        ["https://www.youtube.com/playlist?list=PL123&si=abc", "https://www.youtube.com/playlist?list=PL123"],
    ])("turns %s into %s", (link, expected) => {
        expect(getCanonicalYoutubeUrl(new URL(link)).toString()).toBe(expected);
    });

    it("returns the original URL when there is no id nor list", () => {
        const url = new URL("https://www.youtube.com/@somechannel");
        expect(getCanonicalYoutubeUrl(url)).toBe(url);
    });
});

describe("getYoutubeEmbedUrl", () => {
    const requestedUrl = (): string => String((axiosGet.mock.calls[0] as unknown[])[0]);
    const oembedHtml = (id: string) => `<iframe src="https://www.youtube.com/embed/${id}?feature=oembed"></iframe>`;

    beforeEach(() => {
        axiosGet.mockReset();
        // The service reads the iframe src from the oEmbed html with the DOM: stub the tiny part it needs
        vi.stubGlobal("document", {
            createElement: () => {
                const div: { firstChild?: { src: string }; insertAdjacentHTML: (where: string, html: string) => void } =
                    {
                        insertAdjacentHTML: (_where, html) => {
                            const match = /src="([^"]*)"/.exec(html);
                            div.firstChild = { src: match ? match[1] : "" };
                        },
                    };
                return div;
            },
        });
    });

    it("returns an embed link as is, without calling oEmbed", async () => {
        const link = `https://www.youtube.com/embed/${ID}?start=3`;
        await expect(getYoutubeEmbedUrl(new URL(link))).resolves.toBe(link);
        expect(axiosGet).not.toHaveBeenCalled();
    });

    it("sends the canonical watch link to oEmbed for a youtu.be share link", async () => {
        axiosGet.mockResolvedValue({ data: { title: "Test", html: oembedHtml("AAAAAAAAAAA") } });
        const embed = await getYoutubeEmbedUrl(new URL("https://youtu.be/AAAAAAAAAAA?si=AH1cTE3qDf"));
        expect(embed).toBe("https://www.youtube.com/embed/AAAAAAAAAAA?feature=oembed");
        expect(axiosGet).toHaveBeenCalledTimes(1);
        const requested = new URL(requestedUrl());
        expect(requested.origin + requested.pathname).toBe("https://www.youtube.com/oembed");
        expect(requested.searchParams.get("url")).toBe("https://www.youtube.com/watch?v=AAAAAAAAAAA");
        expect(requested.searchParams.get("format")).toBe("json");
    });

    it("adds the start time to the embed link", async () => {
        axiosGet.mockResolvedValue({ data: { title: "Test", html: oembedHtml("BBBBBBBBBBB") } });
        const embed = await getYoutubeEmbedUrl(new URL("https://www.youtube.com/watch?v=BBBBBBBBBBB&t=1m30s"));
        const url = new URL(embed);
        expect(url.pathname).toBe("/embed/BBBBBBBBBBB");
        expect(url.searchParams.get("feature")).toBe("oembed");
        expect(url.searchParams.get("start")).toBe("90");
    });

    it("sends playlist pages to oEmbed as playlist links", async () => {
        axiosGet.mockResolvedValue({ data: { title: "Test", html: oembedHtml("videoseries") } });
        await getYoutubeEmbedUrl(new URL("https://www.youtube.com/playlist?list=PLcccc&si=abc"));
        const requested = new URL(requestedUrl());
        expect(requested.searchParams.get("url")).toBe("https://www.youtube.com/playlist?list=PLcccc");
    });

    it("keeps sending the original link to oEmbed when no id nor list is found", async () => {
        axiosGet.mockResolvedValue({ data: { title: "Test", html: oembedHtml("DDDDDDDDDDD") } });
        await getYoutubeEmbedUrl(new URL("https://www.youtube.com/@somechannel?t=30"));
        const requested = new URL(requestedUrl());
        expect(requested.searchParams.get("url")).toBe("https://www.youtube.com/@somechannel?t=30");
    });
});
