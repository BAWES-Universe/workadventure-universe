import { get, writable } from "svelte/store";
import type { Writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
    ensureMyBrick: vi.fn<() => Promise<unknown>>(),
    listMyBricks: vi.fn<() => Promise<unknown>>(),
    setBrickEnabled: vi.fn<(brickId: string, enabled: boolean) => Promise<unknown>>(),
    makeMyBrick: vi.fn<(brick: { name: string; characterTextureId?: string }) => Promise<unknown>>(),
    deleteMyBrick: vi.fn<(brickId: string) => Promise<unknown>>(),
    undoMyBrick: vi.fn<(brickId: string) => Promise<unknown>>(),
    tellBrickChanged: vi.fn<(brickId: string) => Promise<void>>(),
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
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: api }));
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
// The person's chat address: null until their chat signed in
const me = vi.hoisted(() => ({ chatId: "@omar:chat.test" as string | null }));
vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getChatId: () => me.chatId },
}));
vi.mock("../../../Stores/MenuStore", async () => {
    const store = await import("svelte/store");
    return { userIsConnected: store.writable(true) };
});

import { userIsConnected } from "../../../Stores/MenuStore";
import type { ChatPerson } from "../../Stores/ChatPeopleStore";
import {
    brickPicture,
    brickUndoDays,
    deleteMyBrick,
    forgetMyBricks,
    loadMyBricks,
    makeMyBrick,
    myBricksByChatId,
    myBricksListFailed,
    myBricksSettled,
    myBricksStore,
    myDeletedBrickChatIds,
    myDeletedBricksStore,
    refreshMyChatId,
    setMyBrickEnabled,
    undoMyBrick,
    withMyBricks,
} from "../MyBricksStore";

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
const made = card({ id: MADE, name: "Recipe Brick", description: "Keeps the family recipes", isDefault: false });

