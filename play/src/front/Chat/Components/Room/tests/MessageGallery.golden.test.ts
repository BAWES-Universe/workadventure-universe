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
    // Every label reads as its own path, so the golden shows which label sits where without caring for the wording.
    const labels = (path: string): unknown =>
        new Proxy(() => path, {
            get: (_target, key) => (typeof key === "string" ? labels(`${path}.${key}`) : undefined),
        });
    return { default: readable(labels("LL")) };
});

import type { ChatMessageContent } from "../../../Connection/ChatConnection";
import MessageGallery from "../Message/MessageGallery.svelte";

const PIC = (n: number) => `https://cdn.example/files/pic-${n}.jpg`;

function content(urls: string[], body = ""): ChatMessageContent {
    const [url, ...rest] = urls;
    return {
        body,
        url,
        urls: rest,
        filename: undefined,
        fileNames: urls.map((u) => u.split("/").pop() ?? u),
    };
}

/** What the nearby chat sends today for N files: first in `url`, the rest in `urls`, their names in `fileNames`. */
const CASES: Record<string, string[]> = {
    "2 pictures": [PIC(1), PIC(2)],
    "3 pictures": [PIC(1), PIC(2), PIC(3)],
    "4 pictures": [PIC(1), PIC(2), PIC(3), PIC(4)],
    "6 pictures": [1, 2, 3, 4, 5, 6].map(PIC),
    "8 pictures (+2)": [1, 2, 3, 4, 5, 6, 7, 8].map(PIC),
    "2 pictures + pdf + audio": [
        PIC(1),
        PIC(2),
        "https://cdn.example/files/report.pdf",
        "https://cdn.example/files/note.mp3",
    ],
    "pictures + video": [PIC(1), "https://cdn.example/files/clip.mp4", PIC(2)],
    "pdf + audio only": ["https://cdn.example/files/report.pdf", "https://cdn.example/files/note.mp3"],
};

describe("the nearby gallery renders the same with no caption and no upload state (golden)", () => {
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

    for (const [name, urls] of Object.entries(CASES)) {
        for (const body of ["", "Look at these"]) {
            it(`${name}, words: ${body === "" ? "none" : "yes"}`, async () => {
                shown = new MessageGallery({ target, props: { content: readable(content(urls, body)) } });
                await tick();
                const html = target.innerHTML.replace(/ svelte-[a-z0-9]+/g, "").replace(/\s+/g, " ");
                expect(html).toMatchSnapshot();
            });
        }
    }
});

describe("a gallery of files kept by the chat server (their addresses have no ending)", () => {
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
    });

    const blobs = ["blob:https://play.test/a", "blob:https://play.test/b", "blob:https://play.test/c"];
    const draw = async (extra: Partial<ChatMessageContent>) => {
        shown = new MessageGallery({
            target,
            props: {
                content: readable({ ...content(blobs, "words"), fileNames: ["a.jpg", "b.jpg", "c.mp4"], ...extra }),
            },
        });
        await tick();
        return target.innerHTML;
    };

    it("is read from the end of each address when nothing says what the files are, as today", async () => {
        const html = await draw({});
        // No ending: every address reads as a file, so there are no picture tiles.
        expect(html).not.toContain("<img");
        expect(html.match(/>FILE</g)).toHaveLength(3);
    });

    it("draws pictures and a video when the content says what each file is", async () => {
        const html = await draw({ itemTypes: ["image", "image", "video"] });
        expect(html.match(/<img/g)).toHaveLength(2);
        expect(html).toContain("<video");
        expect(html).not.toContain(">FILE<");
    });
});
