import { describe, expect, it, vi } from "vitest";
import {
    GIFS_PER_PAGE,
    KLIPY_CONTENT_FILTER,
    KLIPY_RATING,
    KlipyError,
    createKlipyClient,
    parseGifCategories,
    parseGifItem,
    parseGifPage,
} from "../KlipyClient";
import { fallbackCategories, shortestColumn } from "../GifLayout";

function mediaFile(name: string, width = 220, height = 165) {
    return { url: `https://static.klipy.com/ii/abc/${name}`, width, height, size: 1000 };
}

const klipyItem = {
    id: 42,
    slug: "hello-wave",
    title: "Hello wave",
    type: "gif",
    file: {
        hd: { gif: mediaFile("hd.gif", 300, 225), webp: mediaFile("hd.webp", 300, 225) },
        md: { gif: mediaFile("md.gif", 300, 225), webp: mediaFile("md.webp", 300, 225) },
        sm: { gif: mediaFile("sm.gif"), webp: mediaFile("sm.webp") },
        xs: { gif: mediaFile("xs.gif", 90, 68) },
    },
};

describe("parseGifItem", () => {
    it("sends the medium GIF and shows the small animated webp", () => {
        expect(parseGifItem(klipyItem)).toEqual({
            id: "42",
            title: "Hello wave",
            previewUrl: "https://static.klipy.com/ii/abc/sm.webp",
            previewWidth: 220,
            previewHeight: 165,
            url: "https://static.klipy.com/ii/abc/md.gif",
        });
    });

    it("falls back to the GIF when there is no webp, and to another size when one is missing", () => {
        const item = parseGifItem({ id: "x", file: { hd: { gif: mediaFile("hd.gif", 300, 225) } } });
        expect(item?.url).toBe("https://static.klipy.com/ii/abc/hd.gif");
        expect(item?.previewUrl).toBe("https://static.klipy.com/ii/abc/hd.gif");
    });

    it("also reads files that are not split by size", () => {
        const item = parseGifItem({ slug: "a", files: { gif: mediaFile("a.gif") } });
        expect(item?.url).toBe("https://static.klipy.com/ii/abc/a.gif");
        expect(item?.id).toBe("a");
    });

    it("skips what has no usable picture, and never takes a link that is not https", () => {
        expect(parseGifItem({ id: 1, file: {} })).toBeUndefined();
        expect(parseGifItem({ id: 1, file: { md: { gif: { url: "http://x.com/a.gif", width: 1, height: 1 } } } })).toBe(
            undefined
        );
        expect(parseGifItem({ id: 1, file: { md: { gif: { url: "javascript:alert(1)" } } } })).toBeUndefined();
        expect(parseGifItem("nope")).toBeUndefined();
        expect(parseGifItem(null)).toBeUndefined();
    });

    it("gives a picture without sizes a square shape", () => {
        const item = parseGifItem({ id: 1, file: { md: { gif: { url: "https://x.com/a.gif" } } } });
        expect(item?.previewWidth).toBe(1);
        expect(item?.previewHeight).toBe(1);
    });
});

describe("parseGifPage", () => {
    it("reads Klipy's page", () => {
        const page = parseGifPage({
            result: true,
            data: { data: [klipyItem, { id: 2, file: {} }], current_page: 1, per_page: 24, has_next: true },
        });
        expect(page.items).toHaveLength(1);
        expect(page.hasNext).toBe(true);
    });

    it("gives an empty page for an answer it does not know", () => {
        expect(parseGifPage(undefined)).toEqual({ items: [], hasNext: false });
        expect(parseGifPage({ result: false })).toEqual({ items: [], hasNext: false });
        expect(parseGifPage({ data: "x" })).toEqual({ items: [], hasNext: false });
    });
});

