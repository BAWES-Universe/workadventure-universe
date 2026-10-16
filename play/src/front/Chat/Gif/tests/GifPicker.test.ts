import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
// Svelte has no public way to run its pending updates now, which is what a real click gives it between listeners.
// eslint-disable-next-line svelte/no-svelte-internal
import { flush } from "svelte/internal";
import { get } from "svelte/store";

vi.mock("../../../Enum/EnvironmentVariable", () => ({ KLIPY_API_KEY: "test-key" }));
vi.mock("../../../Stores/ChatStore", async () => {
    const { writable } = await import("svelte/store");
    return { chatInputFocusStore: writable(false) };
});
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const text = (value: string) => () => value;
    return {
        default: readable({
            chat: {
                gifPicker: {
                    title: text("GIFs"),
                    back: text("Back"),
                    clearSearch: text("Clear search"),
                    searchPlaceholder: text("Search Klipy"),
                    trending: text("Trending GIFs"),
                    loading: text("Loading GIFs"),
                    loadError: text("Klipy can't be reached"),
                    loadErrorHint: text("Check your connection, then try again."),
                    retry: text("Try again"),
                    noResults: ({ query }: { query: string }) => `No GIFs for “${query}”`,
                    noResultsHint: text("Try another word, or one of these:"),
                    noTrending: text("No GIFs right now."),
                    send: ({ title }: { title: string }) => `Send GIF ${title}`,
                },
            },
        }),
    };
});

import { chatInputFocusStore } from "../../../Stores/ChatStore";
import GifPicker from "../GifPicker.svelte";
import { GIF_HOME_TTL_MS, gifSessionOf } from "../GifSession";
import type { GifItem, GifPage, KlipyClient } from "../KlipyClient";

function gif(id: string, width = 220, height = 165): GifItem {
    return {
        id,
        title: `gif ${id}`,
        previewUrl: `https://static.klipy.com/${id}-sm.webp`,
        previewWidth: width,
        previewHeight: height,
        url: `https://static.klipy.com/${id}-md.gif`,
    };
}

function fakeClient(overrides: Partial<KlipyClient> = {}): KlipyClient & {
    search: ReturnType<typeof vi.fn>;
    trending: ReturnType<typeof vi.fn>;
} {
    return {
        search: vi.fn().mockResolvedValue({ items: [gif("a"), gif("b")], hasNext: false } satisfies GifPage),
        trending: vi.fn().mockResolvedValue({ items: [gif("t")], hasNext: false } satisfies GifPage),
        categories: vi.fn().mockResolvedValue([]),
        ...overrides,
    } as never;
}

/** A page that never comes. */
function pendingPage(): Promise<GifPage> {
    return new Promise<GifPage>(() => {
        // Never resolved.
    });
}

async function settle() {
    // Each answer takes a few turns to reach the screen.
    await Promise.resolve();
    await tick();
    await Promise.resolve();
    await tick();
    await Promise.resolve();
    await tick();
    await Promise.resolve();
    await tick();
}

