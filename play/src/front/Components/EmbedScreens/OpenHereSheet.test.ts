import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
    // An upright phone.
    window.innerWidth = 390;
    window.innerHeight = 844;
});
import { tick } from "svelte";
import { get, writable } from "svelte/store";

// The tests run Svelte's server build, where onMount does nothing; the window needs the browser one.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../../Stores/CardOverWindowStore", () => ({ cardOverWindowStore: writable(false) }));
vi.mock("../../Stores/MobileLayoutStore", async () => {
    const { writable } = await import("svelte/store");
    return { mobileLayoutStore: writable(true) };
});
vi.mock("../../../i18n/i18n-svelte", async () => (await import("../Woka/tests/i18nStub")).i18nStub);
const closeAllOpenItems = vi.hoisted(() => vi.fn());
vi.mock("../../Stores/ClosedItemsStore", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    closeAllOpenItems,
}));

// The game manager loads first, as it does in the game: its scene and the Api it listens to depend on that order.
import { gameManager } from "../../Phaser/Game/GameManager";
import { chatOwnSheetHeightStore, chatSheetLayoutStore, openHereSheetHeightStore } from "../../Chat/ChatSheetStore";
import { CHAT_SHEET_SIZES } from "../../Chat/ChatSheetSizes";
import { chatVisibilityStore } from "../../Stores/ChatStore";
import { coWebsites } from "../../Stores/CoWebsiteStore";
import {
    OPEN_HERE_BEHIND_CHAT_STRIP,
    OPEN_HERE_TUCKED_HEIGHT,
    openHereListOpenStore,
    openHereSheetRestStore,
} from "../../Stores/OpenHereSheetStore";
import { openHereTuckedStore } from "../../Stores/SideWindowInFrontStore";
import type { GameScene } from "../../Phaser/Game/GameScene";
import { FileViewerCoWebsite } from "../../WebRtc/CoWebsite/FileViewerCoWebsite";
import { getSnapHeights } from "../Sheet/BottomSheet";
import OpenHereWindow from "./OpenHereWindow.svelte";

const heights = getSnapHeights(844, CHAT_SHEET_SIZES);
const reposition = vi.fn();

function fileSource(name: string) {
    // The file never arrives: only the window's own frame and row are under test.
    return {
        key: `chat:blob:http://play/${name}`,
        name,
        load: () => new Promise<ArrayBuffer>(() => {}),
        download: () => Promise.resolve(),
    };
}

function file(name: string): FileViewerCoWebsite {
    return new FileViewerCoWebsite(fileSource(name));
}

function sendPointer(handle: Element, type: string, clientY: number): void {
    const event = new MouseEvent(type, { clientY, button: 0, bubbles: true });
    Object.defineProperty(event, "pointerId", { value: 1 });
    handle.dispatchEvent(event);
}

/** A finger on the sheet's handle: pressed at `from`, moved to `to`, let go. */
function dragHandle(handle: Element, from: number, to: number): void {
    sendPointer(handle, "pointerdown", from);
    sendPointer(handle, "pointermove", to);
    sendPointer(handle, "pointerup", to);
}