describe("parseGifCategories", () => {
    it("reads a list of categories with a name, a search and a picture", () => {
        expect(
            parseGifCategories({
                result: true,
                data: { categories: [{ category: "Hello", query: "hello", preview_url: "https://x.com/p.gif" }] },
            })
        ).toEqual([{ name: "Hello", query: "hello", previewUrl: "https://x.com/p.gif" }]);
    });

    it("reads plain words, and ignores what has no name", () => {
        expect(parseGifCategories({ data: ["lol", { nothing: 1 }, 5] })).toEqual([{ name: "lol", query: "lol" }]);
        expect(parseGifCategories(undefined)).toEqual([]);
    });
});

describe("createKlipyClient", () => {
    function answering(body: unknown, init: { ok?: boolean; status?: number } = {}) {
        return vi.fn().mockResolvedValue({
            ok: init.ok ?? true,
            status: init.status ?? 200,
            json: () => Promise.resolve(body),
        } as unknown as Response);
    }

    it("searches with the key in the path, a family-safe rating and the page", async () => {
        const fetchFn = answering({ data: { data: [klipyItem], has_next: false } });
        const client = createKlipyClient("my key", fetchFn);
        const page = await client.search("hello world", 2);
        const url = new URL(fetchFn.mock.calls[0][0] as string);
        expect(url.origin + url.pathname).toBe("https://api.klipy.com/api/v1/my%20key/gifs/search");
        expect(url.searchParams.get("q")).toBe("hello world");
        expect(url.searchParams.get("page")).toBe("2");
        expect(url.searchParams.get("per_page")).toBe(String(GIFS_PER_PAGE));
        expect(url.searchParams.get("rating")).toBe(KLIPY_RATING);
        expect(url.searchParams.get("content_filter")).toBe(KLIPY_CONTENT_FILTER);
        expect(page.items).toHaveLength(1);
    });

    it("asks for the trending GIFs, family-safe", async () => {
        const fetchFn = answering({ data: { data: [], has_next: false } });
        await createKlipyClient("k", fetchFn).trending(1);
        const url = new URL(fetchFn.mock.calls[0][0] as string);
        expect(url.pathname).toBe("/api/v1/k/gifs/trending");
        expect(url.searchParams.get("content_filter")).toBe(KLIPY_CONTENT_FILTER);
    });

    it("sends the same random customer id on every request, and never anything about the player", async () => {
        const fetchFn = answering({ data: { data: [], has_next: false } });
        const client = createKlipyClient("k", fetchFn);
        await client.trending(1);
        await client.search("x", 1);
        const first = new URL(fetchFn.mock.calls[0][0] as string).searchParams.get("customer_id");
        const second = new URL(fetchFn.mock.calls[1][0] as string).searchParams.get("customer_id");
        expect(first).toBeTruthy();
        expect(second).toBe(first);
    });

    it("throws a KlipyError with the status when Klipy refuses", async () => {
        const client = createKlipyClient("k", answering({}, { ok: false, status: 429 }));
        await expect(client.trending(1)).rejects.toMatchObject({ name: "KlipyError", status: 429 });
    });

    it("throws a KlipyError when Klipy can't be reached or answers with something that is not JSON", async () => {
        await expect(
            createKlipyClient("k", vi.fn().mockRejectedValue(new TypeError("offline"))).trending(1)
        ).rejects.toBeInstanceOf(KlipyError);
        const notJson = vi
            .fn()
            .mockResolvedValue({ ok: true, status: 200, json: () => Promise.reject(new Error("x")) });
        await expect(createKlipyClient("k", notJson).trending(1)).rejects.toBeInstanceOf(KlipyError);
    });

    it("lets a cancelled request through as it is", async () => {
        const aborted = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
        await expect(createKlipyClient("k", aborted).trending(1)).rejects.toMatchObject({ name: "AbortError" });
    });
});

describe("the picker's layout", () => {
    it("puts the next picture in the shortest column, the left one when level", () => {
        expect(shortestColumn([0, 0])).toBe(0);
        expect(shortestColumn([1.2, 0.8])).toBe(1);
        expect(shortestColumn([0.5, 0.5])).toBe(0);
    });

    it("has tiles for the first screen before Klipy sends its own", () => {
        expect(fallbackCategories().map((category) => category.query)).toContain("hello");
    });
});