describe("a person's own Bricks", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        forgetMyBricks();
        (userIsConnected as unknown as Writable<boolean>).set(true);
        api.ensureMyBrick.mockResolvedValue({ brick: card(), made: false, deleted: false });
        api.listMyBricks.mockResolvedValue({ bricks: [card(), made] });
    });

    it("are unknown until Orbit was asked, then the one everyone gets and the ones they made", async () => {
        expect(get(myBricksStore)).toBeUndefined();
        expect(get(myBricksSettled)).toBe(false);
        await loadMyBricks();
        expect(get(myBricksStore)?.map((brick) => brick.name)).toEqual(["Brick", "Recipe Brick"]);
        expect(get(myBricksSettled)).toBe(true);
        // The Brick everyone gets is asked for first: that is what makes it, once per account
        expect(api.ensureMyBrick.mock.invocationCallOrder[0]).toBeLessThan(
            api.listMyBricks.mock.invocationCallOrder[0]
        );
    });

    it("are asked for once however many parts of the chat open at the same moment", async () => {
        await Promise.all([loadMyBricks(), loadMyBricks(), loadMyBricks()]);
        expect(api.ensureMyBrick).toHaveBeenCalledTimes(1);
        expect(api.listMyBricks).toHaveBeenCalledTimes(1);
        await loadMyBricks();
        expect(api.ensureMyBrick).toHaveBeenCalledTimes(2);
    });

    it("are never asked for on behalf of a guest", async () => {
        (userIsConnected as unknown as Writable<boolean>).set(false);
        await loadMyBricks();
        expect(api.ensureMyBrick).not.toHaveBeenCalled();
        expect(api.listMyBricks).not.toHaveBeenCalled();
        expect(get(myBricksStore)).toBeUndefined();
    });

    it("still show the one everyone gets when the list cannot be read", async () => {
        api.listMyBricks.mockRejectedValue(new Error("offline"));
        await loadMyBricks();
        expect(get(myBricksStore)?.map((brick) => brick.id)).toEqual([BRICK]);
    });

    it("are none for someone who deleted their Brick on purpose: it is not made again", async () => {
        api.ensureMyBrick.mockResolvedValue({ brick: null, made: false, deleted: true });
        api.listMyBricks.mockResolvedValue({ bricks: [] });
        await loadMyBricks();
        expect(get(myBricksStore)).toEqual([]);
    });

    it("stay unknown when Orbit cannot be reached, without failing whoever asked, and are asked for again later", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        api.ensureMyBrick.mockRejectedValueOnce(new Error("offline"));
        await expect(loadMyBricks()).resolves.toBeUndefined();
        expect(get(myBricksStore)).toBeUndefined();
        expect(get(myBricksSettled)).toBe(true);
        await loadMyBricks();
        expect(get(myBricksStore)).toHaveLength(2);
        warn.mockRestore();
    });

    it("say the list failed, rather than none, when it can't be read and Orbit gave no Brick", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        api.ensureMyBrick.mockResolvedValue({ brick: null, made: false, deleted: true });
        api.listMyBricks.mockRejectedValue(new Error("offline"));
        await loadMyBricks();
        // Unknown, so the page says it couldn't load them and offers Try again
        expect(get(myBricksStore)).toBeUndefined();
        expect(get(myBricksSettled)).toBe(true);
        warn.mockRestore();
    });

    it("say the list failed when only the one everyone gets could be read, and stop saying so once it is read", async () => {
        api.listMyBricks.mockRejectedValueOnce(new Error("offline"));
        await loadMyBricks();
        expect(get(myBricksStore)?.map((brick) => brick.id)).toEqual([BRICK]);
        expect(get(myBricksListFailed)).toBe(true);
        await loadMyBricks();
        expect(get(myBricksStore)).toHaveLength(2);
        expect(get(myBricksListFailed)).toBe(false);
    });

    it("keep the Bricks they made when a later list can't be read", async () => {
        await loadMyBricks();
        api.listMyBricks.mockRejectedValueOnce(new Error("offline"));
        await loadMyBricks();
        expect(get(myBricksStore)?.map((brick) => brick.id)).toEqual([BRICK, MADE]);
    });

    it("change nothing when a read that was on its way ends after the person signed out", async () => {
        let answer: (value: unknown) => void = () => undefined;
        api.ensureMyBrick.mockReturnValueOnce(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const reading = loadMyBricks();
        forgetMyBricks();
        answer({ brick: card() });
        await reading;
        expect(get(myBricksStore)).toBeUndefined();
        expect(get(myBricksSettled)).toBe(false);
        // A read asked for after signing in again is a new one
        await loadMyBricks();
        expect(get(myBricksStore)).toHaveLength(2);
    });

    it("keep what was known when a later read fails", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        await loadMyBricks();
        api.ensureMyBrick.mockRejectedValueOnce(new Error("offline"));
        await loadMyBricks();
        expect(get(myBricksStore)).toHaveLength(2);
        warn.mockRestore();
    });

    it("are found by their chat address, on the person's own chat server", async () => {
        await loadMyBricks();
        const byChatId = get(myBricksByChatId);
        expect([...byChatId.keys()]).toEqual([`@bot_${BRICK}:chat.test`, `@bot_${MADE}:chat.test`]);
        expect(byChatId.get(`@bot_${MADE}:chat.test`)?.name).toBe("Recipe Brick");
    });

    it("are found by their chat address once the chat signs in, even when they were read before it did", async () => {
        me.chatId = null;
        const seen: number[] = [];
        const stop = myBricksByChatId.subscribe((byChatId) => seen.push(byChatId.size));
        try {
            await loadMyBricks();
            expect(get(myBricksByChatId).size).toBe(0);
            me.chatId = "@omar:chat.test";
            refreshMyChatId();
            expect([...get(myBricksByChatId).keys()]).toEqual([`@bot_${BRICK}:chat.test`, `@bot_${MADE}:chat.test`]);
            expect(seen.at(-1)).toBe(2);
        } finally {
            stop();
            me.chatId = "@omar:chat.test";
        }
    });
});

