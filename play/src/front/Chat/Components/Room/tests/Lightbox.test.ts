import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

vi.mock("../../../../Stores/UserInputStore", async () => {
    const { writable } = await import("svelte/store");
    return { lightboxOpenStore: writable(false) };
});
vi.mock("../MessageActions/availableActions", () => ({ saveMessageFiles: vi.fn(() => Promise.resolve()) }));
vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const text = (value: string) => () => value;
    return { default: readable({ chat: { messageActions: { save: text("Save") } } }) };
});

import Lightbox from "../Message/Lightbox.svelte";

// The viewer fills a 400 x 800 screen and the picture sits in the middle, from (100, 200) to (300, 600).
const PICTURE = { left: 100, top: 200, right: 300, bottom: 600 };
const ON_PICTURE = { x: 200, y: 400 };
const ON_BACKGROUND = { x: 30, y: 60 };

describe("the picture viewer", () => {
    let target: HTMLElement;
    let viewer: Lightbox | undefined;
    let closed: number;
    let time: number;
    let nextPointerId: number;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        closed = 0;
        time = 1000;
        nextPointerId = 1;
    });

    afterEach(() => {
        viewer?.$destroy();
        viewer = undefined;
        target.remove();
        // A viewer still fading out lives on the page itself.
        document.querySelectorAll("[data-lightbox]").forEach((shown) => shown.remove());
    });

    async function open(props: Record<string, unknown> = {}): Promise<{ stage: HTMLElement; media: HTMLElement }> {
        viewer = new Lightbox({ target, props: { src: "https://example.com/cat.png", alt: "", show: true, ...props } });
        viewer.$on("close", () => closed++);
        await tick();
        const media = document.querySelector<HTMLElement>("[data-lightbox] img, [data-lightbox] video");
        const stage = media?.parentElement;
        if (!media || !stage) throw new Error("the viewer did not open");
        Object.defineProperty(stage, "clientWidth", { value: 400 });
        Object.defineProperty(stage, "clientHeight", { value: 800 });
        Object.defineProperty(media, "getBoundingClientRect", {
            value: () => ({ ...PICTURE, x: PICTURE.left, y: PICTURE.top, width: 200, height: 400 }),
        });
        return { stage, media };
    }

    // jsdom has no PointerEvent, so a mouse event carries the pointer's parts.
    function pointer(
        type: string,
        on: HTMLElement,
        at: { x: number; y: number },
        options: { id?: number; button?: number; later?: number } = {}
    ): void {
        time += options.later ?? 50;
        const event = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: at.x,
            clientY: at.y,
            button: options.button ?? 0,
        });
        Object.defineProperty(event, "pointerId", { value: options.id ?? 1 });
        Object.defineProperty(event, "timeStamp", { value: time });
        on.dispatchEvent(event);
    }

    function click(on: HTMLElement, at: { x: number; y: number }, button = 0): void {
        const id = nextPointerId++;
        pointer("pointerdown", on, at, { id, button });
        pointer("pointerup", on, at, { id, button });
    }

    function drag(on: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }): void {
        const id = nextPointerId++;
        pointer("pointerdown", on, from, { id });
        const steps = 5;
        for (let i = 1; i <= steps; i++) {
            const at = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
            pointer("pointermove", on, at, { id, later: 40 });
        }
        pointer("pointerup", on, to, { id, later: 40 });
    }

    function zoom(media: HTMLElement): number {
        const match = /scale\(([\d.]+)\)/.exec(media.style.transform);
        return match ? Number(match[1]) : NaN;
    }

    describe("the dark background", () => {
        it("closes the viewer when clicked", async () => {
            const { stage } = await open();
            click(stage, ON_BACKGROUND);
            expect(closed).toBe(1);
        });

        it("closes on the first click of a double click, without zooming", async () => {
            const { stage, media } = await open();
            click(stage, ON_BACKGROUND);
            await tick();
            expect(closed).toBe(1);
            expect(zoom(media)).toBe(1);
        });

        it("closes even while the picture is zoomed in", async () => {
            const { stage, media } = await open();
            click(media, ON_PICTURE);
            click(media, ON_PICTURE);
            await tick();
            expect(zoom(media)).toBeGreaterThan(1);
            click(stage, ON_BACKGROUND);
            expect(closed).toBe(1);
        });

        it("does not close for a right click", async () => {
            const { stage } = await open();
            click(stage, ON_BACKGROUND, 2);
            expect(closed).toBe(0);
        });

        it("does not close when the browser takes the finger back", async () => {
            const { stage } = await open();
            pointer("pointerdown", stage, ON_BACKGROUND);
            pointer("pointercancel", stage, ON_BACKGROUND);
            expect(closed).toBe(0);
        });

        it("does not close for a short drag across it", async () => {
            const { stage } = await open();
            drag(stage, ON_BACKGROUND, { x: ON_BACKGROUND.x + 60, y: ON_BACKGROUND.y });
            expect(closed).toBe(0);
        });

        it("does not close for a press on it that is let go over the picture", async () => {
            const { stage, media } = await open();
            pointer("pointerdown", stage, { x: PICTURE.left - 3, y: 400 });
            pointer("pointerup", media, { x: PICTURE.left + 3, y: 400 });
            expect(closed).toBe(0);
        });

        it("does not close for a pinch that starts on it", async () => {
            const { stage, media } = await open();
            pointer("pointerdown", stage, ON_BACKGROUND, { id: 1 });
            pointer("pointerdown", stage, { x: 360, y: 700 }, { id: 2 });
            pointer("pointermove", stage, { x: 10, y: 20 }, { id: 1 });
            pointer("pointerup", stage, { x: 10, y: 20 }, { id: 1 });
            pointer("pointerup", stage, { x: 360, y: 700 }, { id: 2 });
            await tick();
            expect(closed).toBe(0);
            expect(zoom(media)).toBeGreaterThanOrEqual(1);
        });
    });

    describe("the picture", () => {
        it("does not close when clicked once", async () => {
            const { media } = await open();
            click(media, ON_PICTURE);
            expect(closed).toBe(0);
        });

        it("zooms in on a double click and back out on the next one", async () => {
            const { media } = await open();
            click(media, ON_PICTURE);
            click(media, ON_PICTURE);
            await tick();
            expect(zoom(media)).toBe(2.5);
            click(media, ON_PICTURE);
            click(media, ON_PICTURE);
            await tick();
            expect(zoom(media)).toBe(1);
            expect(closed).toBe(0);
        });

        it("can be dragged while zoomed until the press ends over the background, without closing", async () => {
            const { media } = await open();
            click(media, ON_PICTURE);
            click(media, ON_PICTURE);
            await tick();
            drag(media, ON_PICTURE, ON_BACKGROUND);
            await tick();
            expect(closed).toBe(0);
            expect(zoom(media)).toBe(2.5);
        });

        it("still closes when dragged far down at normal size", async () => {
            const { media } = await open();
            drag(media, ON_PICTURE, { x: ON_PICTURE.x, y: 790 });
            expect(closed).toBe(1);
        });

        it("still moves to the next picture on a sideways swipe that ends over the background", async () => {
            const { media } = await open({ hasNext: true });
            let next = 0;
            viewer?.$on("next", () => next++);
            drag(media, ON_PICTURE, { x: 20, y: ON_PICTURE.y });
            expect(next).toBe(1);
            expect(closed).toBe(0);
        });

        it("shows the zoom-in pointer over the picture only", async () => {
            const { stage, media } = await open();
            expect(media.style.cursor).toBe("zoom-in");
            expect(stage.style.cursor).toBe("default");
        });
    });

    describe("a video", () => {
        it("closes when the background around it is clicked, not when the video is", async () => {
            const { stage, media } = await open({ src: "https://example.com/cat.mp4", isVideo: true });
            expect(media.tagName).toBe("VIDEO");
            click(media, ON_PICTURE);
            expect(closed).toBe(0);
            click(stage, ON_BACKGROUND);
            expect(closed).toBe(1);
        });

        it("does not close when two fingers touch it, even if one starts and the other ends over the background", async () => {
            const { stage, media } = await open({ src: "https://example.com/cat.mp4", isVideo: true });
            pointer("pointerdown", stage, ON_BACKGROUND, { id: 1 });
            pointer("pointerdown", media, ON_PICTURE, { id: 2 });
            pointer("pointerup", media, ON_PICTURE, { id: 1 });
            pointer("pointerup", stage, ON_BACKGROUND, { id: 2 });
            expect(closed).toBe(0);
        });
    });

    describe("the other ways to close", () => {
        it("still closes on Esc and on the Close button", async () => {
            await open();
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            expect(closed).toBe(1);
            document.querySelector<HTMLButtonElement>('[data-lightbox] button[aria-label="Close"]')?.click();
            expect(closed).toBe(2);
        });

        it("does not close when Save is clicked", async () => {
            await open();
            document.querySelector<HTMLButtonElement>('[data-testid="lightboxSaveButton"]')?.click();
            expect(closed).toBe(0);
        });
    });
});
