import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => {
    let value: unknown = null;
    const subscribers = new Set<(value: unknown) => void>();
    return {
        makeMyBrick: vi.fn<(name: string, look: string) => Promise<unknown>>(),
        openBrickChat: vi.fn<(brickId: string) => Promise<unknown>>(),
        closeModal: vi.fn<() => void>(),
        warn: vi.fn<(message: string) => void>(),
        ensure: vi.fn<() => Promise<void>>(() => Promise.resolve()),
        bricks: [] as { characterTextureId: string | null }[],
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
    };
});
// The tests run Svelte's server build, where onMount does nothing; the dialog reads the WOKAs on mount.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("svelte-modals", () => ({ closeModal: game.closeModal }));
vi.mock("../../../Enum/ComputedConst", () => ({ ABSOLUTE_PUSHER_URL: "http://pusher.test/" }));
vi.mock("../../../external-modules/bots/stores/BotWokaCatalogStore", () => ({
    botWokaCatalogStore: game.catalog,
    ensureBotWokaCatalog: game.ensure,
}));
vi.mock("../../Stores/StoredWokaStore", async () => {
    const store = await import("svelte/store");
    return { storedWokaStore: () => store.readable<string | undefined>(undefined) };
});
vi.mock(
    "../../../Components/Woka/WokaImage.svelte",
    async () => await import("../../../external-modules/bots/components/testStub.svelte")
);
vi.mock("../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: game.warn } }));
vi.mock("../BrickChat", () => ({ openBrickChat: game.openBrickChat }));
// The template sheets are tested on their own (TemplateScreens.test.ts)
vi.mock("../Templates/OpenTemplates", () => ({ openTemplateList: vi.fn() }));
vi.mock("../MyBricksStore", async () => {
    const store = await import("svelte/store");
    return { makeMyBrick: game.makeMyBrick, myBricksStore: store.readable(game.bricks) };
});

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import NewBrickDialog from "../NewBrickDialog.svelte";

const WOKAS = {
    woka: {
        collections: [
            {
                name: "WOKAs",
                position: 0,
                textures: [
                    { id: "woka-ada", name: "Ada", url: "resources/ada.png", position: 0 },
                    { id: "woka-sam", name: "Sam", url: "resources/sam.png", position: 1 },
                ],
            },
        ],
    },
};

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

describe("New Brick, in the game's own dialog (#1996)", () => {
    let target: HTMLElement;
    let dialog: { $destroy: () => void } | undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        vi.clearAllMocks();
        game.catalog.set(null);
        game.bricks.length = 0;
        game.bricks.push({ characterTextureId: "brick-orange" });
        game.openBrickChat.mockResolvedValue(undefined);
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        dialog?.$destroy();
        dialog = undefined;
        target.remove();
    });

    async function open() {
        dialog = new NewBrickDialog({ target, props: { isOpen: true }, intro: false });
        await settle();
    }
    const byId = <T extends HTMLElement = HTMLElement>(id: string) => target.querySelector<T>(`[data-testid="${id}"]`);
    const all = (id: string) => [...target.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
    const nameBox = () => byId<HTMLInputElement>("newBrickName")!;
    const type = async (value: string) => {
        nameBox().value = value;
        nameBox().dispatchEvent(new Event("input", { bubbles: true }));
        await settle();
    };

    it("is a dialog called New Brick, with a name, twelve Brick looks and Create", async () => {
        await open();
        const box = byId("newBrickDialog");
        expect(box?.getAttribute("role")).toBe("dialog");
        expect(box?.getAttribute("aria-modal")).toBe("true");
        expect(target.querySelector("#new-brick-title")?.textContent).toBe("New Brick");
        expect(all("newBrickLook")).toHaveLength(12);
        expect(target.textContent).toContain("Pick its look");
        expect(target.textContent).toContain("Ready to talk as soon as you create it, on Universe AI.");
        expect(byId("newBrickCreate")?.textContent?.trim()).toBe("Create");
        expect(byId("newBrickCancel")?.textContent?.trim()).toBe("Cancel");
    });

    it("has Advanced settings under the note, as the New bot form does: a Brick's chats stay its owner's", async () => {
        await open();
        const advanced = byId("newBrickAdvanced")!;
        expect(advanced.textContent?.trim()).toBe("Advanced settings");
        expect(advanced.getAttribute("aria-expanded")).toBe("false");
        expect(byId("bot-telemetry-card")).toBeNull();
        advanced.click();
        await settle();
        expect(advanced.getAttribute("aria-expanded")).toBe("true");
        expect(byId("bot-telemetry-card")?.textContent).toContain("A Brick's chats are yours");
        expect(byId<HTMLButtonElement>("bot-telemetry-switch")?.disabled).toBe(true);
        expect(byId<HTMLButtonElement>("bot-telemetry-switch")?.getAttribute("aria-checked")).toBe("false");
    });

    it("starts on the first colour the person's Bricks do not wear, named after it", async () => {
        await open();
        // Their one Brick is orange, so red is next
        expect(nameBox().value).toBe("Red Brick");
        expect(all("newBrickLook").map((tile) => tile.getAttribute("aria-pressed"))[1]).toBe("true");
    });

    it("renames with the colour until the person writes a name of their own", async () => {
        await open();
        all("newBrickLook")[5].click();
        await settle();
        expect(nameBox().value).toBe("Teal Brick");
        await type("Recipe Brick");
        all("newBrickLook")[2].click();
        await settle();
        expect(nameBox().value).toBe("Recipe Brick");
        expect(all("newBrickLook")[2].getAttribute("aria-pressed")).toBe("true");
    });

    it("shows no tabs while the game offers no WOKAs, and Bricks and WOKAs with their counts when it does", async () => {
        await open();
        expect(byId("newBrickTabBricks")).toBeNull();
        game.catalog.set(WOKAS);
        await settle();
        expect(byId("newBrickTabBricks")?.textContent?.replace(/\s+/g, " ").trim()).toBe("Bricks 12");
        expect(byId("newBrickTabWokas")?.textContent?.replace(/\s+/g, " ").trim()).toBe("WOKAs 2");
        expect(game.ensure).toHaveBeenCalled();
    });

    it("makes a Brick that wears a WOKA, keeping the name already there", async () => {
        game.catalog.set(WOKAS);
        game.makeMyBrick.mockResolvedValue({ id: "new" });
        await open();
        byId("newBrickTabWokas")?.click();
        await settle();
        expect(all("newBrickWoka")).toHaveLength(2);
        all("newBrickWoka")[1].click();
        await settle();
        expect(nameBox().value).toBe("Red Brick");
        byId("newBrickDialog")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await settle();
        expect(game.makeMyBrick).toHaveBeenCalledWith("Red Brick", "woka-sam");
    });

    it("creates the Brick with the name and look, closes, and opens its chat", async () => {
        game.makeMyBrick.mockResolvedValue({ id: "new-brick" });
        await open();
        all("newBrickLook")[5].click();
        await type("  Recipe Brick ");
        byId("newBrickDialog")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await settle();
        expect(game.makeMyBrick).toHaveBeenCalledWith("Recipe Brick", "brick-teal");
        expect(game.closeModal).toHaveBeenCalledTimes(1);
        expect(game.openBrickChat).toHaveBeenCalledWith("new-brick");
    });

    it("cannot create a Brick with no name", async () => {
        await open();
        await type("   ");
        expect(byId<HTMLButtonElement>("newBrickCreate")?.disabled).toBe(true);
        byId("newBrickDialog")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await settle();
        expect(game.makeMyBrick).not.toHaveBeenCalled();
    });

    it("stays open and says so when the Brick could not be made", async () => {
        game.makeMyBrick.mockResolvedValue(undefined);
        await open();
        byId("newBrickDialog")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await settle();
        expect(game.warn).toHaveBeenCalledWith("Couldn't make the Brick. Try again.");
        expect(game.closeModal).not.toHaveBeenCalled();
        expect(game.openBrickChat).not.toHaveBeenCalled();
        expect(byId<HTMLButtonElement>("newBrickCreate")?.disabled).toBe(false);
    });

    it("closes on Cancel, on X and on Escape, and makes nothing", async () => {
        await open();
        byId("newBrickCancel")?.click();
        byId("newBrickClose")?.click();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(game.closeModal).toHaveBeenCalledTimes(3);
        expect(game.makeMyBrick).not.toHaveBeenCalled();
    });

    it("draws nothing while it is not open", async () => {
        dialog = new NewBrickDialog({ target, props: { isOpen: false } });
        await settle();
        expect(byId("newBrickDialog")).toBeNull();
    });
});