describe("turning a Brick on or off", () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        forgetMyBricks();
        (userIsConnected as unknown as Writable<boolean>).set(true);
        api.ensureMyBrick.mockResolvedValue({ brick: card(), made: false, deleted: false });
        api.listMyBricks.mockResolvedValue({ bricks: [card(), made] });
        await loadMyBricks();
    });

    const enabled = (id: string) => get(myBricksStore)?.find((brick) => brick.id === id)?.enabled;

    it("moves the switch at once, and keeps what Orbit saved", async () => {
        let answer: (value: unknown) => void = () => undefined;
        api.setBrickEnabled.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const saving = setMyBrickEnabled(MADE, false);
        expect(enabled(MADE)).toBe(false);
        expect(enabled(BRICK)).toBe(true);
        answer({ brick: { ...made, enabled: false, name: "Recipe Brick 2" } });
        await expect(saving).resolves.toBe(true);
        expect(api.setBrickEnabled).toHaveBeenCalledWith(MADE, false);
        expect(get(myBricksStore)?.find((brick) => brick.id === MADE)).toMatchObject({
            enabled: false,
            name: "Recipe Brick 2",
        });
    });

    it("puts the switch back when Orbit refuses, and says it was not saved", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        api.setBrickEnabled.mockRejectedValue(new Error("API error: 500"));
        await expect(setMyBrickEnabled(BRICK, false)).resolves.toBe(false);
        expect(enabled(BRICK)).toBe(true);
        warn.mockRestore();
    });

    it("keeps the switch where the person put it when Orbit's answer cannot be read", async () => {
        api.setBrickEnabled.mockResolvedValue({ ok: true });
        await expect(setMyBrickEnabled(BRICK, false)).resolves.toBe(true);
        expect(enabled(BRICK)).toBe(false);
    });
});

