import { tick } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    ensureMyBrick: vi.fn<() => Promise<unknown>>(),
    listMyBricks: vi.fn<() => Promise<unknown>>(),
    setBrickEnabled: vi.fn<(brickId: string, enabled: boolean) => Promise<unknown>>(),
    openBrickChat: vi.fn<(brickId: string) => Promise<unknown>>(),
    warn: vi.fn<(message: string) => void>(),
    deleteMyBrick: vi.fn<(brickId: string) => Promise<unknown>>(),
    undoMyBrick: vi.fn<(brickId: string) => Promise<unknown>>(),
    tellBrickChanged: vi.fn<(brickId: string) => Promise<void>>(),
    openModal: vi.fn<(component: unknown) => void>(),
}));
const looks = vi.hoisted(() => {
    // A tiny store, made before the modules load: the WOKAs the game offers a bot
    let value: unknown = null;
    const subscribers = new Set<(value: unknown) => void>();
    return {
        catalog: {
            subscribe(run: (value: unknown) => void) {
                subscribers.add(run);
                run(value);
                return () => subscribers.delete(run);
            },
            set(next: unknown) {
                value = next;
                subscribers.forEach((run) => run(value));
            },
        },
        ensure: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    };
});
// The tests run Svelte's server build, where onMount does nothing; the page reads the Bricks on mount.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: {
        ensureMyBrick: game.ensureMyBrick,
        listMyBricks: game.listMyBricks,
        setBrickEnabled: game.setBrickEnabled,
        deleteMyBrick: game.deleteMyBrick,
        undoMyBrick: game.undoMyBrick,
        tellBrickChanged: game.tellBrickChanged,
    },
}));
vi.mock("../../../Enum/ComputedConst", () => ({ ABSOLUTE_PUSHER_URL: "http://pusher.test/" }));
vi.mock("../../../external-modules/bots/stores/BotWokaCatalogStore", () => ({
    botWokaCatalogStore: looks.catalog,
    ensureBotWokaCatalog: looks.ensure,
}));
vi.mock("../../Stores/StoredWokaStore", async () => {
    const store = await import("svelte/store");
    return {
        storedWokaStore: (textures: { url: string }[]) =>
            store.readable<string | undefined>(`drawn:${textures[0].url}`),
    };
});
vi.mock("svelte-modals", () => ({ openModal: game.openModal, closeModal: vi.fn() }));
// The dialog has its own tests; here only that New Brick opens it
vi.mock(
    "../NewBrickDialog.svelte",
    async () => await import("../../../external-modules/bots/components/testStub.svelte")
);
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
    hello: null,
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

    describe("more Bricks, and deleting one with Undo (#1996)", () => {
        const STUDIO = "2d9e3f40-3333-4444-8555-b66677778888";
        const gone = (over: Record<string, unknown> = {}) =>
            card({
                id: STUDIO,
                name: "Studio Brick",
                description: null,
                characterTextureId: "brick-violet",
                isDefault: false,
                enabled: false,
                deletedAt: "2026-11-10T09:00:00.000Z",
                goneAt: "2026-11-17T09:00:00.000Z",
                ...over,
            });
        const click = async (id: string, index = 0) => {
            target.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)[index].click();
            await settle();
        };

        beforeEach(() => {
            game.tellBrickChanged.mockResolvedValue(undefined);
        });

        it("has New Brick on top, which opens the dialog", async () => {
            await open();
            expect(byId("bricksNew")?.textContent?.trim()).toBe("New Brick");
            await click("bricksNew");
            expect(game.openModal).toHaveBeenCalledTimes(1);
        });

        it("keeps New Brick for someone whose every Brick is gone", async () => {
            game.ensureMyBrick.mockResolvedValue({ brick: null, made: false, deleted: true });
            game.listMyBricks.mockResolvedValue({ bricks: [] });
            await open();
            expect(byId("bricksNone")?.textContent).toBe("You have no Brick.");
            expect(byId("bricksNew")).not.toBeNull();
        });

        it("lists a deleted Brick under Deleted with the day it is gone for good, and Undo", async () => {
            game.listMyBricks.mockResolvedValue({ bricks: [card(), made()], deleted: [gone()], undoDays: 7 });
            await open();
            expect(sections()).toEqual(["Active · 2", "Deleted · 1"]);
            const row = byId("bricksDeletedRow");
            expect(row?.textContent?.replace(/\s+/g, " ").trim()).toMatch(
                /^Studio Brick Gone for good on (17 Nov|Nov 17) Undo$/
            );
            expect(row?.querySelector("img")?.getAttribute("src")).toBe("/static/images/bricks/brick-violet.png");
            // Nothing to open and nothing to switch on a Brick that waits
            expect(row?.querySelector('[data-testid="bricksRowSwitch"]')).toBeNull();
            expect(rows()).toHaveLength(2);
        });

        it("brings the Brick back with Undo, into the list and out of Deleted", async () => {
            game.listMyBricks.mockResolvedValue({ bricks: [card()], deleted: [gone()], undoDays: 7 });
            game.undoMyBrick.mockResolvedValue({ brick: card({ id: STUDIO, name: "Studio Brick", isDefault: false }) });
            await open();
            await click("bricksUndo");
            expect(game.undoMyBrick).toHaveBeenCalledWith(STUDIO);
            expect(byId("bricksDeletedRow")).toBeNull();
            expect(byId("bricksDeletedTitle")).toBeNull();
            expect(rows().some((row) => row.textContent?.includes("Studio Brick"))).toBe(true);
            expect(game.warn).not.toHaveBeenCalled();
        });

        it("says so when Undo did not work, and keeps the Brick under Deleted", async () => {
            game.listMyBricks.mockResolvedValue({ bricks: [card()], deleted: [gone()], undoDays: 7 });
            game.undoMyBrick.mockRejectedValue(new Error("404"));
            await open();
            await click("bricksUndo");
            expect(game.warn).toHaveBeenCalledWith("Couldn't bring the Brick back. Try again.");
            expect(byId("bricksDeletedRow")).not.toBeNull();
        });

        it("opens a Brick's own page from the dots on its row, without opening its chat", async () => {
            game.listMyBricks.mockResolvedValue({ bricks: [card(), made()], deleted: [], undoDays: 7 });
            await open();
            const more = target.querySelectorAll<HTMLElement>('[data-testid="bricksRowMore"]');
            expect(more[1].getAttribute("aria-label")).toBe("More about Recipe Brick");
            await click("bricksRowMore", 1);
            expect(game.openBrickChat).not.toHaveBeenCalled();
            expect(byId("bricksPage")).toBeNull();
            expect(byId("brickPage")).not.toBeNull();
            expect(target.querySelector(".em-title")?.textContent).toBe("Recipe Brick");
            expect(target.querySelector('[data-testid="edit-panel-back"]')?.getAttribute("aria-label")).toBe(
                "Back to Bricks"
            );
            await click("brickPageChat");
            expect(game.openBrickChat).toHaveBeenCalledWith(MADE);
            await click("edit-panel-back");
            expect(byId("bricksPage")).not.toBeNull();
        });

        it("asks once before deleting: what goes, what stays, and until when Undo works", async () => {
            game.listMyBricks.mockResolvedValue({ bricks: [card(), made()], deleted: [], undoDays: 7 });
            await open();
            await click("bricksRowMore", 1);
            expect(byId("brickDeleteAsk")).toBeNull();
            await click("brickDelete");
            const ask = byId("brickDeleteAsk")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
            expect(ask).toContain("Delete Recipe Brick?");
            expect(ask).toContain("Its chat and what it remembers go. Everything it made stays in Your artifacts.");
            expect(byId("brickDeleteUndoLine")?.textContent?.trim()).toMatch(
                /^You can undo this until .+, on the Bricks page\.$/
            );
            expect(game.deleteMyBrick).not.toHaveBeenCalled();
            // Keep puts the question away and deletes nothing
            await click("brickDeleteKeep");
            expect(byId("brickDeleteAsk")).toBeNull();
            expect(game.deleteMyBrick).not.toHaveBeenCalled();
        });

        it("names no day when Orbit did not say how long a deleted Brick waits", async () => {
            await open();
            await click("bricksRowMore", 1);
            await click("brickDelete");
            expect(byId("brickDeleteUndoLine")?.textContent?.trim()).toBe("You can undo this on the Bricks page.");
        });

        it("deletes on Delete Brick and goes back to the list, where the Brick waits under Deleted", async () => {
            game.listMyBricks.mockResolvedValue({ bricks: [card(), made()], deleted: [], undoDays: 7 });
            game.deleteMyBrick.mockResolvedValue({
                brick: made({
                    enabled: false,
                    deletedAt: "2026-11-11T18:00:00.000Z",
                    goneAt: "2026-11-18T18:00:00.000Z",
                }),
            });
            await open();
            await click("bricksRowMore", 1);
            await click("brickDelete");
            await click("brickDeleteConfirm");
            expect(game.deleteMyBrick).toHaveBeenCalledWith(MADE);
            expect(game.tellBrickChanged).toHaveBeenCalledWith(MADE);
            expect(byId("bricksPage")).not.toBeNull();
            expect(sections()).toEqual(["Active · 1", "Deleted · 1"]);
            expect(byId("bricksDeletedRow")?.textContent).toContain("Recipe Brick");
        });

        it("says so and stays on the page when the Brick could not be deleted", async () => {
            game.deleteMyBrick.mockRejectedValue(new Error("offline"));
            await open();
            await click("bricksRowMore", 1);
            await click("brickDelete");
            await click("brickDeleteConfirm");
            expect(game.warn).toHaveBeenCalledWith("Couldn't delete the Brick. Try again.");
            expect(byId("brickPage")).not.toBeNull();
        });
    });
});
