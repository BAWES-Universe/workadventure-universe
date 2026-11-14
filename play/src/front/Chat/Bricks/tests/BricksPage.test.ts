import { tick } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A Brick's page is the bot page, which reads the game's settings as it loads
vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
    globalThis.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
});

vi.hoisted(() => {
    // The page reads the uploader's address from the page's environment
    (globalThis as unknown as { window: { env: Record<string, string> } }).window.env = {
        UPLOADER_URL: "http://uploader.test",
    };
});
const game = vi.hoisted(() => ({
    ensureMyBrick: vi.fn<() => Promise<unknown>>(),
    listMyBricks: vi.fn<() => Promise<unknown>>(),
    setBrickEnabled: vi.fn<(brickId: string, enabled: boolean) => Promise<unknown>>(),
    openBrickChat: vi.fn<(brickId: string) => Promise<unknown>>(),
    warn: vi.fn<(message: string) => void>(),
    deleteMyBrick: vi.fn<(brickId: string) => Promise<unknown>>(),
    undoMyBrick: vi.fn<(brickId: string) => Promise<unknown>>(),
    tellBrickChanged: vi.fn<(brickId: string) => Promise<void>>(),
    getMyUsage: vi.fn<() => Promise<unknown>>(),
    getMyApps: vi.fn<() => Promise<unknown>>(),
    getMyAppUniverses: vi.fn<() => Promise<unknown>>(),
    openModal: vi.fn<(component: unknown) => void>(),
    getBot: vi.fn<(brickId: string) => Promise<unknown>>(),
    changeMyBrick: vi.fn<(brickId: string, change: Record<string, unknown>) => Promise<unknown>>(),
    getBotAiOptions: vi.fn<(target: { botId?: string }) => Promise<unknown>>(),
    getAvailableAIProviders: vi.fn<(all?: boolean) => Promise<unknown[]>>(),
    getMyAiKeys: vi.fn<() => Promise<unknown>>(),
    getBotVoice: vi.fn<(brickId: string) => Promise<unknown>>(),
    getMyVoiceKeys: vi.fn<() => Promise<unknown>>(),
    getBotPermissions: vi.fn<(brickId: string) => Promise<unknown>>(),
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
        getBot: game.getBot,
        changeMyBrick: game.changeMyBrick,
        getBotAiOptions: game.getBotAiOptions,
        getAvailableAIProviders: game.getAvailableAIProviders,
        getMyAiKeys: game.getMyAiKeys,
        getBotVoice: game.getBotVoice,
        getMyVoiceKeys: game.getMyVoiceKeys,
        getBotPermissions: game.getBotPermissions,
        isInitialized: () => true,
        getMyMemory: () => Promise.resolve({ items: [] }),
        getBrickFiles: () => Promise.resolve({}),
        getMyUsage: game.getMyUsage,
        getMyApps: game.getMyApps,
        getMyAppUniverses: game.getMyAppUniverses,
        // The page reads a Brick's computer once its page is open: nothing to show here
        getBrickComputer: () => Promise.resolve(undefined),
    },
}));
vi.mock("../../../Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../../external-modules/admin-api/index", () => ({ canOpenOrbit: () => false, openOrbitPage: () => {} }));
// The companions the room offers: none are drawn here
vi.mock("../../../external-modules/bots/stores/BotCompanionCatalogStore", async () => {
    const store = await import("svelte/store");
    return {
        botCompanionCatalogStore: store.readable([
            { name: "Pets", textures: [{ id: "dog-2", name: "Dog", url: "resources/dog.png" }] },
        ]),
        ensureBotCompanionCatalog: () => Promise.resolve(),
        findCompanion: (
            catalog: { textures: { id: string; name: string }[] }[] | null,
            id: string | null | undefined
        ) => catalog?.flatMap((collection) => collection.textures).find((texture) => texture.id === id),
    };
});
vi.mock("../../../Enum/ComputedConst", () => ({ ABSOLUTE_PUSHER_URL: "http://pusher.test/" }));
// A Brick's page has Memory and Files groups (#2003); their own tests are in MemoryAndFiles.test.ts
vi.mock("../../../Artifacts/openYourArtifacts", () => ({ openYourArtifacts: vi.fn() }));
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
// A WOKA is drawn on a canvas, which this test environment has none of
vi.mock(
    "../../../Components/Woka/WokaImage.svelte",
    async () => await import("../../../external-modules/bots/components/testStub.svelte")
);
// The dialog has its own tests; here only that New Brick opens it
vi.mock(
    "../NewBrickDialog.svelte",
    async () => await import("../../../external-modules/bots/components/testStub.svelte")
);
// The bot page's stores read more of it as they load: anything else answers nothing
vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: new Proxy(
        {},
        { get: (_store, key) => (key === "getChatId" ? () => "@omar:chat.test" : () => undefined) }
    ),
}));
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

