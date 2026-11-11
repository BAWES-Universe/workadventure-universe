import { tick } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    ensureMyBrick: vi.fn<() => Promise<unknown>>(),
    listMyBricks: vi.fn<() => Promise<unknown>>(),
    setBrickEnabled: vi.fn<(brickId: string, enabled: boolean) => Promise<unknown>>(),
    openBrickChat: vi.fn<(brickId: string) => Promise<unknown>>(),
    warn: vi.fn<(message: string) => void>(),
}));
// The tests run Svelte's server build, where onMount does nothing; the page reads the Bricks on mount.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: {
        ensureMyBrick: game.ensureMyBrick,
        listMyBricks: game.listMyBricks,
        setBrickEnabled: game.setBrickEnabled,
    },
}));
vi.mock("../../../Connection/LocalUserStore", () => ({ localUserStore: { getChatId: () => "@omar:chat.test" } }));
vi.mock("../../../Stores/MenuStore", async () => {
    const store = await import("svelte/store");
    return { userIsConnected: store.writable(true) };
});
vi.mock("../../../Stores/MobileLayoutStore", async () => {
    const store = await import("svelte/store");
    // A phone: where the editor's header would show its "hide the panel" chevron
    return { mobileLayoutStore: store.writable(true) };
});
vi.mock("../../../Stores/MapEditorStore", async () => {
    const store = await import("svelte/store");
    return { mapEditorVisibilityStore: store.writable(false) };
});
vi.mock("../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: game.warn } }));
vi.mock("../../Stores/ChatStore", async () => {
    const store = await import("svelte/store");
    return { bricksPageOpenStore: store.writable(true) };
});
vi.mock("../BrickChat", async () => {
    const store = await import("svelte/store");
    return { openBrickChat: game.openBrickChat, openingBrickChats: store.writable(new Set<string>()) };
});

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import { bricksPageOpenStore } from "../../Stores/ChatStore";
import { forgetMyBricks } from "../MyBricksStore";
import BricksPage from "../BricksPage.svelte";

const BRICK = "0b7c1d2e-1111-4222-8333-944455556666";
const MADE = "1c8d2e3f-2222-4333-8444-a55566667777";
const card = (over: Record<string, unknown> = {}) => ({
    id: BRICK,
    name: "Brick",
    description: "Your everyday helper",
    characterTextureId: "brick-orange",
    enabled: true,
    isDefault: true,
    createdAt: "2026-11-11T10:00:00.000Z",
    ...over,
});
const made = (over: Record<string, unknown> = {}) =>
    card({ id: MADE, name: "Recipe Brick", description: "Keeps the family recipes", isDefault: false, ...over });

/** Lets the page's read of the Bricks, and Svelte's updates after it, run. */
async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
    await tick();
}

