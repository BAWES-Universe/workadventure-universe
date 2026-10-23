import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const { scene, openChat } = vi.hoisted(() => ({
    scene: {
        current: {
            room: { isChatEnabled: true },
            proximityChatRoom: {
                hasUnreadMessages: { set: vi.fn() },
                unreadNotificationCount: { set: vi.fn() },
            },
        },
    },
    openChat: vi.fn(),
}));
vi.mock("../../Phaser/Game/GameManager", () => ({ gameManager: { getCurrentGameScene: () => scene.current } }));
vi.mock("../../Chat/openChat", () => ({ openChat }));
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

import { selectedRoomStore } from "../../Chat/Stores/SelectRoomStore";
import { chatSheetLayoutStore, openHereSheetHeightStore } from "../../Chat/ChatSheetStore";
import { CHAT_SHEET_SIZES } from "../../Chat/ChatSheetSizes";
import { chatVisibilityStore } from "../../Stores/ChatStore";
import { coWebsites } from "../../Stores/CoWebsiteStore";
import { openHereSheetRestStore } from "../../Stores/OpenHereSheetStore";
import { emoteMenuStore } from "../../Stores/EmoteStore";
import { expressTrayStore } from "../../Stores/ExpressStore";
import { modalVisibilityStore } from "../../Stores/ModalStore";
import { openHereTuckedStore, sideWindowInFrontStore } from "../../Stores/SideWindowInFrontStore";
import { lightboxOpenStore } from "../../Stores/UserInputStore";
import { FileViewerCoWebsite } from "../../WebRtc/CoWebsite/FileViewerCoWebsite";
import { getSnapHeights } from "../Sheet/BottomSheet";
import OpenHereChatButton from "./OpenHereChatButton.svelte";
import OpenHereWindow from "./OpenHereWindow.svelte";

const heights = getSnapHeights(844, CHAT_SHEET_SIZES);

function file(name: string): FileViewerCoWebsite {
    // The file never arrives: only the window's own frame and row are under test.
    return new FileViewerCoWebsite({
        key: `chat:blob:http://play/${name}`,
        name,
        load: () => new Promise<ArrayBuffer>(() => {}),
        download: () => Promise.resolve(),
    });
}

/** A finger on the sheet's handle: pressed at `from`, moved to `to`, let go. */
function dragHandle(handle: Element, from: number, to: number): void {
    const send = (type: string, clientY: number) => {
        const event = new MouseEvent(type, { clientY, button: 0, bubbles: true });
        Object.defineProperty(event, "pointerId", { value: 1 });
        handle.dispatchEvent(event);
    };
    send("pointerdown", from);
    send("pointermove", to);
    send("pointerup", to);
}

describe("OpenHereWindow as a phone's sheet", () => {
    let component: OpenHereWindow | undefined;
    let target: HTMLDivElement;

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
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
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
        expect(chip?.textContent?.trim()).toBe("2");
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

    it("waits behind the chat at full height when chat opens over a tucked sheet, and tucks again after", async () => {
        await mount("plan.pdf");
        openHereTuckedStore.set(true);
        await tick();

        chatVisibilityStore.set(true);
        await tick();

        expect(sheet()?.classList.contains("tucked")).toBe(false);
        expect(sheet()?.classList.contains("behind-chat")).toBe(true);
        expect(sheet()?.style.height).toBe(`${heights.full}px`);

        // A tap while the chat is over it does not bring it up.
        sheet()?.click();
        await tick();
        expect(get(openHereTuckedStore)).toBe(true);

        chatVisibilityStore.set(false);
        await tick();
        expect(sheet()?.classList.contains("tucked")).toBe(true);
    });

    it("does not follow a drag while the chat is over it", async () => {
        await mount("plan.pdf");
        chatVisibilityStore.set(true);
        await tick();

        dragHandle(handle()!, 100, 300);
        await tick();

        expect(sheet()?.style.height).toBe(`${heights.full}px`);
        expect(get(openHereTuckedStore)).toBe(false);
    });
});

describe("OpenHereWindow Esc", () => {
    let component: OpenHereWindow | undefined;
    let target: HTMLDivElement;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.append(target);
        component = new OpenHereWindow({ target, props: { floating: true } });
        closeAllOpenItems.mockClear();
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
        emoteMenuStore.closeEmoteMenu();
        expressTrayStore.close();
        lightboxOpenStore.set(false);
    });

    it("closes on Esc", async () => {
        await tick();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
        expect(closeAllOpenItems).toHaveBeenCalledTimes(1);
    });

    it("leaves an Esc to the emote picker, the express tray or a picture shown large, even when they close on it", async () => {
        await tick();
        const cases: [() => void, () => void][] = [
            [() => emoteMenuStore.openEmoteMenu(), () => emoteMenuStore.closeEmoteMenu()],
            [() => expressTrayStore.open(), () => expressTrayStore.close()],
            [() => lightboxOpenStore.set(true), () => lightboxOpenStore.set(false)],
        ];
        for (const [open, close] of cases) {
            open();
            // Runs after the window's own capture listener, as these overlays' listeners do.
            window.addEventListener("keydown", close);
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
            window.removeEventListener("keydown", close);
            expect(closeAllOpenItems).not.toHaveBeenCalled();
        }
    });
});

describe("the chat button that floats over a phone's sheet", () => {
    let component: OpenHereChatButton | undefined;
    let target: HTMLDivElement;

    const button = () => target.querySelector<HTMLButtonElement>('[data-testid="openHereChatButton"]');

    beforeEach(async () => {
        target = document.createElement("div");
        document.body.append(target);
        openChat.mockClear();
        coWebsites.add(file("plan.pdf"));
        component = new OpenHereChatButton({ target });
        await tick();
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
        coWebsites.removeAll();
        chatVisibilityStore.set(false);
        modalVisibilityStore.set(false);
        openHereTuckedStore.set(false);
        selectedRoomStore.set(undefined);
    });

    it("shows while the sheet is up, and opens the chat as the bar's button does", () => {
        expect(button()).not.toBeNull();

        button()?.click();

        expect(openChat).toHaveBeenCalledWith("button");
    });

    it("opens the proximity chat when the room's chat is off, and clears what was unread there", () => {
        scene.current.room.isChatEnabled = false;

        button()?.click();

        expect(get(selectedRoomStore)).toBe(scene.current.proximityChatRoom);
        expect(scene.current.proximityChatRoom.unreadNotificationCount.set).toHaveBeenCalledWith(0);
        scene.current.room.isChatEnabled = true;
    });

    it("is not there once the chat is open, or when the sheet is not up", async () => {
        chatVisibilityStore.set(true);
        await tick();
        expect(button()).toBeNull();

        chatVisibilityStore.set(false);
        coWebsites.removeAll();
        await tick();
        expect(button()).toBeNull();
    });

    it("stays under Orbit when it is in front of the sheet", async () => {
        sideWindowInFrontStore.set("orbit");
        modalVisibilityStore.set(true);
        await tick();

        expect(button()).toBeNull();
    });
});