import { readBotVoice } from "../../../external-modules/bots/voiceModel";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import { bricksPageOpenStore } from "../../Stores/ChatStore";
import { forgetMyBricks } from "../MyBricksStore";
import { forgetMyUsage } from "../UsageStore";
import { forgetMyApps } from "../Apps/AppsStore";
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
        forgetMyUsage();
        forgetMyApps();
        game.getMyApps.mockResolvedValue({ apps: [], bricks: [] });
        game.getMyAppUniverses.mockResolvedValue({ universes: [] });
        game.getMyUsage.mockResolvedValue({
            chat: { left: 1, words: "plenty", fullAgainAt: null },
            computer: null,
            storage: null,
            extra: null,
        });
        bricksPageOpenStore.set(true);
        game.ensureMyBrick.mockResolvedValue({ brick: card(), made: false, deleted: false });
        game.listMyBricks.mockResolvedValue({ bricks: [card(), made()] });
        game.openBrickChat.mockResolvedValue(undefined);
        // Orbit's read of a Brick for its page: the whole bot, with who made it
        game.getBot.mockImplementation((id: string) =>
            Promise.resolve({
                ...(id === MADE ? made() : card()),
                chatInstructions: id === MADE ? "Keeps Mum's recipes." : null,
                aiProviderRef: "universe-ai",
                roomId: null,
                updatedAt: "2026-11-11T12:00:00.000Z",
                createdBy: { id: "u-omar", name: "Omar", email: null },
                updatedBy: { id: "u-omar", name: "Omar", email: null },
            })
        );
        // What a Brick may run on: Universe AI, and one of its owner's own keys (lent to no universe)
        game.getBotAiOptions.mockResolvedValue({
            current: "universe-ai",
            currentModel: null,
            universeAi: { available: true, model: "u-1", supportsVision: false, limits: { reply: 1000, steps: 5 } },
            maker: { id: "u-omar", name: "Omar" },
            viewerIsMaker: true,
            keys: [
                {
                    id: "key-1",
                    name: "My Claude",
                    kind: null,
                    kindLabel: "Claude",
                    logo: null,
                    plainIcon: "chip",
                    group: "hosted",
                    universeName: "",
                    status: "working",
                    ifDown: "universe-ai",
                    model: "m-1",
                    output: null,
                    supportsVision: false,
                    visionModels: [],
                    models: [{ id: "m-1" }],
                    modelsProblem: null,
                    limited: false,
                    limits: { reply: 1000, steps: 5 },
                },
            ],
            currentKey: null,
            vision: { saved: null, savedKey: null },
            providers: null,
        });
        game.getAvailableAIProviders.mockResolvedValue([]);
        game.getMyAiKeys.mockResolvedValue([{ id: "key-1", name: "My Claude" }]);
        // Its Voice: off, on Universe AI, with no key of the owner's yet
        game.getBotVoice.mockResolvedValue(
            readBotVoice({
                enabled: false,
                universeAllows: true,
                paidBy: "universe-ai",
                parts: { recognition: "universe-ai", speech: "universe-ai" },
                revision: null,
                draft: { profile: {}, updatedAt: null },
                revisions: [],
                lentKeys: [],
                universeAi: {
                    recognition: {
                        providerId: "uai-listen",
                        adapter: "soniox",
                        name: "Soniox",
                        model: "m",
                        models: [{ id: "m", label: "M" }],
                    },
                    speech: {
                        providerId: "uai-speak",
                        adapter: "elevenlabs",
                        name: "ElevenLabs",
                        model: "v",
                        models: [{ id: "v", label: "V" }],
                        defaultVoice: { voiceId: "v-river", voiceName: "River" },
                    },
                },
                voiceLimits: {
                    revision: 1,
                    limits: { turnSeconds: 30, replyCharacters: 600, replySeconds: 60, listenMinutesPerDay: 60 },
                    window: {
                        hours: 5,
                        signedIn: { replies: 30, voiceReplies: 25 },
                        guest: { replies: 10, voiceReplies: 3 },
                    },
                },
            })
        );
        game.getMyVoiceKeys.mockResolvedValue([]);
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

    it("opens a Brick's own page on a tap on its row, and with Enter, as a bot's row opens its page", async () => {
        await open();
        expect(rows()[1].getAttribute("aria-label")).toBe("Open Recipe Brick's page");
        // Nothing else on a row: its picture, name, line and switch (mock s-7)
        expect(target.querySelector('[data-testid="bricksRowMore"]')).toBeNull();
        rows()[1].click();
        await settle();
        expect(byId("brickPage")).not.toBeNull();
        expect(game.getBot).toHaveBeenCalledWith(MADE);
        expect(game.openBrickChat).not.toHaveBeenCalled();
        target.querySelector<HTMLElement>('[data-testid="edit-panel-back"]')?.click();
        await settle();
        rows()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await settle();
        expect(game.getBot).toHaveBeenLastCalledWith(BRICK);
        expect(byId("brickPage")).not.toBeNull();
    });

    it("turns a Brick off with its switch, without opening its page, and keeps the row where it is", async () => {
        game.setBrickEnabled.mockResolvedValue({ brick: made({ enabled: false }) });
        await open();
        switches()[1].click();
        await settle();
        expect(game.setBrickEnabled).toHaveBeenCalledWith(MADE, false);
        expect(byId("brickPage")).toBeNull();
        expect(switches().map((one) => one.checked)).toEqual([true, false]);
        // Still under Active until the page opens again: the row does not jump from under the finger
        expect(sections()).toEqual(["Active · 2"]);
        expect(rows()[1].classList.contains("off")).toBe(true);
        expect(game.warn).not.toHaveBeenCalled();
    });

    it("does not open the page when Space is pressed on the switch", async () => {
        await open();
        switches()[0].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        await settle();
        expect(byId("brickPage")).toBeNull();
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
        game.listMyBricks.mockRejectedValueOnce(new Error("offline"));
        await open();
        expect(byId("bricksLoadFailed")?.textContent).toBe("Couldn't load your Bricks.");
        byId("bricksTryAgain")?.click();
        await settle();
        expect(byId("bricksLoadFailed")).toBeNull();
        expect(rows()).toHaveLength(2);
        warn.mockRestore();
    });

    it("shows the Bricks the list came with, and the failed line, when the Brick everyone gets could not be asked for", async () => {
        game.ensureMyBrick.mockRejectedValueOnce(new Error("offline"));
        await open();
        expect(rows()).toHaveLength(2);
        expect(byId("bricksNone")).toBeNull();
        expect(byId("bricksLoadFailed")?.textContent).toBe("Couldn't load your Bricks.");
        byId("bricksTryAgain")?.click();
        await settle();
        expect(byId("bricksLoadFailed")).toBeNull();
        expect(rows()).toHaveLength(2);
    });

    it("says the list failed, never that they have none, when only the Brick everyone gets could be read", async () => {
        game.listMyBricks.mockRejectedValueOnce(new Error("offline"));
        await open();
        expect(rows()).toHaveLength(1);
        expect(byId("bricksNone")).toBeNull();
        expect(byId("bricksLoadFailed")?.textContent).toBe("Couldn't load your Bricks.");
        byId("bricksTryAgain")?.click();
        await settle();
        expect(byId("bricksLoadFailed")).toBeNull();
        expect(rows()).toHaveLength(2);
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

        const openPage = async (index = 1) => {
            rows()[index].click();
            await settle();
        };

        it("opens a Brick's page as the bot page: its look, name, line and switch, then its parts, then who made it", async () => {
            game.listMyBricks.mockResolvedValue({ bricks: [card(), made()], deleted: [], undoDays: 7 });
            await open();
            await openPage();
            expect(byId("bricksPage")).toBeNull();
            // "Bricks" on top, with the way back (mock d-2)
            expect(target.querySelector(".em-title")?.textContent).toBe("Bricks");
            expect(target.querySelector('[data-testid="edit-panel-back"]')?.getAttribute("aria-label")).toBe(
                "Back to Bricks"
            );
            expect(byId("brick-look")?.querySelector("img")?.getAttribute("src")).toBe(
                "/static/images/bricks/brick-orange.png"
            );
            expect(target.querySelector<HTMLInputElement>('[data-testid="bot-name"]')?.value).toBe("Recipe Brick");
            expect(target.querySelector<HTMLTextAreaElement>('[data-testid="bot-description"]')?.value).toBe(
                "Keeps the family recipes"
            );
            expect(target.querySelector<HTMLElement>('[data-testid="bot-switch"]')).not.toBeNull();
            // The parts a Brick has so far, in the mock's order (Memory and Files after Behavior). The rest come with their own issues.
            const groups = [...target.querySelectorAll<HTMLElement>('[data-testid^="bot-page-group-"]')].map(
                (group) => group.dataset.testid
            );
            expect(groups).toEqual([
                "bot-page-group-mind",
                "bot-page-group-say",
                "bot-page-group-voice",
                "bot-page-group-behavior",
                "bot-page-group-memory",
                "bot-page-group-files",
                "bot-page-group-access",
                "bot-page-group-companion",
                "bot-page-group-advanced",
            ]);
            // The rows say what the mock's say: Universe AI, none yet, stays put and waits, none yet
            expect(byId("bot-page-group-mind")?.textContent).toContain("Universe AI");
            expect(byId("bot-page-group-voice")?.textContent).toContain("Off · Give Recipe Brick a voice");
            expect(byId("bot-page-group-behavior")?.textContent).toContain("Stays put · waits for people");
            expect(byId("bot-page-group-access")?.textContent).toContain("Only you");
            expect(byId("bot-page-group-companion")?.textContent).toContain("None yet");
            expect(byId("bot-page-group-advanced")?.textContent).toContain("Bot chat telemetry off");
            expect(target.querySelector(".bp-meta")?.textContent).toMatch(/^Made by Omar · .+ · Changed .+$/);
            await click("edit-panel-back");
            expect(byId("bricksPage")).not.toBeNull();
        });

        it("keeps a Brick's chats out of telemetry: Advanced settings shows it off and locked, and reads nothing", async () => {
            await open();
            await openPage();
            byId("bot-page-group-advanced")?.querySelector<HTMLElement>("button")?.click();
            await settle();
            const card = byId("bot-telemetry-card");
            expect(card?.textContent).toContain("A Brick's chats are yours");
            expect(card?.querySelector<HTMLButtonElement>('[data-testid="bot-telemetry-switch"]')?.disabled).toBe(true);
        });

        it("saves the switch on its page through the Brick's own route, and puts it back when Orbit refused", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            game.changeMyBrick.mockResolvedValueOnce({ brick: made({ enabled: false }) });
            await open();
            await openPage();
            const pageSwitch = () => target.querySelector<HTMLInputElement>('[data-testid="bot-switch"]');
            pageSwitch()?.click();
            await settle();
            expect(game.changeMyBrick).toHaveBeenCalledWith(MADE, { enabled: false });
            expect(game.tellBrickChanged).toHaveBeenCalledWith(MADE);
            expect(pageSwitch()?.checked).toBe(false);
            expect(byId("brick-save-error")).toBeNull();

            game.changeMyBrick.mockRejectedValueOnce(new Error("offline"));
            pageSwitch()?.click();
            await settle();
            expect(pageSwitch()?.checked).toBe(false);
            expect(byId("brick-save-error")?.textContent).toBe("Could not save this. Check again in a moment.");
            warn.mockRestore();
        });

        it("saves its name, line and Personality through the Brick's own route once typing stops, only what changed", async () => {
            // Orbit keeps every change: each answer is the Brick with all of them so far
            let kept: Record<string, unknown> = {};
            game.changeMyBrick.mockImplementation((_id, change) => {
                kept = { ...kept, ...change };
                return Promise.resolve({ brick: made(kept) });
            });
            await open();
            await openPage();
            const type = (selector: string, value: string) => {
                const field = target.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
                if (!field) throw new Error(`no ${selector}`);
                field.value = value;
                field.dispatchEvent(new Event("input", { bubbles: true }));
            };
            type('[data-testid="bot-name"]', "Mum's Recipes");
            type('[data-testid="bot-description"]', "Keeps the family recipes, and Mum's.");
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 1100);
            });
            await settle();
            expect(game.changeMyBrick).toHaveBeenCalledWith(MADE, {
                description: "Keeps the family recipes, and Mum's.",
            });
            expect(game.changeMyBrick).toHaveBeenCalledWith(MADE, { name: "Mum's Recipes" });
            expect(game.changeMyBrick).toHaveBeenCalledTimes(2);
            // Back on the list, its row shows both: neither answer took back the other change
            await click("edit-panel-back");
            const row = target.querySelectorAll<HTMLElement>('[data-testid="bricksRow"]');
            const text = [...row].map((one) => one.textContent ?? "").join(" | ");
            expect(text).toContain("Mum's Recipes");
            expect(text).toContain("Keeps the family recipes, and Mum's.");
        });

        it("keeps saying a line was not saved while a later save of another field goes through", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
            await open();
            await openPage();
            const type = (selector: string, value: string) => {
                const field = target.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
                if (!field) throw new Error(`no ${selector}`);
                field.value = value;
                field.dispatchEvent(new Event("input", { bubbles: true }));
            };
            game.changeMyBrick.mockRejectedValueOnce(new Error("offline"));
            type('[data-testid="bot-description"]', "Keeps the family recipes, and Mum's.");
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 600);
            });
            await settle();
            expect(byId("brick-save-error")).not.toBeNull();

            game.changeMyBrick.mockImplementation((_id, change) => Promise.resolve({ brick: made(change) }));
            type('[data-testid="bot-name"]', "Mum's Recipes");
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 1100);
            });
            await settle();
            expect(game.changeMyBrick).toHaveBeenLastCalledWith(MADE, { name: "Mum's Recipes" });
            // The line is still not saved, and the page still says so
            expect(byId("brick-save-error")).not.toBeNull();

            // Once the line is saved, it stops saying so
            type('[data-testid="bot-description"]', "Keeps the family recipes, and Mum's!");
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 600);
            });
            await settle();
            expect(byId("brick-save-error")).toBeNull();
            warn.mockRestore();
            error.mockRestore();
        });

        it("sends a change made while a save is on its way after it, and keeps saying the failed line is unsaved", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
            await open();
            await openPage();
            const type = (selector: string, value: string) => {
                const field = target.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
                if (!field) throw new Error(`no ${selector}`);
                field.value = value;
                field.dispatchEvent(new Event("input", { bubbles: true }));
            };
            const wait = (ms: number) =>
                new Promise<void>((resolve) => {
                    setTimeout(resolve, ms);
                });
            // The line's save hangs until the test lets it fail
            let failLine: (error: Error) => void = () => undefined;
            game.changeMyBrick.mockImplementationOnce(
                () =>
                    new Promise((_resolve, reject) => {
                        failLine = reject;
                    })
            );
            type('[data-testid="bot-description"]', "Keeps the family recipes, and Mum's.");
            await wait(600);
            await settle();
            expect(game.changeMyBrick).toHaveBeenCalledTimes(1);

            // The name changes while the line is still on its way: its save waits for the line's
            game.changeMyBrick.mockImplementation((_id, change) => Promise.resolve({ brick: made(change) }));
            type('[data-testid="bot-name"]', "Mum's Recipes");
            await wait(1100);
            await settle();
            expect(game.changeMyBrick).toHaveBeenCalledTimes(1);

            failLine(new Error("offline"));
            await settle();
            await settle();
            expect(game.changeMyBrick).toHaveBeenCalledTimes(2);
            expect(game.changeMyBrick).toHaveBeenLastCalledWith(MADE, { name: "Mum's Recipes" });
            // The name was saved, the line was not: the page still says so
            expect(byId("brick-save-error")).not.toBeNull();

            // The line is sent again with the next edit, and once it is saved the page stops saying so
            type('[data-testid="bot-description"]', "Keeps the family recipes, and Mum's!");
            await wait(600);
            await settle();
            expect(game.changeMyBrick).toHaveBeenLastCalledWith(MADE, {
                description: "Keeps the family recipes, and Mum's!",
            });
            expect(byId("brick-save-error")).toBeNull();
            warn.mockRestore();
            error.mockRestore();
        });

        // The page keeps the group last opened open for the next Brick, so a group is only tapped when it is closed
        const openGroup = async (id: string) => {
            const group = byId(`bot-page-group-${id}`);
            if (group?.classList.contains("open")) return;
            group?.querySelector<HTMLElement>("button")?.click();
            await settle();
        };

        describe("its look: the circle on top opens the New Brick look picker, and a tap saves", () => {
            const pictureSrc = () => byId("brick-look")?.querySelector("img")?.getAttribute("src");

            it("saves the look on the tap that picks it, goes back to the page with it, and tells the bot server", async () => {
                game.changeMyBrick.mockImplementation((_id, change) => Promise.resolve({ brick: made(change) }));
                await open();
                await openPage();
                expect(pictureSrc()).toBe("/static/images/bricks/brick-orange.png");
                await click("brick-look");
                expect(byId("brickLookPicker")).not.toBeNull();
                expect(byId("bot-page")).toBeNull();
                // The Brick colours, the one it wears picked
                expect(target.querySelectorAll('[data-testid="brickLookTile"]')).toHaveLength(12);
                expect(target.querySelector('[data-testid="brickLookTile"][aria-pressed="true"]')).not.toBeNull();
                await click("brickLookTile", 1);
                expect(game.changeMyBrick).toHaveBeenCalledWith(MADE, { characterTextureId: "brick-red" });
                expect(game.tellBrickChanged).toHaveBeenCalledWith(MADE);
                expect(byId("brickLookPicker")).toBeNull();
                expect(pictureSrc()).toBe("/static/images/bricks/brick-red.png");
            });

            it("offers the WOKAs the game offers a bot on a second pill, and saves one the same way", async () => {
                looks.catalog.set({
                    woka: {
                        collections: [{ name: "Heroes", textures: [{ id: "woka-1", name: "Hero", url: "hero.png" }] }],
                    },
                });
                game.changeMyBrick.mockImplementation((_id, change) => Promise.resolve({ brick: made(change) }));
                await open();
                await openPage();
                await click("brick-look");
                await click("brickLookTabWokas");
                await click("brickLookWoka");
                expect(game.changeMyBrick).toHaveBeenCalledWith(MADE, { characterTextureId: "woka-1" });
                looks.catalog.set(null);
            });

            it("stays open with the look it had when Orbit refused, so the tap can be tried again, and saves nothing for the look it wears", async () => {
                const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
                game.changeMyBrick.mockRejectedValueOnce(new Error("offline"));
                await open();
                await openPage();
                await click("brick-look");
                expect(byId("brickLookError")).toBeNull();
                await click("brickLookTile", 1);
                expect(byId("brickLookPicker")).not.toBeNull();
                // It says so, instead of staying quiet
                expect(byId("brickLookError")?.textContent).toContain("Could not save this");
                // The one it wears: nothing to save, back to the page
                await click("brickLookTile", 0);
                expect(game.changeMyBrick).toHaveBeenCalledTimes(1);
                expect(byId("brickLookPicker")).toBeNull();
                expect(pictureSrc()).toBe("/static/images/bricks/brick-orange.png");
                warn.mockRestore();
            });

            it("goes back to the page without saving on Back", async () => {
                await open();
                await openPage();
                await click("brick-look");
                await click("brickLookBack");
                expect(byId("brickLookPicker")).toBeNull();
                expect(game.changeMyBrick).not.toHaveBeenCalled();
            });
        });

        describe("Mind, Behavior and Companion save on the Brick, through its own route", () => {
            beforeEach(() => {
                game.changeMyBrick.mockImplementation((_id, change) => Promise.resolve({ brick: made(change) }));
            });

            it("puts it on one of its owner's own keys, said as 'Your key. You pay.', never as lent to a universe", async () => {
                await open();
                await openPage();
                await openGroup("mind");
                expect(game.getBotAiOptions).toHaveBeenCalledWith({ botId: MADE });
                expect(byId("bot-runs-on")?.textContent).toContain("Your key. You pay.");
                expect(text()).not.toContain("lent");
                expect(text()).not.toContain("this universe");
                await click("bot-runs-on-mine");
                expect(game.changeMyBrick).toHaveBeenCalledWith(
                    MADE,
                    expect.objectContaining({ aiProviderRef: "key-1" })
                );
            });

            it("saves how it behaves, only the keys that changed, and offers no route to walk", async () => {
                await open();
                await openPage();
                await openGroup("behavior");
                expect(byId("bot-moves-route")).toBeNull();
                // A Brick stands on no map, so nothing tells it to drag the bot on the map.
                expect(byId("bot-page-group-behavior")?.textContent).not.toContain("on the map");
                expect(byId("bot-page-group-behavior")?.textContent).not.toContain("facing direction");
                expect(byId("bot-page-group-behavior")?.textContent).toContain("These settings apply when you bring");
                await click("bot-moves-wander");
                expect(byId("bot-page-group-behavior")?.textContent).not.toContain("circle");
                expect(game.changeMyBrick).toHaveBeenCalledTimes(1);
                const change = game.changeMyBrick.mock.calls[0][1] as {
                    behaviorType: string;
                    behaviorConfig: Record<string, unknown>;
                };
                expect(change.behaviorType).toBe("social");
                expect(change.behaviorConfig).toMatchObject({ moves: "wander", goesToPeople: false });
                expect(Object.keys(change.behaviorConfig).sort()).toEqual(
                    ["assignedSpace", "behaviorType", "goesToPeople", "moves"].sort()
                );
            });

            it("puts what it shows back to what was saved when Orbit refuses a change", async () => {
                const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
                game.changeMyBrick.mockRejectedValueOnce(new Error("offline"));
                await open();
                await openPage();
                await openGroup("behavior");
                await click("bot-moves-wander");
                expect(byId("brick-save-error")).not.toBeNull();
                expect(byId("bot-page-group-behavior")?.textContent).toContain("Stays put");
                warn.mockRestore();
            });

            it("picks its companion from the room's list and saves it; None takes it away", async () => {
                await open();
                await openPage();
                await openGroup("companion");
                expect(byId("bot-companion-picker")).not.toBeNull();
                await click("bot-companion-dog-2");
                await click("bot-companion-save");
                expect(game.changeMyBrick).toHaveBeenCalledWith(MADE, { companionTextureId: "dog-2" });
                expect(byId("bot-companion-picker")).toBeNull();
                expect(byId("bot-page-group-companion")?.textContent).toContain("Dog");
                await openGroup("companion");
                await click("bot-companion-none");
                await click("bot-companion-save");
                expect(game.changeMyBrick).toHaveBeenLastCalledWith(MADE, { companionTextureId: null });
                expect(byId("bot-page-group-companion")?.textContent).toContain("None yet");
            });
        });

        describe("Voice and Permissions (Slice 13)", () => {
            it("reads its voice from Orbit, runs on its owner's own keys, and never says a key is lent to a universe", async () => {
                await open();
                await openPage();
                expect(game.getBotVoice).toHaveBeenCalledWith(MADE);
                await openGroup("voice");
                expect(byId("bot-voice-switch")).not.toBeNull();
                expect(text()).not.toContain("lent");
                expect(text()).not.toContain("this universe");
            });

            it("says 'Only you' for Permissions, because it is on no map, and asks Orbit for no roles or rules", async () => {
                await open();
                await openPage();
                expect(game.getBotPermissions).not.toHaveBeenCalled();
                await openGroup("access");
                expect(byId("brick-access")?.textContent).toContain("Only you for now");
                expect(byId("brick-access")?.textContent).toContain("talks with you and nobody else");
                expect(byId("brick-access")?.textContent).toContain("the place’s rules decide who can talk with");
                // A visiting Brick has no rules of its own (Orbit #927): nothing promises a role editor here
                expect(byId("brick-access")?.textContent).not.toContain("roles");
                // No Private switch, no rows to add, no refused line: those are for people it can reach
                expect(byId("bot-visibility")).toBeNull();
                expect(byId("bot-access-add")).toBeNull();
                expect(byId("bot-access-reply")).toBeNull();
                expect(game.getBotPermissions).not.toHaveBeenCalled();
            });
        });

        it("says so when the Brick could not be read, and reads it again on a tap", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            game.getBot.mockRejectedValueOnce(new Error("offline"));
            await open();
            await openPage();
            expect(byId("brickPageFailed")?.textContent?.trim()).toBe("Couldn't load this Brick.");
            await click("brickPageTryAgain");
            expect(byId("brickPageFailed")).toBeNull();
            expect(target.querySelector<HTMLInputElement>('[data-testid="bot-name"]')?.value).toBe("Recipe Brick");
            warn.mockRestore();
        });

        it("can still delete a Brick that could not be read, from what its row knows", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            game.getBot.mockRejectedValueOnce(new Error("offline"));
            await open();
            await openPage();
            expect(byId("brickPageFailed")).not.toBeNull();
            await click("brickDelete");
            expect(byId("brickDeleteAsk")?.textContent).toContain("Recipe Brick");
            warn.mockRestore();
        });

        it("asks once before deleting: what goes, what stays, and until when Undo works", async () => {
            game.listMyBricks.mockResolvedValue({ bricks: [card(), made()], deleted: [], undoDays: 7 });
            await open();
            await openPage();
            expect(byId("brickDeleteAsk")).toBeNull();
            await click("brickDelete");
            const ask = byId("brickDeleteAsk")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
            expect(ask).toContain("Delete Recipe Brick?");
            expect(ask).toContain(
                "Its chat, what it remembers, its goals and tasks and its computer's files go. Everything it made stays in Your artifacts."
            );
            // Nothing to download while it has no computer files
            expect(byId("brickDeleteFiles")).toBeNull();
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
            await openPage();
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
            await openPage();
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
            await openPage();
            await click("brickDelete");
            await click("brickDeleteConfirm");
            expect(game.warn).toHaveBeenCalledWith("Couldn't delete the Brick. Try again.");
            expect(byId("brickPage")).not.toBeNull();
        });
    });

    describe("the Usage row (#1999)", () => {
        it("sits under the list and says in a line where the Universe AI bar is", async () => {
            await open();
            const row = byId("bricksUsageRow");
            expect(row?.textContent?.replace(/\s+/g, " ").trim()).toBe("Usage Universe AI · plenty left");
        });

        it("says when it is low, and when it is full again", async () => {
            game.getMyUsage.mockResolvedValue({
                chat: { left: 0.1, words: "low", fullAgainAt: new Date(Date.now() + 3_600_000).toISOString() },
                computer: null,
                storage: null,
                extra: null,
            });
            await open();
            expect(byId("bricksUsageRow")?.textContent).toMatch(/Universe AI · almost used up · full again at /);
        });

        it("still works when the usage could not be read", async () => {
            game.getMyUsage.mockRejectedValue(new Error("down"));
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            await open();
            warn.mockRestore();
            expect(byId("bricksUsageRow")?.textContent?.replace(/\s+/g, " ").trim()).toBe("Usage Universe AI");
        });

        it("opens the Usage page, and Back returns to the Bricks", async () => {
            await open();
            byId("bricksUsageRow")?.querySelector<HTMLElement>("button")?.click();
            await settle();
            expect(byId("usagePage")).not.toBeNull();
            expect(byId("bricksPage")).toBeNull();
            target.querySelector<HTMLElement>('[data-testid="edit-panel-back"]')?.click();
            await settle();
            expect(byId("usagePage")).toBeNull();
            expect(rows()).toHaveLength(2);
        });
    });

    describe("the Apps row (#2001)", () => {
        const app = (name: string, id = name.toLowerCase()) => ({
            id,
            name,
            authType: "oauth",
            source: "catalog",
            connected: true,
            reconnectRequired: false,
            signInLostAt: null,
            connectedAt: "2026-11-10T09:00:00.000Z",
            lendable: false,
            kind: "mcp",
            keyLast4: null,
            keyMode: null,
            bricks: [],
        });

        it("sits above the Usage row and says what could be connected while nothing is", async () => {
            await open();
            expect(byId("bricksAppsRow")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
                "Apps Connect email, calendar, GitHub and more"
            );
        });

        it("names the connected apps, and counts the rest", async () => {
            game.getMyApps.mockResolvedValue({
                apps: [app("Gmail"), app("Google Calendar"), app("GitHub"), app("Notion"), app("Slack")],
                bricks: [],
            });
            await open();
            expect(byId("bricksAppsRow")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
                "Apps Gmail, Google Calendar, GitHub and 2 more"
            );
        });

        it("opens the Apps page, and Back returns to the Bricks", async () => {
            await open();
            byId("bricksAppsRow")?.querySelector<HTMLElement>("button")?.click();
            await settle();
            expect(byId("appsPage")).not.toBeNull();
            expect(byId("bricksPage")).toBeNull();
            target.querySelector<HTMLElement>('[data-testid="edit-panel-back"]')?.click();
            await settle();
            expect(byId("appsPage")).toBeNull();
            expect(rows()).toHaveLength(2);
        });
    });
});
