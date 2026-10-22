import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { readable } from "svelte/store";

vi.mock("../../../../Stores/UserInputStore", async () => {
    const { writable } = await import("svelte/store");
    return { lightboxOpenStore: writable(false) };
});
vi.mock("../MessageActions/availableActions", () => ({ saveMessageFiles: vi.fn() }));
vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const text = (value: string) => () => value;
    return { default: readable({ chat: { messageActions: { save: text("Save") } } }) };
});

import type { ChatMessageContent } from "../../../Connection/ChatConnection";
import MessageImage from "../Message/MessageImage.svelte";
import MessageVideoFile from "../Message/MessageVideoFile.svelte";

function content(partial: Partial<ChatMessageContent>): ChatMessageContent {
    return { body: "", url: undefined, urls: undefined, filename: undefined, fileNames: undefined, ...partial };
}

describe("what shows under a picture or video", () => {
    let target: HTMLElement;
    let shown: { $destroy: () => void } | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        shown?.$destroy();
        shown = undefined;
        target.remove();
        document.querySelectorAll("[data-lightbox]").forEach((viewer) => viewer.remove());
    });

    async function showImage(partial: Partial<ChatMessageContent>) {
        shown = new MessageImage({ target, props: { content: readable(content(partial)) } });
        await tick();
    }

    async function showVideo(partial: Partial<ChatMessageContent>) {
        shown = new MessageVideoFile({ target, props: { content: readable(content(partial)) } });
        await tick();
    }

    const visibleText = () => (target.textContent ?? "").replace(/\s+/g, " ").trim();

    describe("a picture", () => {
        it.each(["image.png", "Screenshot 2026-10-21 111313.png"])("shows no file name (%s)", async (name) => {
            await showImage({ url: "blob:https://play.test/a", body: name, filename: name });

            expect(target.querySelector("img")?.getAttribute("src")).toBe("blob:https://play.test/a");
            expect(visibleText()).toBe("");
        });

        it("shows no file name while the picture is still loading", async () => {
            await showImage({ url: undefined, body: "image.png", filename: "image.png" });

            expect(target.querySelector("[data-testid='messageImageLoading']")).not.toBeNull();
            expect(visibleText()).toBe("");
        });

        it("keeps its alt text, for screen readers", async () => {
            await showImage({ url: "blob:https://play.test/a", body: "image.png", filename: "image.png" });

            expect(target.querySelector("img")?.getAttribute("alt")).toBe("image.png");
        });

        it("shows a caption the sender typed", async () => {
            await showImage({ url: "blob:https://play.test/a", body: "New desk layout", filename: "desk.png" });

            expect(visibleText()).toBe("New desk layout");
        });

        it("shows the caption of a nearby chat or bot picture, which has no file name field", async () => {
            await showImage({ url: "https://uploads.example.com/photo.png", body: "Look at this" });

            expect(visibleText()).toBe("Look at this");
        });
    });

    describe("a video", () => {
        it("shows no file name", async () => {
            await showVideo({ url: "blob:https://play.test/v", body: "clip.mp4", filename: "clip.mp4" });

            expect(target.querySelector("video")).not.toBeNull();
            expect(visibleText()).toBe("");
        });

        it("shows a caption the sender typed", async () => {
            await showVideo({ url: "blob:https://play.test/v", body: "The demo", filename: "clip.mp4" });

            expect(visibleText()).toBe("The demo");
        });
    });
});