describe("GifPicker", () => {
    let target: HTMLElement;
    let picker: GifPicker | undefined;
    let onClose: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
        onClose = vi.fn();
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        picker?.$destroy();
        picker = undefined;
        target.remove();
        vi.useRealTimers();
    });

    function closePicker() {
        picker?.$destroy();
        picker = undefined;
        target.innerHTML = "";
    }

    function mount(client: KlipyClient, onPick = vi.fn(), extra: Record<string, unknown> = {}) {
        picker = new GifPicker({ target, props: { client, onPick, onClose, ...extra } });
        return onPick;
    }

    /**
     * A click like a mouse makes it. A click made by a script (`element.click()`) runs every listener before the
     * page has had a chance to update. A real one lets Svelte update the page after each listener: flushing here, in
     * a listener added after the picker's own, is that.
     */
    function realClick(element: Element) {
        element.addEventListener("click", () => flush(), { once: true });
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
    }

    function anchorOfWidth(width: number): HTMLElement & { width: number } {
        const anchor = Object.assign(document.createElement("div"), { width });
        anchor.getBoundingClientRect = () => ({ width: anchor.width } as DOMRect);
        return anchor;
    }

    function pickerBox(): HTMLElement {
        return target.querySelector<HTMLElement>('[data-testid="gifPicker"]') as HTMLElement;
    }

    function focusedNav(): string | null | undefined {
        return document.activeElement?.getAttribute("data-nav") ?? document.activeElement?.getAttribute("data-testid");
    }

    function key(element: Element | null | undefined, name: string) {
        element?.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    }

    function input(): HTMLInputElement {
        const found = target.querySelector<HTMLInputElement>('[data-testid="gifPickerSearch"]');
        if (!found) throw new Error("no search box");
        return found;
    }

    function type(text: string) {
        input().value = text;
        input().dispatchEvent(new Event("input", { bubbles: true }));
    }

    it("starts on tiles, with the search box saying Klipy", async () => {
        mount(fakeClient());
        await settle();
        expect(input().placeholder).toBe("Search Klipy");
        expect(target.querySelector('[data-testid="gifPickerTrending"]')).not.toBeNull();
        expect(target.querySelectorAll('[data-testid="gifPickerItem"]')).toHaveLength(0);
        expect(target.querySelector('[data-testid="gifPickerBack"]')).toBeNull();
    });

    it("searches once typing pauses, and shows the results in two columns", async () => {
        const client = fakeClient();
        mount(client);
        type("h");
        type("hello");
        expect(client.search).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(350);
        await settle();
        expect(client.search).toHaveBeenCalledTimes(1);
        expect(client.search.mock.calls[0][0]).toBe("hello");
        expect(client.search.mock.calls[0][1]).toBe(1);
        expect(target.querySelectorAll(".column")).toHaveLength(2);
        expect(target.querySelectorAll('[data-testid="gifPickerItem"]')).toHaveLength(2);
        expect(target.querySelector('[data-testid="gifPickerBack"]')).not.toBeNull();
    });

    it("sends the link of the GIF that is tapped", async () => {
        const client = fakeClient();
        const onPick = mount(client);
        type("hello");
        await vi.advanceTimersByTimeAsync(350);
        await settle();
        target.querySelectorAll<HTMLButtonElement>('[data-testid="gifPickerItem"]')[1].click();
        expect(onPick).toHaveBeenCalledWith("https://static.klipy.com/b-md.gif");
    });

    it("shows the trending GIFs from its tile and goes back to the tiles", async () => {
        const client = fakeClient();
        mount(client);
        await settle();
        target.querySelector<HTMLButtonElement>('[data-testid="gifPickerTrending"]')?.click();
        await settle();
        // Once for the Trending tile's picture, once for the list.
        expect(client.trending).toHaveBeenCalledTimes(2);
        expect(target.querySelectorAll('[data-testid="gifPickerItem"]')).toHaveLength(1);
        target.querySelector<HTMLButtonElement>('[data-testid="gifPickerBack"]')?.click();
        await settle();
        expect(target.querySelector('[data-testid="gifPickerTrending"]')).not.toBeNull();
        expect(input().value).toBe("");
    });

    it("says so when nothing is found", async () => {
        const client = fakeClient({ search: vi.fn().mockResolvedValue({ items: [], hasNext: false }) });
        mount(client);
        type("zzzz");
        await vi.advanceTimersByTimeAsync(350);
        await settle();
        expect(target.querySelector('[data-testid="gifPickerEmpty"]')?.textContent).toContain("No GIFs for “zzzz”");
    });

    it("stops asking for more when a page has nothing to show, even if it says there is more", async () => {
        const search = vi.fn().mockResolvedValue({ items: [], hasNext: true });
        mount(fakeClient({ search }));
        type("zzzz");
        await vi.advanceTimersByTimeAsync(350);
        await settle();
        await settle();
        expect(search).toHaveBeenCalledTimes(1);
    });

    it("shows an error with a way to try again", async () => {
        const search = vi
            .fn()
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValue({ items: [gif("a")], hasNext: false });
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        mount(fakeClient({ search }));
        type("hello");
        await vi.advanceTimersByTimeAsync(350);
        await settle();
        expect(target.querySelector('[data-testid="gifPickerError"]')).not.toBeNull();
        target.querySelector<HTMLButtonElement>('[data-testid="gifPickerError"] button')?.click();
        await settle();
        expect(search).toHaveBeenCalledTimes(2);
        expect(target.querySelectorAll('[data-testid="gifPickerItem"]')).toHaveLength(1);
        expect(target.querySelector('[data-testid="gifPickerError"]')).toBeNull();
    });

    it("keeps only the answer to the latest search", async () => {
        let resolveFirst: (page: GifPage) => void = () => undefined;
        const search = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<GifPage>((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockResolvedValue({ items: [gif("new")], hasNext: false });
        mount(fakeClient({ search }));
        type("one");
        await vi.advanceTimersByTimeAsync(350);
        type("two");
        await vi.advanceTimersByTimeAsync(350);
        await settle();
        resolveFirst({ items: [gif("old")], hasNext: false });
        await settle();
        const labels = [...target.querySelectorAll('[data-testid="gifPickerItem"]')].map((item) =>
            item.getAttribute("aria-label")
        );
        expect(labels).toEqual(["Send GIF gif new"]);
    });

    it("turns the game's keys off while its search box is focused, and back on when it closes", async () => {
        mount(fakeClient());
        await settle();
        input().dispatchEvent(new FocusEvent("focus"));
        expect(get(chatInputFocusStore)).toBe(true);
        picker?.$destroy();
        picker = undefined;
        expect(get(chatInputFocusStore)).toBe(false);
    });

    it("leaves the keys as they are when the message box took the focus (a sent GIF)", () => {
        mount(fakeClient());
        input().dispatchEvent(new FocusEvent("focus"));
        input().dispatchEvent(new FocusEvent("blur"));
        // The message box is focused next, and turns the keys off.
        chatInputFocusStore.set(true);
        picker?.$destroy();
        picker = undefined;
        expect(get(chatInputFocusStore)).toBe(true);
    });

    describe("a click on a tile", () => {
        it("opens the category and leaves the picker open", async () => {
            const client = fakeClient();
            mount(client);
            await settle();
            const tile = target.querySelector<HTMLButtonElement>('[data-testid="gifPickerTile"]');
            expect(tile).not.toBeNull();
            realClick(tile as HTMLElement);
            await settle();
            expect(onClose).not.toHaveBeenCalled();
            expect(client.search.mock.calls[0][0]).toBe("hello");
            expect(target.querySelectorAll('[data-testid="gifPickerItem"]')).toHaveLength(2);
        });

        it("on Trending opens the trending GIFs and leaves the picker open", async () => {
            mount(fakeClient());
            await settle();
            realClick(target.querySelector('[data-testid="gifPickerTrending"]') as HTMLElement);
            await settle();
            expect(onClose).not.toHaveBeenCalled();
            expect(target.querySelectorAll('[data-testid="gifPickerItem"]')).toHaveLength(1);
        });

        it("on the back arrow goes back to the tiles and leaves the picker open", async () => {
            mount(fakeClient());
            type("hello");
            await vi.advanceTimersByTimeAsync(350);
            await settle();
            realClick(target.querySelector('[data-testid="gifPickerBack"]') as HTMLElement);
            await settle();
            expect(onClose).not.toHaveBeenCalled();
            expect(target.querySelector('[data-testid="gifPickerTrending"]')).not.toBeNull();
        });

        it("still closes the picker when the click is outside it", async () => {
            mount(fakeClient());
            await settle();
            const outside = document.createElement("button");
            document.body.appendChild(outside);
            realClick(outside);
            outside.remove();
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    describe("loading", () => {
        it("shows tiles as boxes the first time, and straight away when it opens again", async () => {
            const categories = vi.fn().mockResolvedValue([
                { name: "lol", query: "lol", previewUrl: "https://static.klipy.com/lol.webp" },
                { name: "love", query: "love", previewUrl: "https://static.klipy.com/love.webp" },
            ]);
            const client = fakeClient({ categories });
            mount(client);
            expect(target.querySelector('[data-testid="gifPickerTilesLoading"]')).not.toBeNull();
            expect(target.querySelector('[data-testid="gifPickerTrending"]')).toBeNull();
            await settle();
            expect(target.querySelector('[data-testid="gifPickerTilesLoading"]')).toBeNull();
            expect(target.querySelectorAll('[data-testid="gifPickerTile"]')).toHaveLength(2);

            closePicker();
            mount(client);
            // No waiting: what the first opening learnt is there at once.
            expect(target.querySelector('[data-testid="gifPickerTilesLoading"]')).toBeNull();
            expect(target.querySelectorAll('[data-testid="gifPickerTile"] img')).toHaveLength(2);
            expect(target.querySelector('[data-testid="gifPickerTrending"] img')).not.toBeNull();
            expect(categories).toHaveBeenCalledTimes(1);
            expect(client.trending).toHaveBeenCalledTimes(1);
        });

        it("loads the tile pictures at once and keeps them for the next opening", async () => {
            const client = fakeClient({
                categories: vi.fn().mockResolvedValue([
                    { name: "lol", query: "lol", previewUrl: "https://static.klipy.com/lol.webp" },
                    { name: "love", query: "love", previewUrl: "https://static.klipy.com/love.webp" },
                ]),
            });
            mount(client);
            await settle();
            // Not lazy: a tile built again must not wait to scroll into view before its picture starts.
            for (const image of target.querySelectorAll(
                '[data-testid="gifPickerTile"] img, [data-testid="gifPickerTrending"] img'
            )) {
                expect(image.getAttribute("loading")).toBeNull();
            }
            const held = gifSessionOf(client).pictures;
            expect([...(held?.keys() ?? [])].sort()).toEqual([
                "https://static.klipy.com/lol.webp",
                "https://static.klipy.com/love.webp",
                "https://static.klipy.com/t-sm.webp",
            ]);
        });

        it("asks Klipy for the tiles again once five minutes have passed", async () => {
            const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
            try {
                const categories = vi.fn().mockResolvedValue([{ name: "lol", query: "lol" }]);
                const client = fakeClient({ categories });
                mount(client);
                await settle();
                closePicker();

                now.mockReturnValue(1_000_000 + GIF_HOME_TTL_MS - 1000);
                mount(client);
                await settle();
                expect(categories).toHaveBeenCalledTimes(1);
                closePicker();

                now.mockReturnValue(1_000_000 + GIF_HOME_TTL_MS);
                mount(client);
                expect(target.querySelector('[data-testid="gifPickerTilesLoading"]')).not.toBeNull();
                await settle();
                expect(categories).toHaveBeenCalledTimes(2);
                expect(client.trending).toHaveBeenCalledTimes(2);
            } finally {
                now.mockRestore();
            }
        });

        it("does not keep search results: each search asks Klipy", async () => {
            const client = fakeClient();
            mount(client);
            await settle();
            type("cat");
            await vi.advanceTimersByTimeAsync(350);
            await settle();
            closePicker();
            mount(client);
            await settle();
            type("cat");
            await vi.advanceTimersByTimeAsync(350);
            await settle();
            expect(client.search).toHaveBeenCalledTimes(2);
        });

        it("falls back to plain tiles when Klipy does not send categories", async () => {
            vi.spyOn(console, "error").mockImplementation(() => undefined);
            mount(fakeClient({ categories: vi.fn().mockRejectedValue(new Error("offline")) }));
            await settle();
            expect(target.querySelector('[data-testid="gifPickerTilesLoading"]')).toBeNull();
            expect(target.querySelectorAll('[data-testid="gifPickerTile"]').length).toBeGreaterThan(5);
        });

        it("gives the Trending tile the first trending GIF", async () => {
            mount(fakeClient());
            await settle();
            const image = target.querySelector('[data-testid="gifPickerTrending"] img');
            expect(image?.getAttribute("src")).toBe("https://static.klipy.com/t-sm.webp");
        });

        it("paints the Trending tile like the other tiles, with no gradient layer over it", () => {
            // A gradient cannot fade to the flat colour of the hover and pressed looks: the layer would vanish for the
            // length of the transition and the GIF would flash at full brightness. jsdom does not apply the styles, so
            // this reads the rules.
            const source = readFileSync("src/front/Chat/Gif/GifPicker.svelte", "utf8");
            const afterRules = [...source.matchAll(/\.tile[^{}]*::after\s*\{([^}]*)\}/g)].map((match) => match[0]);
            expect(afterRules.length).toBeGreaterThan(0);
            for (const rule of afterRules) expect(rule).not.toMatch(/gradient/);
            expect(source).not.toMatch(/\.tile\.trending[^{]*::after/);
        });

        it("shows grey boxes, not a spinner, while a search loads", async () => {
            let resolveSearch: (page: GifPage) => void = () => undefined;
            const search = vi.fn().mockImplementation(
                () =>
                    new Promise<GifPage>((resolve) => {
                        resolveSearch = resolve;
                    })
            );
            mount(fakeClient({ search }));
            type("hello");
            await vi.advanceTimersByTimeAsync(350);
            await settle();
            expect(target.querySelectorAll('[data-testid="gifPickerResultsLoading"] .gif-skeleton').length).toBe(8);
            expect(target.querySelector(".spinner")).toBeNull();
            resolveSearch({ items: [gif("a")], hasNext: false });
            await settle();
            expect(target.querySelector('[data-testid="gifPickerResultsLoading"]')).toBeNull();
            expect(target.querySelectorAll('[data-testid="gifPickerItem"]')).toHaveLength(1);
        });

        it("shows grey boxes under the GIFs while the next page loads", async () => {
            const search = vi
                .fn()
                .mockResolvedValueOnce({ items: [gif("a"), gif("b")], hasNext: true })
                .mockReturnValue(pendingPage());
            mount(fakeClient({ search }));
            type("hello");
            await vi.advanceTimersByTimeAsync(350);
            await settle();
            expect(target.querySelectorAll('[data-testid="gifPickerItem"]')).toHaveLength(2);
            expect(target.querySelectorAll('[data-testid="gifPickerMoreLoading"] .gif-skeleton')).toHaveLength(2);
            expect(target.querySelector(".spinner")).toBeNull();
        });
    });

    describe("when nothing comes", () => {
        it("offers three categories to try, and a tap on one searches it", async () => {
            const search = vi
                .fn()
                .mockResolvedValueOnce({ items: [], hasNext: false })
                .mockResolvedValue({ items: [gif("a")], hasNext: false });
            mount(fakeClient({ search }));
            await settle();
            type("zxqvv");
            await vi.advanceTimersByTimeAsync(350);
            await settle();
            const chips = target.querySelectorAll<HTMLButtonElement>('[data-testid="gifPickerEmpty"] .chip');
            expect(chips).toHaveLength(3);
            expect(target.querySelector('[data-testid="gifPickerEmpty"]')?.textContent).toContain(
                "Try another word, or one of these:"
            );
            realClick(chips[1]);
            await settle();
            expect(onClose).not.toHaveBeenCalled();
            expect(search.mock.calls[1][0]).toBe("lol");
            expect(target.querySelectorAll('[data-testid="gifPickerItem"]')).toHaveLength(1);
        });

        it("says Klipy can't be reached, with one way to try again", async () => {
            vi.spyOn(console, "error").mockImplementation(() => undefined);
            mount(fakeClient({ search: vi.fn().mockRejectedValue(new Error("offline")) }));
            type("hello");
            await vi.advanceTimersByTimeAsync(350);
            await settle();
            const error = target.querySelector('[data-testid="gifPickerError"]');
            expect(error?.textContent).toContain("Klipy can't be reached");
            expect(error?.textContent).toContain("Check your connection, then try again.");
            expect(error?.querySelectorAll("button")).toHaveLength(1);
        });
    });

    describe("size", () => {
        let resizeCallback: ((entries: unknown[]) => void) | undefined;

        beforeEach(() => {
            resizeCallback = undefined;
            vi.stubGlobal(
                "ResizeObserver",
                class {
                    constructor(callback: (entries: unknown[]) => void) {
                        resizeCallback = callback;
                    }
                    observe() {}
                    disconnect() {}
                }
            );
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it.each([
            [360, 344, 2, 2],
            [428, 412, 2, 2],
            [500, 484, 3, 3],
            [680, 640, 3, 4],
            [900, 640, 3, 4],
            [250, 280, 2, 2],
        ])(
            "follows a %ipx chat panel: %ipx wide, %i tile columns, %i GIF columns",
            async (panel, wide, tiles, gifs) => {
                mount(fakeClient(), vi.fn(), { anchor: anchorOfWidth(panel) });
                await settle();
                expect(pickerBox().style.width).toBe(`${wide}px`);
                expect(target.querySelector<HTMLElement>(".tiles")?.style.gridTemplateColumns).toBe(
                    `repeat(${tiles}, 1fr)`
                );
                type("hello");
                await vi.advanceTimersByTimeAsync(350);
                await settle();
                expect(target.querySelectorAll(".column")).toHaveLength(gifs);
            }
        );

        it("moves the GIFs into more columns when the chat panel grows", async () => {
            const search = vi.fn().mockResolvedValue({
                items: ["a", "b", "c", "d", "e", "f"].map((id) => gif(id)),
                hasNext: false,
            });
            const anchor = anchorOfWidth(360);
            mount(fakeClient({ search }), vi.fn(), { anchor });
            type("hello");
            await vi.advanceTimersByTimeAsync(350);
            await settle();
            expect(target.querySelectorAll(".column")).toHaveLength(2);
            anchor.width = 680;
            resizeCallback?.([]);
            await settle();
            expect(target.querySelectorAll(".column")).toHaveLength(4);
            expect(target.querySelectorAll('[data-testid="gifPickerItem"]')).toHaveLength(6);
            expect(pickerBox().style.width).toBe("640px");
        });
    });

    describe("keyboard", () => {
        it("goes from the search box into the tiles, and moves between them", async () => {
            mount(fakeClient());
            await settle();
            input().focus();
            key(input(), "ArrowDown");
            expect(focusedNav()).toBe("tile:0");
            key(document.activeElement, "ArrowRight");
            expect(focusedNav()).toBe("tile:1");
            key(document.activeElement, "ArrowDown");
            // Two tiles a row.
            expect(focusedNav()).toBe("tile:3");
            key(document.activeElement, "ArrowLeft");
            expect(focusedNav()).toBe("tile:2");
            key(document.activeElement, "ArrowUp");
            key(document.activeElement, "ArrowUp");
            // Up from the first row is the search box.
            expect(document.activeElement).toBe(input());
        });

        it("moves between the GIFs, and Enter on one sends it", async () => {
            const items = ["a", "b", "c", "d"].map((id) => gif(id));
            const onPick = mount(fakeClient({ search: vi.fn().mockResolvedValue({ items, hasNext: false }) }));
            type("hello");
            await vi.advanceTimersByTimeAsync(350);
            await settle();
            input().focus();
            key(input(), "ArrowDown");
            expect(focusedNav()).toBe("gif:0:0");
            key(document.activeElement, "ArrowRight");
            expect(focusedNav()).toBe("gif:1:0");
            key(document.activeElement, "ArrowDown");
            expect(focusedNav()).toBe("gif:1:1");
            key(document.activeElement, "ArrowUp");
            key(document.activeElement, "ArrowUp");
            expect(document.activeElement).toBe(input());
            key(input(), "ArrowDown");
            // A browser turns Enter on a focused button into a click.
            (document.activeElement as HTMLElement).click();
            expect(onPick).toHaveBeenCalledWith("https://static.klipy.com/a-md.gif");
        });

        it("closes with Escape", async () => {
            mount(fakeClient());
            await settle();
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    it("shows each GIF alone, its name only for screen readers", async () => {
        mount(fakeClient());
        type("hello");
        await vi.advanceTimersByTimeAsync(350);
        await settle();
        const item = target.querySelector('[data-testid="gifPickerItem"]');
        expect(item?.textContent?.trim()).toBe("");
        expect(item?.getAttribute("aria-label")).toContain("gif a");
        expect(item?.querySelector("img")?.getAttribute("alt")).toBe("gif a");
    });
});
