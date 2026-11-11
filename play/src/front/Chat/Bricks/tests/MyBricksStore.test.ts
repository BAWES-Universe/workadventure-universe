import { get, writable } from "svelte/store";
import type { Writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
    ensureMyBrick: vi.fn<() => Promise<unknown>>(),
    listMyBricks: vi.fn<() => Promise<unknown>>(),
    setBrickEnabled: vi.fn<(brickId: string, enabled: boolean) => Promise<unknown>>(),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: api }));
vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getChatId: () => "@omar:chat.test" },
}));
vi.mock("../../../Stores/MenuStore", async () => {
    const store = await import("svelte/store");
    return { userIsConnected: store.writable(true) };
});

import { userIsConnected } from "../../../Stores/MenuStore";
import type { ChatPerson } from "../../Stores/ChatPeopleStore";
import {
    brickPicture,
    forgetMyBricks,
    loadMyBricks,
    myBricksByChatId,
    myBricksSettled,
    myBricksStore,
    setMyBrickEnabled,
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
});
