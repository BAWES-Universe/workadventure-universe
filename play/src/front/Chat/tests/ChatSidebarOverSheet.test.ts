// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

const { scene } = vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
    // An upright phone.
    window.innerWidth = 390;
    window.innerHeight = 844;
    return { scene: { current: { reposition: vi.fn() } } };
});

// The tests run Svelte's server build, where onMount does nothing; the chat needs the browser one.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));

vi.mock("../../Stores/MobileLayoutStore", async () => {
    const { writable } = await import("svelte/store");
    return { mobileLayoutStore: writable(true) };
});

vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => scene.current,
        tryGetCurrentGameScene: () => scene.current,
    },
}));

// The window's sheet is up while this says so.
vi.mock("../../Stores/OpenHereSheetStore", async (importOriginal) => {
    const { writable } = await import("svelte/store");
    return { ...(await importOriginal<Record<string, unknown>>()), openHereSheetUpStore: writable(false) };
});

vi.mock("../Components/Chat.svelte", async () => await import("./ChatStub.svelte"));

vi.mock("../../Administration/AnalyticsClient", () => ({
    analyticsClient: { chatPanelOpened: vi.fn() },
}));

vi.mock("../../../i18n/i18n-svelte", async () => (await import("../../Components/Woka/tests/i18nStub")).i18nStub);

import type { Writable } from "svelte/store";
import { chatVisibilityStore } from "../../Stores/ChatStore";
import { openHereSheetUpStore } from "../../Stores/OpenHereSheetStore";
import { getSnapHeights } from "../../Components/Sheet/BottomSheet";
import { CHAT_SHEET_SIZES } from "../ChatSheetSizes";
import { chatSheetSnapStore } from "../ChatSheetStore";
import ChatSidebar from "../ChatSidebar.svelte";

const heights = getSnapHeights(844, CHAT_SHEET_SIZES);
const sheetUp = openHereSheetUpStore as Writable<boolean>;

describe("ChatSidebar as a phone's sheet over the window's sheet", () => {
    let sidebar: ChatSidebar | undefined;
    let target: HTMLDivElement;

    const chatHeight = () => target.querySelector<HTMLElement>('[data-testid="chat"]')?.style.height;

    beforeEach(() => {
        scene.current = { reposition: vi.fn() };
        chatSheetSnapStore.set("half");
        target = document.createElement("div");
        document.body.append(target);
        sidebar = new ChatSidebar({ target });
    });

    afterEach(() => {
        sidebar?.$destroy();
        sidebar = undefined;
        target.remove();
        chatVisibilityStore.set(false);
        sheetUp.set(false);
    });

    it("opens at the height it was left at when no sheet is up", async () => {
        chatVisibilityStore.set(true);
        await tick();

        expect(chatHeight()).toBe(`${heights.half}px`);
    });

    it("opens at its lowest height while the window's sheet is up, so the window shows above it", async () => {
        sheetUp.set(true);
        chatVisibilityStore.set(true);
        await tick();

        expect(chatHeight()).toBe(`${heights.peek}px`);
    });

    it("goes back to the height it was left at once the window's sheet is gone", async () => {
        sheetUp.set(true);
        chatVisibilityStore.set(true);
        await tick();
        expect(chatHeight()).toBe(`${heights.peek}px`);

        sheetUp.set(false);
        await tick();

        expect(chatHeight()).toBe(`${heights.half}px`);
    });

    it("keeps a height a person gave it, when the window's sheet goes", async () => {
        sheetUp.set(true);
        chatVisibilityStore.set(true);
        await tick();

        // The person lifts the chat to its tallest height.
        chatSheetSnapStore.set("full");
        await tick();
        sheetUp.set(false);
        await tick();

        expect(chatHeight()).toBe(`${heights.full}px`);
    });
});
