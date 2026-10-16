import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { get, readable } from "svelte/store";
import { Marked } from "marked";

vi.mock("../../../Connection/ConnectionManager", () => ({
    connectionManager: { applications: [] },
}));
vi.mock("../../../Stores/CoWebsiteStore", () => ({ coWebsites: { add: vi.fn() } }));
vi.mock("../../../WebRtc/CoWebsite/SimpleCoWebsite", () => ({ SimpleCoWebsite: class {} }));
vi.mock("../LinkPreviewFetcher", async () => {
    const { writable } = await import("svelte/store");
    return {
        fetchWebPreview: vi.fn(() =>
            Promise.resolve({ title: "A page", description: "About it", image: "https://example.com/og.png" })
        ),
        fetchYoutubePreview: vi.fn(() => new Promise<never>(() => {})),
        playingChatVideoStore: writable(undefined),
    };
});
vi.mock("../../../Stores/UserInputStore", async () => {
    const { writable } = await import("svelte/store");
    return { lightboxOpenStore: writable(false) };
});
vi.mock("../../Components/Room/MessageActions/availableActions", () => ({ saveMessageFiles: vi.fn() }));
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const text = (value: string) => () => value;
    return {
        default: readable({
            chat: {
                linkPreview: {
                    openHere: text("Open here"),
                    newTab: text("New tab"),
                    play: text("Play"),
                    openOn: text("Open on"),
                },
                messageActions: { save: text("Save") },
            },
        }),
    };
});

import { lightboxOpenStore } from "../../../Stores/UserInputStore";
import type { ChatMessageContent } from "../../Connection/ChatConnection";
import MessageImage from "../../Components/Room/Message/MessageImage.svelte";
import { sanitizeHTML } from "../../Components/Room/Message/WA-HTML-Sanitizer";
import LinkPreview from "../LinkPreview.svelte";

const GIF = "https://static.klipy.com/ii/abc/cat.gif";
const PICTURE = "https://example.com/cat.png";