describe("the Bricks page (#1995)", () => {
    let target: HTMLElement;
    let page: { $destroy: () => void } | undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        vi.clearAllMocks();
        forgetMyBricks();
        bricksPageOpenStore.set(true);
        game.ensureMyBrick.mockResolvedValue({ brick: card(), made: false, deleted: false });
        game.listMyBricks.mockResolvedValue({ bricks: [card(), made()] });
        game.openBrickChat.mockResolvedValue(undefined);
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        page?.$destroy();
        page = undefined;
        target.remove();
    });

    async function open() {
        page = new BricksPage({ target });
        await settle();
    }
    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const byId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const rows = () => [...target.querySelectorAll<HTMLElement>('[data-testid="bricksRow"]')];
    const switches = () => [...target.querySelectorAll<HTMLInputElement>('[data-testid="bricksRowSwitch"]')];
    const sections = () =>
        [...target.querySelectorAll<HTMLElement>(".bk-sec")].map((section) =>
            section.textContent?.replace(/\s+/g, " ").trim()
        );

    it("lists the person's own Bricks, the one everyone gets first, each with its line and its switch", async () => {
        await open();
        expect(target.querySelector(".em-title")?.textContent).toBe("Bricks");
        expect(sections()).toEqual(["Active · 2"]);
        expect(rows().map((row) => row.textContent?.replace(/\s+/g, " ").trim())).toEqual([
            "Brick Your everyday helper",
            "Recipe Brick Keeps the family recipes",
        ]);
        expect(switches().map((one) => one.checked)).toEqual([true, true]);
        expect(switches()[1].getAttribute("aria-label")).toBe("Turn Recipe Brick on or off");
        expect(rows()[0].querySelector("img")?.getAttribute("src")).toBe("/static/images/bricks/brick-orange.png");
    });

    it("reads the Bricks again each time it opens, and says so while the first read is on its way", async () => {
        let answer: (value: unknown) => void = () => undefined;
        game.ensureMyBrick.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        page = new BricksPage({ target });
        await tick();
        expect(byId("bricksLoading")?.textContent).toBe("Loading your Bricks…");
        expect(rows()).toHaveLength(0);
        answer({ brick: card(), made: true, deleted: false });
        await settle();
        expect(byId("bricksLoading")).toBeNull();
        expect(rows()).toHaveLength(2);
        expect(game.ensureMyBrick).toHaveBeenCalledTimes(1);
    });

    it("has the back arrow to Chats and nothing to tuck the page away with, on a phone too", async () => {
        await open();
        expect(target.querySelector('[data-testid="edit-panel-hide"]')).toBeNull();
        const back = target.querySelector<HTMLElement>('[data-testid="edit-panel-back"]');
        expect(back?.getAttribute("aria-label")).toBe("Back to Chats");
        back?.click();
        expect(get(bricksPageOpenStore)).toBe(false);
    });

    it("opens a Brick's chat on a tap on its row, and with Enter", async () => {
        await open();
        rows()[1].click();
        expect(game.openBrickChat).toHaveBeenCalledWith(MADE);
        rows()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(game.openBrickChat).toHaveBeenLastCalledWith(BRICK);
        expect(rows()[0].getAttribute("aria-label")).toBe("Open the chat with Brick");
    });

    it("turns a Brick off with its switch, without opening its chat, and keeps the row where it is", async () => {
        game.setBrickEnabled.mockResolvedValue({ brick: made({ enabled: false }) });
        await open();
        switches()[1].click();
        await settle();
        expect(game.setBrickEnabled).toHaveBeenCalledWith(MADE, false);
        expect(game.openBrickChat).not.toHaveBeenCalled();
        expect(switches().map((one) => one.checked)).toEqual([true, false]);
        // Still under Active until the page opens again: the row does not jump from under the finger
        expect(sections()).toEqual(["Active · 2"]);
        expect(rows()[1].classList.contains("off")).toBe(true);
        expect(game.warn).not.toHaveBeenCalled();
    });

    it("does not open the chat when Space is pressed on the switch", async () => {
        await open();
        switches()[0].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        expect(game.openBrickChat).not.toHaveBeenCalled();
    });

    it("puts the switch back and says so when the change could not be saved", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        game.setBrickEnabled.mockRejectedValue(new Error("API error: 500"));
        await open();
        switches()[0].click();
        await settle();
        expect(switches()[0].checked).toBe(true);
        expect(game.warn).toHaveBeenCalledWith("Couldn't change that. Try again.");
        warn.mockRestore();
    });

    it("lists a Brick that is off under Inactive when the page opens", async () => {
        game.listMyBricks.mockResolvedValue({ bricks: [card(), made({ enabled: false })] });
        await open();
        expect(sections()).toEqual(["Active · 1", "Inactive · 1"]);
        expect(switches().map((one) => one.checked)).toEqual([true, false]);
    });

    it("folds a section shut and open again", async () => {
        await open();
        const section = target.querySelector<HTMLElement>(".bk-sec");
        section?.click();
        await tick();
        expect(rows()).toHaveLength(0);
        expect(section?.getAttribute("aria-expanded")).toBe("false");
        section?.click();
        await tick();
        expect(rows()).toHaveLength(2);
    });

    it("says when the Bricks could not be loaded, and tries again on a tap", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        game.ensureMyBrick.mockRejectedValueOnce(new Error("offline"));
        await open();
        expect(byId("bricksLoadFailed")?.textContent).toBe("Couldn't load your Bricks.");
        byId("bricksTryAgain")?.click();
        await settle();
        expect(byId("bricksLoadFailed")).toBeNull();
        expect(rows()).toHaveLength(2);
        warn.mockRestore();
    });

    it("says so to someone who has no Brick", async () => {
        game.ensureMyBrick.mockResolvedValue({ brick: null, made: false, deleted: true });
        game.listMyBricks.mockResolvedValue({ bricks: [] });
        await open();
        expect(text()).toContain("You have no Brick.");
        expect(rows()).toHaveLength(0);
    });
});