describe("OpenHereWindow as a phone's sheet", () => {
    let component: OpenHereWindow | undefined;
    let target: HTMLDivElement;
    let sceneSpy: MockInstance | undefined;

    const sheet = () => target.querySelector<HTMLElement>('[data-testid="openHereSheet"]');
    const handle = () => target.querySelector<HTMLElement>('[data-testid="openHereSheetHandle"]');

    async function mount(...names: string[]) {
        names.forEach((name) => coWebsites.add(file(name)));
        component = new OpenHereWindow({ target, props: { floating: false } });
        await tick();
    }

    beforeEach(() => {
        HTMLElement.prototype.setPointerCapture = vi.fn();
        Element.prototype.scrollIntoView = vi.fn();
        target = document.createElement("div");
        document.body.append(target);
        closeAllOpenItems.mockClear();
        reposition.mockClear();
        // The real game manager stays, so the modules load as they always did; only the scene it hands out is a stand-in.
        sceneSpy = vi
            .spyOn(gameManager, "tryGetCurrentGameScene")
            .mockReturnValue({ reposition } as unknown as GameScene);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        sceneSpy?.mockRestore();
        target.remove();
        coWebsites.removeAll();
        chatVisibilityStore.set(false);
        openHereTuckedStore.set(false);
        openHereSheetRestStore.set("half");
    });

    it("is chat's sheet: it opens at chat's height, with its handle, and has no pill or grip of a window", async () => {
        await mount("plan.pdf");

        expect(get(chatSheetLayoutStore)).toBe(true);
        expect(sheet()?.classList.contains("open-here-sheet")).toBe(true);
        expect(sheet()?.style.height).toBe(`${heights.half}px`);
        expect(handle()).not.toBeNull();
        expect(target.querySelector('[data-testid="openHereExpand"]')).toBeNull();
        expect(target.querySelector('[data-testid="openHereGrip"]')).toBeNull();
        // The videos above it follow its height.
        expect(get(openHereSheetHeightStore)).toBe(heights.half);
    });

    it("ends the row with chat's close, and with two or more open, the chip before it", async () => {
        await mount("plan.pdf");
        expect(target.querySelector('[data-testid="openHereSheetClose"]')).not.toBeNull();
        expect(target.querySelector('[data-testid="openHereList"]')).toBeNull();

        coWebsites.add(file("visits.pdf"));
        await tick();

        const chip = target.querySelector('[data-testid="openHereList"]');
        expect(chip?.textContent?.trim()).toBe('cowebsite.openCount {"count":2}');
        // No strip of tabs in the sheet: the chip lists everything.
        expect(target.querySelector(".height-tab")?.classList.contains("hidden")).toBe(true);
    });

    it("lists everything open in a sheet of its own from the chip, with the picked one marked", async () => {
        await mount("plan.pdf", "visits.pdf");

        target.querySelector<HTMLElement>('[data-testid="openHereList"]')?.click();
        await tick();

        const list = target.querySelector('[data-testid="openHereListMenu"]');
        expect(list?.classList.contains("in-sheet")).toBe(true);
        expect(list?.querySelectorAll(".open-list-row")).toHaveLength(2);
        expect(list?.querySelector(".open-list-row.picked")?.textContent).toContain("visits.pdf");
    });

    it("brings a tucked sheet back up with its list when the chip is tapped", async () => {
        await mount("plan.pdf", "visits.pdf");
        openHereTuckedStore.set(true);
        await tick();

        target.querySelector<HTMLElement>('[data-testid="openHereList"]')?.click();
        await tick();

        expect(get(openHereTuckedStore)).toBe(false);
        expect(target.querySelector('[data-testid="openHereListMenu"]')).not.toBeNull();
    });

    it("closes everything with the close, as the window's pill does on a desktop", async () => {
        await mount("plan.pdf");

        target.querySelector<HTMLElement>('[data-testid="openHereSheetClose"]')?.click();

        expect(closeAllOpenItems).toHaveBeenCalledTimes(1);
    });

    it("steps through chat's snaps when its handle is tapped", async () => {
        await mount("plan.pdf");

        dragHandle(handle()!, 300, 300);
        await tick();

        expect(get(openHereSheetRestStore)).toBe("full");
        expect(sheet()?.style.height).toBe(`${heights.full}px`);
    });

    it("rests where a drag is let go", async () => {
        await mount("plan.pdf");

        dragHandle(handle()!, 500, 400);
        await tick();

        // A hundred pixels up from where it opened.
        expect(sheet()?.style.height).toBe(`${heights.half + 100}px`);
        expect(get(openHereTuckedStore)).toBe(false);
    });

    it("tucks into a row above the bar when dragged down past its lowest height, instead of closing", async () => {
        await mount("plan.pdf");

        dragHandle(handle()!, 300, 700);
        await tick();

        expect(get(openHereTuckedStore)).toBe(true);
        expect(sheet()?.classList.contains("tucked")).toBe(true);
        expect(get(coWebsites)).toHaveLength(1);
        // Tucked, the videos have all the room again.
        expect(get(openHereSheetHeightStore)).toBe(0);
    });

    it("is not tucked when its items are restored after the sheet was closed tucked", async () => {
        await mount("plan.pdf");
        dragHandle(handle()!, 300, 700);
        await tick();
        expect(get(openHereTuckedStore)).toBe(true);

        // Closing the only item takes the sheet away, as the app does when nothing is open.
        component?.$destroy();
        component = undefined;

        expect(get(openHereTuckedStore)).toBe(false);
    });

    it("comes back up from the tuck when its row is tapped, but not when a button in it is", async () => {
        await mount("plan.pdf");
        openHereTuckedStore.set(true);
        await tick();

        target.querySelector<HTMLElement>('[data-testid="openHereSheetClose"]')?.click();
        expect(get(openHereTuckedStore)).toBe(true);

        sheet()?.click();
        await tick();

        expect(get(openHereTuckedStore)).toBe(false);
        expect(sheet()?.style.height).toBe(`${heights.half}px`);
    });

    it("rises to the top behind the chat, and goes back to where it was when the chat closes", async () => {
        await mount("plan.pdf");

        chatVisibilityStore.set(true);
        await tick();
        expect(sheet()?.style.height).toBe(`${heights.full}px`);
        expect(sheet()?.classList.contains("behind-chat")).toBe(true);
        // The chat's own height sizes the videos then.
        expect(get(openHereSheetHeightStore)).toBe(0);

        chatVisibilityStore.set(false);
        await tick();
        expect(sheet()?.style.height).toBe(`${heights.half}px`);
        expect(sheet()?.classList.contains("behind-chat")).toBe(false);
    });

    it("stays tucked when chat opens over a tucked sheet: it was put away to see the map", async () => {
        await mount("plan.pdf");
        openHereTuckedStore.set(true);
        await tick();

        chatVisibilityStore.set(true);
        await tick();

        expect(sheet()?.classList.contains("tucked")).toBe(true);
        expect(sheet()?.classList.contains("screen-blocker")).toBe(false);
        expect(sheet()?.style.height).toBe(`${OPEN_HERE_TUCKED_HEIGHT}px`);
        expect(get(openHereTuckedStore)).toBe(true);
        // Tucked, the videos have all the room, whatever the chat does with it.
        expect(get(openHereSheetHeightStore)).toBe(0);

        chatVisibilityStore.set(false);
        await tick();
        expect(sheet()?.classList.contains("tucked")).toBe(true);
        expect(sheet()?.style.height).toBe(`${OPEN_HERE_TUCKED_HEIGHT}px`);
    });

    describe("with the chat open over it", () => {
        const chatHeight = heights.peek;
        const strip = chatHeight + OPEN_HERE_BEHIND_CHAT_STRIP;

        beforeEach(async () => {
            await mount("plan.pdf");
            chatOwnSheetHeightStore.set(chatHeight);
            chatVisibilityStore.set(true);
            await tick();
        });

        afterEach(() => {
            chatOwnSheetHeightStore.set(0);
        });

        it("follows a drag down, never lower than a strip above the chat, and is not tucked", async () => {
            sendPointer(handle()!, "pointerdown", 100);
            sendPointer(handle()!, "pointermove", 400);
            await tick();
            expect(sheet()?.style.height).toBe(`${heights.full - 300}px`);

            sendPointer(handle()!, "pointermove", 800);
            await tick();
            expect(sheet()?.style.height).toBe(`${strip}px`);
            sendPointer(handle()!, "pointerup", 800);
            await tick();

            expect(sheet()?.style.height).toBe(`${strip}px`);
            expect(get(openHereTuckedStore)).toBe(false);
            expect(get(openHereSheetRestStore)).toBe("half");
        });

        it("stays where it is let go, and goes back to where it rested when the chat closes", async () => {
            dragHandle(handle()!, 100, 300);
            await tick();
            expect(sheet()?.style.height).toBe(`${heights.full - 200}px`);

            chatVisibilityStore.set(false);
            await tick();
            expect(sheet()?.style.height).toBe(`${heights.half}px`);

            // Opened again, it rises to the top again.
            chatVisibilityStore.set(true);
            await tick();
            expect(sheet()?.style.height).toBe(`${heights.full}px`);
        });

        it("steps through its heights when its handle is tapped", async () => {
            dragHandle(handle()!, 300, 300);
            await tick();
            // From the top, down to the lowest it can be over the chat.
            expect(sheet()?.style.height).toBe(`${strip}px`);

            dragHandle(handle()!, 300, 300);
            await tick();
            expect(sheet()?.style.height).toBe(`${heights.half}px`);
        });

        it("keeps stepping when a tall chat holds two of its heights at the same place", async () => {
            chatOwnSheetHeightStore.set(heights.half);
            await tick();
            const lowest = heights.half + OPEN_HERE_BEHIND_CHAT_STRIP;

            dragHandle(handle()!, 300, 300);
            await tick();
            expect(sheet()?.style.height).toBe(`${lowest}px`);

            // Peek and half are both the lowest here: the tap goes on to the top rather than staying put.
            dragHandle(handle()!, 300, 300);
            await tick();
            expect(sheet()?.style.height).toBe(`${heights.full}px`);
        });

        it("keeps the strip above a taller chat", async () => {
            chatOwnSheetHeightStore.set(heights.half);
            dragHandle(handle()!, 100, 800);
            await tick();

            expect(sheet()?.style.height).toBe(`${heights.half + OPEN_HERE_BEHIND_CHAT_STRIP}px`);
        });
    });

    it("centres the map again once the sheet has stopped moving, and when it is gone", async () => {
        await mount("plan.pdf");
        reposition.mockClear();

        // Rising, or changing height: not before it ends, and not for a child's animation or another property.
        sheet()?.dispatchEvent(new Event("animationend", { bubbles: true }));
        expect(reposition).toHaveBeenCalledTimes(1);
        const height = new Event("transitionend", { bubbles: true });
        Object.defineProperty(height, "propertyName", { value: "height" });
        sheet()?.dispatchEvent(height);
        expect(reposition).toHaveBeenCalledTimes(2);
        const padding = new Event("transitionend", { bubbles: true });
        Object.defineProperty(padding, "propertyName", { value: "padding-top" });
        sheet()?.dispatchEvent(padding);
        handle()?.dispatchEvent(new Event("animationend", { bubbles: true }));
        expect(reposition).toHaveBeenCalledTimes(2);

        component?.$destroy();
        component = undefined;
        expect(reposition).toHaveBeenCalledTimes(3);
    });

    it("centres the map again at once when motion is reduced, as no animation or transition ends then", async () => {
        window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
        try {
            await mount("plan.pdf");
            await tick();
            expect(reposition).toHaveBeenCalledTimes(1);

            openHereSheetRestStore.set("full");
            await tick();
            await tick();
            expect(reposition).toHaveBeenCalledTimes(2);
        } finally {
            Reflect.deleteProperty(window, "matchMedia");
        }
    });

    it("ends a drag when the chat opens over the sheet, so the rest height is back once it closes", async () => {
        await mount("plan.pdf");

        sendPointer(handle()!, "pointerdown", 500);
        sendPointer(handle()!, "pointermove", 400);
        await tick();
        expect(sheet()?.style.height).toBe(`${heights.half + 100}px`);

        // A message arrives and the chat opens, and then the finger lifts.
        chatVisibilityStore.set(true);
        await tick();
        sendPointer(handle()!, "pointerup", 400);
        chatVisibilityStore.set(false);
        await tick();

        expect(sheet()?.style.height).toBe(`${heights.half}px`);
        expect(get(openHereSheetRestStore)).toBe("half");
    });

    it("centres the map as soon as a drag is let go where the sheet already is, as no height changes then", async () => {
        await mount("plan.pdf");
        reposition.mockClear();

        dragHandle(handle()!, 500, 400);
        await tick();
        await tick();

        expect(sheet()?.style.height).toBe(`${heights.half + 100}px`);
        expect(reposition).toHaveBeenCalledTimes(1);

        // Tucked, the height does change, and the transition's end does it.
        reposition.mockClear();
        dragHandle(handle()!, 300, 700);
        await tick();
        await tick();
        expect(get(openHereTuckedStore)).toBe(true);
        expect(reposition).not.toHaveBeenCalled();
    });

    it("brings a tucked sheet back up from the keyboard, with Enter or Space on its handle", async () => {
        await mount("plan.pdf");
        openHereTuckedStore.set(true);
        await tick();

        handle()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await tick();
        expect(get(openHereTuckedStore)).toBe(false);

        openHereTuckedStore.set(true);
        await tick();
        handle()?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        await tick();
        expect(get(openHereTuckedStore)).toBe(false);

        // Other keys do nothing.
        openHereTuckedStore.set(true);
        await tick();
        handle()?.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
        await tick();
        expect(get(openHereTuckedStore)).toBe(true);
    });

    it("has no close when the only page open is one a map keeps open", async () => {
        coWebsites.add(new FileViewerCoWebsite(fileSource("kept.pdf"), undefined, false));
        component = new OpenHereWindow({ target, props: { floating: false } });
        await tick();
        expect(target.querySelector('[data-testid="openHereSheetClose"]')).toBeNull();

        // Something that can be closed beside it brings the close back.
        coWebsites.add(file("plan.pdf"));
        await tick();
        expect(target.querySelector('[data-testid="openHereSheetClose"]')).not.toBeNull();
    });

    it("shows the list of open items on the sheet's own flat surface, and tells the chat button it is up", async () => {
        await mount("plan.pdf", "visits.pdf");
        expect(get(openHereListOpenStore)).toBe(false);

        target.querySelector<HTMLElement>('[data-testid="openHereList"]')?.click();
        await tick();

        const list = target.querySelector('[data-testid="openHereListMenu"]');
        expect(list?.classList.contains("u-surface-flat")).toBe(true);
        expect(list?.classList.contains("u-surface")).toBe(false);
        expect(get(openHereListOpenStore)).toBe(true);

        component?.$destroy();
        component = undefined;
        expect(get(openHereListOpenStore)).toBe(false);
    });
});