describe("a picture in a chat message", () => {
    let target: HTMLElement;
    let preview: LinkPreview | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        preview?.$destroy();
        preview = undefined;
        target.remove();
        // A viewer still fading out lives on the page itself.
        document.querySelectorAll("[data-lightbox]").forEach((viewer) => viewer.remove());
    });

    async function show(body: string): Promise<HTMLAnchorElement> {
        preview = new LinkPreview({ target, props: { body, alone: true } });
        await tick();
        const card = target.querySelector<HTMLAnchorElement>('[data-testid="imageLinkPreview"]');
        if (!card) throw new Error("no picture card");
        return card;
    }

    function click(card: HTMLElement, init: MouseEventInit = {}): MouseEvent {
        const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
        card.dispatchEvent(event);
        return event;
    }

    it("opens a GIF in the picture viewer, not a new tab", async () => {
        const card = await show(GIF);
        expect(document.querySelector("[data-lightbox]")).toBeNull();

        const event = click(card);
        await tick();

        expect(event.defaultPrevented).toBe(true);
        const viewer = document.querySelector("[data-lightbox]");
        expect(viewer?.querySelector("img")?.getAttribute("src")).toBe(GIF);
    });

    it.each([
        ["Ctrl", { ctrlKey: true }],
        ["Cmd", { metaKey: true }],
        ["Shift", { shiftKey: true }],
        ["Alt", { altKey: true }],
        ["a non-primary button", { button: 1 }],
    ])("follows the link into a new tab on %s-click, without opening the viewer", async (_name, init) => {
        const card = await show(GIF);
        expect(card.getAttribute("target")).toBe("_blank");

        const event = click(card, init);
        await tick();

        expect(event.defaultPrevented).toBe(false);
        expect(document.querySelector("[data-lightbox]")).toBeNull();
        expect(get(lightboxOpenStore)).toBe(false);
    });

    it("closes the viewer with Escape", async () => {
        click(await show(GIF));
        await tick();
        expect(get(lightboxOpenStore)).toBe(true);

        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        await tick();
        // The viewer fades out; it is closed once the game takes keys again.
        expect(get(lightboxOpenStore)).toBe(false);
    });

    it("keeps the game's keys off while a GIF is open and another one arrives or leaves", async () => {
        click(await show(GIF));
        await tick();

        const other = document.createElement("div");
        document.body.appendChild(other);
        const arriving = new LinkPreview({ target: other, props: { body: GIF, alone: true } });
        await tick();
        expect(get(lightboxOpenStore)).toBe(true);

        arriving.$destroy();
        other.remove();
        expect(get(lightboxOpenStore)).toBe(true);
    });

    it.each([
        ["a pasted picture link", PICTURE],
        ["a pasted picture link with text", `look at this ${PICTURE}`],
        ["a GIF file from another site", "https://example.com/dance.gif"],
    ])("opens the picture of %s in the picture viewer", async (_name, body) => {
        preview = new LinkPreview({ target, props: { body, alone: false } });
        await tick();
        const card = target.querySelector<HTMLAnchorElement>('[data-testid="imageLinkPreview"]');
        if (!card) throw new Error("no picture card");

        expect(click(card).defaultPrevented).toBe(true);
        await tick();
        expect(document.querySelector("[data-lightbox] img")?.getAttribute("src")).toBe(body.split(" ").pop());
    });

    it("keeps the address of a picture that didn't load a link to a new tab", async () => {
        const card = await show(GIF);
        card.querySelector("img")?.dispatchEvent(new Event("error"));
        await tick();

        const fallback = target.querySelector<HTMLAnchorElement>(".link-preview-fallback");
        if (!fallback) throw new Error("no fallback link");
        expect(fallback.getAttribute("target")).toBe("_blank");
        expect(click(fallback).defaultPrevented).toBe(false);
        await tick();
        expect(document.querySelector("[data-lightbox]")).toBeNull();
    });

    it("leaves a web page card a link to the page in a new tab", async () => {
        preview = new LinkPreview({ target, props: { body: "https://example.com/article", alone: true } });
        await vi.waitFor(() => expect(target.querySelector('[data-testid="webLinkPreview"]')).not.toBeNull());
        const card = target.querySelector<HTMLAnchorElement>('[data-testid="webLinkPreview"]');
        if (!card) throw new Error("no web card");

        expect(card.getAttribute("target")).toBe("_blank");
        expect(click(card.querySelector("img") ?? card).defaultPrevented).toBe(false);
        await tick();
        expect(document.querySelector("[data-lightbox]")).toBeNull();
    });

    it("keeps a link in the message text a link to a new tab", () => {
        // The message text is drawn by MessageText (markdown, then this cleaner), which this change leaves alone.
        target.innerHTML = sanitizeHTML(new Marked().parse(`look at this ${GIF}`) as string);

        const link = target.querySelector<HTMLAnchorElement>("a");
        expect(link?.getAttribute("target")).toBe("_blank");
        if (!link) throw new Error("no link");
        expect(click(link).defaultPrevented).toBe(false);
    });

    it("still opens an uploaded picture in the picture viewer", async () => {
        const uploaded = new MessageImage({
            target,
            props: {
                content: readable({
                    url: "https://uploads.example.com/photo.png",
                    body: "photo.png",
                } as ChatMessageContent),
            },
        });
        await tick();
        const picture = target.querySelector<HTMLElement>("a");
        if (!picture) throw new Error("no uploaded picture");

        expect(click(picture).defaultPrevented).toBe(true);
        await tick();
        expect(document.querySelector("[data-lightbox] img")?.getAttribute("src")).toBe(
            "https://uploads.example.com/photo.png"
        );
        expect(get(lightboxOpenStore)).toBe(true);
        uploaded.$destroy();
        expect(get(lightboxOpenStore)).toBe(false);
    });
});
