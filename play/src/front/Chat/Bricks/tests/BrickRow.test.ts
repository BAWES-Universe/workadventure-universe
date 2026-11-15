import { tick } from "svelte";
import type { Writable } from "svelte/store";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    openBrickChat: vi.fn<(brickId: string) => Promise<unknown>>(),
    getDmStatus: vi.fn<(ids: string[]) => Promise<Record<string, string> | null>>(),
    playerName: "Khalid" as string | null,
}));
const guest = vi.hoisted(() => {
    // The last thing said in the guest's chat, a tiny store made before the modules load
    let value: unknown;
    const subscribers = new Set<(value: unknown) => void>();
    return {
        last: {
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
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: { getDmStatus: game.getDmStatus },
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
vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getChatId: () => "@khalid:chat.test", getLocalUser: () => undefined },
}));
vi.mock("../../../Stores/MenuStore", async () => {
    const store = await import("svelte/store");
    return { userIsConnected: store.writable(true) };
});
vi.mock("../../../Phaser/Game/GameManager", () => ({ gameManager: { getPlayerName: () => game.playerName } }));
vi.mock("../../Stores/ChatStore", async () => {
    const store = await import("svelte/store");
    return { chatSearchBarValue: store.writable("") };
});
vi.mock("../GuestBrickStore", async () => {
    const store = await import("svelte/store");
    return { guestBrickRoom: () => ({ last: guest.last }), guestBrickOnline: store.readable("online") };
});
vi.mock("../BrickChat", async () => {
    const store = await import("svelte/store");
    return { openBrickChat: game.openBrickChat, openingBrickChats: store.writable(new Set<string>()) };
});

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import { chatSearchBarValue } from "../../Stores/ChatStore";
import type { BrickCard } from "../Brick";
import { openingBrickChats } from "../BrickChat";
import BrickRow from "../BrickRow.svelte";

const BRICK = "0b7c1d2e-1111-4222-8333-944455556666";
const brick = (over: Partial<BrickCard> = {}): BrickCard => ({
    id: BRICK,
    name: "Brick",
    description: "Your everyday helper",
    characterTextureId: "brick-orange",
    enabled: true,
    isDefault: true,
    createdAt: new Date().toISOString(),
    hello: null,
    ...over,
});

describe("a person's own Brick in Chats, before its chat was ever opened (#1995)", () => {
    let target: HTMLElement;
    let row: { $destroy: () => void } | undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        vi.clearAllMocks();
        game.playerName = "Khalid";
        game.openBrickChat.mockResolvedValue(undefined);
        game.getDmStatus.mockResolvedValue({ [BRICK]: "online" });
        chatSearchBarValue.set("");
        (openingBrickChats as unknown as Writable<ReadonlySet<string>>).set(new Set());
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        row?.$destroy();
        row = undefined;
        target.remove();
    });

    async function show(value: BrickCard = brick()) {
        row = new BrickRow({ target, props: { brick: value } });
        await tick();
    }
    const byId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";

    it("is just there: its name, its picture, when it arrived, and its hello as the line under its name", async () => {
        await show();
        expect(byId("brickRow")).not.toBeNull();
        expect(text()).toContain("Brick");
        expect(byId("roomRowTime")?.textContent).toBe("now");
        expect(byId("roomRowPreview")?.textContent).toBe(
            "Hi Khalid, I'm Brick, your own helper in Universe. Ask me anything, or hand me a job."
        );
        expect(target.querySelector("img")?.getAttribute("src")).toBe("/static/images/bricks/brick-orange.png");
    });

    it("has no unread badge and no count: nothing was sent to anyone", async () => {
        await show();
        expect(target.querySelector('[data-testid="roomRowUnread"]')).toBeNull();
        expect(target.querySelector(".notification-badge, [data-testid='notificationBadge']")).toBeNull();
        expect(text()).not.toMatch(/\b1\b/);
    });

    it("greets without a name when the game has none", async () => {
        game.playerName = null;
        await show(brick({ name: "Recipe Brick" }));
        expect(byId("roomRowPreview")?.textContent).toBe(
            "Hi, I'm Recipe Brick, your own helper in Universe. Ask me anything, or hand me a job."
        );
    });

    it("opens the chat on a tap, with Enter and with Space", async () => {
        await show();
        byId("brickRow")?.click();
        expect(game.openBrickChat).toHaveBeenCalledTimes(1);
        expect(game.openBrickChat).toHaveBeenCalledWith(BRICK);
        byId("brickRow")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        byId("brickRow")?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        byId("brickRow")?.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
        expect(game.openBrickChat).toHaveBeenCalledTimes(3);
    });

    it("says so while the chat is being opened", async () => {
        await show();
        expect(byId("brickRowOpening")).toBeNull();
        expect(byId("brickRow")?.getAttribute("aria-busy")).toBe("false");
        (openingBrickChats as unknown as Writable<ReadonlySet<string>>).set(new Set([BRICK]));
        await tick();
        expect(byId("brickRowOpening")).not.toBeNull();
        expect(byId("brickRow")?.getAttribute("aria-busy")).toBe("true");
    });

    it("marks the part of its name that a search found", async () => {
        chatSearchBarValue.set("rec");
        await show(brick({ name: "Recipe Brick" }));
        const marked = [...target.querySelectorAll(".text-light-blue")].map((part) => part.textContent);
        expect(marked).toEqual(["Rec"]);
    });

    describe("the Brick for guests (#1997)", () => {
        const guestBrick = () => brick({ id: "guest-brick", isDefault: false, name: "Brick" });

        it("says its own fixed hello under its name until something is said, and is always online", async () => {
            guest.last.set(undefined);
            await show(guestBrick());
            expect(byId("roomRowPreview")?.textContent).toBe(
                "Hi, I'm Brick, a helper you can talk to. I can show you around and answer anything about this place."
            );
            // Its state is Universe's own, so no bot server is asked about it
            expect(game.getDmStatus).not.toHaveBeenCalled();
        });

        it("shows the last thing said in the chat the device keeps, as it changes", async () => {
            guest.last.set({ from: "brick", text: "Second row, next to Zaatar & Co.", at: Date.now() });
            await show(guestBrick());
            expect(byId("roomRowPreview")?.textContent).toBe("Second row, next to Zaatar & Co.");
            guest.last.set({ from: "guest", text: "Nice, thanks", at: Date.now() });
            await tick();
            expect(byId("roomRowPreview")?.textContent).toBe("Nice, thanks");
        });

        it("opens the chat on a tap, as every Brick's row does", async () => {
            guest.last.set(undefined);
            await show(guestBrick());
            byId("brickRow")?.click();
            expect(game.openBrickChat).toHaveBeenCalledWith("guest-brick");
        });
    });
});