describe("how the chat draws a person's own Bricks", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        forgetMyBricks();
        (userIsConnected as unknown as Writable<boolean>).set(true);
        api.ensureMyBrick.mockResolvedValue({ brick: card(), made: false, deleted: false });
        api.listMyBricks.mockResolvedValue({ bricks: [card(), made] });
    });

    it("has one picture store per look, so a list that reads it again does not redraw", () => {
        expect(brickPicture("brick-orange")).toBe(brickPicture("brick-orange"));
        expect(brickPicture(null)).toBe(brickPicture("brick-orange"));
        expect(get(brickPicture("brick-orange"))).toBe("/static/images/bricks/brick-orange.png");
    });

    it("adds each Brick's name and picture to the people the chat knows", async () => {
        const sara: ChatPerson = { name: "Sara" };
        const people = writable(new Map<string, ChatPerson>([["@sara:chat.test", sara]]));
        const all = withMyBricks(people);
        // Before the Bricks are known the chat's own people pass through untouched
        expect(get(all)).toBe(get(people));
        await loadMyBricks();
        const known = get(all);
        expect(known.get("@sara:chat.test")).toBe(sara);
        expect(known.get(`@bot_${BRICK}:chat.test`)?.name).toBe("Brick");
        expect(get(known.get(`@bot_${MADE}:chat.test`)?.picture ?? writable(undefined))).toBe(
            "/static/images/bricks/brick-orange.png"
        );
        // What the chat was told about people is never changed
        expect(get(people).size).toBe(1);
    });

    it("names a Brick as its owner named it, whatever the chat server still calls it", async () => {
        await loadMyBricks();
        const stale = writable(new Map<string, ChatPerson>([[`@bot_${MADE}:chat.test`, { name: "Old name" }]]));
        expect(get(withMyBricks(stale)).get(`@bot_${MADE}:chat.test`)?.name).toBe("Recipe Brick");
    });

    it("works where the chat knows nobody yet", async () => {
        await loadMyBricks();
        expect(get(withMyBricks(undefined)).size).toBe(2);
    });

    describe("more Bricks, and deleting one with Undo (#1996)", () => {
        const STUDIO = "2d9e3f40-3333-4444-8555-b66677778888";
        const gone = card({
            id: STUDIO,
            name: "Studio Brick",
            isDefault: false,
            enabled: false,
            deletedAt: "2026-11-10T09:00:00.000Z",
            goneAt: "2026-11-17T09:00:00.000Z",
        });

        beforeEach(() => {
            api.tellBrickChanged.mockResolvedValue(undefined);
            looks.catalog.set(null);
        });

        it("reads the deleted Bricks and how long they wait with the list", async () => {
            api.listMyBricks.mockResolvedValue({ bricks: [card(), made], deleted: [gone], undoDays: 7 });
            await loadMyBricks();
            expect(get(myDeletedBricksStore).map((brick) => [brick.name, brick.goneAt])).toEqual([
                ["Studio Brick", "2026-11-17T09:00:00.000Z"],
            ]);
            expect(get(brickUndoDays)).toBe(7);
            expect([...get(myDeletedBrickChatIds)]).toEqual([`@bot_${STUDIO}:chat.test`]);
            // A deleted Brick is not one of the person's Bricks: its chat is not drawn as a Brick's
            expect(get(myBricksByChatId).has(`@bot_${STUDIO}:chat.test`)).toBe(false);
        });

        it("keeps what was known of the deleted Bricks when the list can't be read", async () => {
            api.listMyBricks.mockResolvedValue({ bricks: [card()], deleted: [gone], undoDays: 7 });
            await loadMyBricks();
            api.listMyBricks.mockRejectedValue(new Error("offline"));
            await loadMyBricks();
            expect(get(myDeletedBricksStore)).toHaveLength(1);
            expect(get(brickUndoDays)).toBe(7);
        });

        it("makes a Brick with the name and look picked, and has it in the list at once", async () => {
            await loadMyBricks();
            const teal = card({ id: STUDIO, name: "Teal Brick", characterTextureId: "brick-teal", isDefault: false });
            api.makeMyBrick.mockResolvedValue({ brick: teal });
            expect((await makeMyBrick("Teal Brick", "brick-teal"))?.id).toBe(STUDIO);
            expect(api.makeMyBrick).toHaveBeenCalledWith({ name: "Teal Brick", characterTextureId: "brick-teal" });
            expect(get(myBricksStore)?.map((brick) => brick.name)).toEqual(["Brick", "Recipe Brick", "Teal Brick"]);
            expect(get(myBricksByChatId).get(`@bot_${STUDIO}:chat.test`)?.name).toBe("Teal Brick");
        });

        it("makes nothing and changes nothing when Orbit refuses", async () => {
            await loadMyBricks();
            api.makeMyBrick.mockRejectedValue(new Error("400"));
            expect(await makeMyBrick("Teal Brick", "brick-teal")).toBeUndefined();
            api.makeMyBrick.mockResolvedValue({ error: "nope" });
            expect(await makeMyBrick("Teal Brick", "brick-teal")).toBeUndefined();
            expect(get(myBricksStore)).toHaveLength(2);
        });

        it("moves a deleted Brick under Deleted at once, and tells the bot server so it stops now", async () => {
            await loadMyBricks();
            api.deleteMyBrick.mockResolvedValue({
                brick: {
                    ...made,
                    enabled: false,
                    deletedAt: "2026-11-11T18:00:00.000Z",
                    goneAt: "2026-11-18T18:00:00.000Z",
                },
            });
            expect(await deleteMyBrick(MADE)).toBe(true);
            expect(get(myBricksStore)?.map((brick) => brick.name)).toEqual(["Brick"]);
            expect(get(myDeletedBricksStore).map((brick) => brick.id)).toEqual([MADE]);
            expect(api.tellBrickChanged).toHaveBeenCalledWith(MADE);
            expect(get(myDeletedBrickChatIds).has(`@bot_${MADE}:chat.test`)).toBe(true);
        });

        it("leaves the Brick where it is when it could not be deleted", async () => {
            await loadMyBricks();
            api.deleteMyBrick.mockRejectedValue(new Error("offline"));
            expect(await deleteMyBrick(MADE)).toBe(false);
            expect(get(myBricksStore)).toHaveLength(2);
            expect(get(myDeletedBricksStore)).toHaveLength(0);
            expect(api.tellBrickChanged).not.toHaveBeenCalled();
        });

        it("brings a Brick back with Undo, into the list and out of Deleted", async () => {
            api.listMyBricks.mockResolvedValue({ bricks: [card()], deleted: [gone], undoDays: 7 });
            await loadMyBricks();
            api.undoMyBrick.mockResolvedValue({ brick: card({ id: STUDIO, name: "Studio Brick", isDefault: false }) });
            expect(await undoMyBrick(STUDIO)).toBe(true);
            expect(get(myDeletedBricksStore)).toHaveLength(0);
            expect(get(myBricksStore)?.map((brick) => brick.name)).toEqual(["Brick", "Studio Brick"]);
            expect(api.tellBrickChanged).toHaveBeenCalledWith(STUDIO);
        });

        it("keeps the Brick under Deleted when Undo did not work (its day may have passed)", async () => {
            api.listMyBricks.mockResolvedValue({ bricks: [card()], deleted: [gone], undoDays: 7 });
            await loadMyBricks();
            api.undoMyBrick.mockRejectedValue(new Error("404"));
            expect(await undoMyBrick(STUDIO)).toBe(false);
            expect(get(myDeletedBricksStore)).toHaveLength(1);
        });

        it("keeps Undo until the list says the Brick is back, when Orbit's answer does not say it", async () => {
            api.listMyBricks.mockResolvedValue({ bricks: [card()], deleted: [gone], undoDays: 7 });
            await loadMyBricks();
            api.undoMyBrick.mockResolvedValue({});
            expect(await undoMyBrick(STUDIO)).toBe(false);
            expect(get(myDeletedBricksStore)).toHaveLength(1);
            api.listMyBricks.mockResolvedValue({
                bricks: [card(), card({ id: STUDIO, isDefault: false })],
                deleted: [],
            });
            expect(await undoMyBrick(STUDIO)).toBe(true);
            expect(get(myDeletedBricksStore)).toHaveLength(0);
        });

        it("does not wait for the bot server: Undo is done when Orbit brought the Brick back", async () => {
            api.listMyBricks.mockResolvedValue({ bricks: [card()], deleted: [gone], undoDays: 7 });
            await loadMyBricks();
            api.tellBrickChanged.mockReturnValueOnce(
                new Promise<void>(() => {
                    // never answers
                })
            );
            api.undoMyBrick.mockResolvedValue({ brick: card({ id: STUDIO, isDefault: false }) });
            expect(await undoMyBrick(STUDIO)).toBe(true);
        });

        it("draws a Brick that wears a WOKA from the WOKAs the game offers, once they are read", () => {
            const picture = brickPicture("woka-ada");
            const seen: (string | undefined)[] = [];
            const stop = picture.subscribe((value) => seen.push(value));
            expect(looks.ensure).toHaveBeenCalled();
            expect(seen).toEqual([undefined]);
            looks.catalog.set({
                woka: {
                    collections: [
                        {
                            name: "WOKAs",
                            position: 0,
                            textures: [{ id: "woka-ada", name: "Ada", url: "resources/ada.png", position: 0 }],
                        },
                    ],
                },
            });
            expect(seen[seen.length - 1]).toBe("drawn:http://pusher.test/resources/ada.png");
            stop();
            expect(brickPicture("woka-ada")).toBe(picture);
        });
    });
});
