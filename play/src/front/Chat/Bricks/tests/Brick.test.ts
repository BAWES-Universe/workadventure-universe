import { describe, expect, it, vi } from "vitest";
import {
    ASK_AGAIN_MS,
    BRICK_IDEAS_KEY,
    MAKE_IT_FOR_MS,
    ROOM_WAIT_MS,
    brickChatId,
    brickMadeAt,
    brickPageBot,
    brickPictureUrl,
    openBrickChatWith,
    parseBrickCard,
    parseBrickCards,
    parseDirectChatAnswer,
    readBrickIdeas,
    searchesForBots,
    type MakeItMemory,
    type OpenBrickChatSteps,
} from "../Brick";

const BRICK = "0b7c1d2e-1111-4222-8333-944455556666";
const ME = "@omar:chat.test";
const BRICK_CHAT = `@bot_${BRICK}:chat.test`;

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

describe("a Brick as Orbit describes it", () => {
    it("is read as it is sent", () => {
        expect(parseBrickCard(card())).toEqual(card());
    });

    it("is nothing without an id or a name", () => {
        expect(parseBrickCard(card({ id: "" }))).toBeUndefined();
        expect(parseBrickCard(card({ name: "   " }))).toBeUndefined();
        expect(parseBrickCard(null)).toBeUndefined();
        expect(parseBrickCard("Brick")).toBeUndefined();
    });

    it("is on unless Orbit says it is off, and is only the one everyone gets when Orbit says so", () => {
        expect(parseBrickCard(card({ enabled: undefined }))?.enabled).toBe(true);
        expect(parseBrickCard(card({ enabled: false }))?.enabled).toBe(false);
        expect(parseBrickCard(card({ isDefault: undefined }))?.isDefault).toBe(false);
    });

    it("has no line and no look when Orbit sends none", () => {
        const read = parseBrickCard(card({ description: "  ", characterTextureId: null }));
        expect(read?.description).toBeNull();
        expect(read?.characterTextureId).toBeNull();
    });

    it("reads the list Orbit sends, each Brick once, and nothing from anything else", () => {
        const other = card({ id: "other", name: "Recipe Brick", isDefault: false });
        expect(
            parseBrickCards({ bricks: [card(), other, card(), { name: "no id" }] }).map((brick) => brick.id)
        ).toEqual([BRICK, "other"]);
        expect(parseBrickCards({ bricks: "none" })).toEqual([]);
        expect(parseBrickCards(null)).toEqual([]);
    });

    it("knows when it was made, or 0 when Orbit did not say", () => {
        expect(brickMadeAt(card())).toBe(Date.parse("2026-11-11T10:00:00.000Z"));
        expect(brickMadeAt({ createdAt: "" })).toBe(0);
        expect(brickMadeAt({ createdAt: "yesterday-ish" })).toBe(0);
    });
});

describe("a Brick's chat address", () => {
    it("is the bot's account on the person's own chat server", () => {
        expect(brickChatId(BRICK, ME)).toBe(BRICK_CHAT);
    });

    it("is unknown without the person's own address, or with an id that cannot be an address", () => {
        expect(brickChatId(BRICK, undefined)).toBeUndefined();
        expect(brickChatId(BRICK, null)).toBeUndefined();
        expect(brickChatId(BRICK, "omar")).toBeUndefined();
        expect(brickChatId("not an id", ME)).toBeUndefined();
    });
});

describe("a Brick's picture", () => {
    it("is the game's own picture of its look, and the orange Brick for a look the game does not have", () => {
        expect(brickPictureUrl("brick-orange")).toBe("/static/images/bricks/brick-orange.png");
        expect(brickPictureUrl("brick-of-the-future")).toBe("/static/images/bricks/brick-orange.png");
        expect(brickPictureUrl(null)).toBe("/static/images/bricks/brick-orange.png");
    });
});

describe('the fixed "what I can do" answer', () => {
    it("is a bot's own plain message that carries the mark", () => {
        expect(readBrickIdeas(BRICK_CHAT, { msgtype: "m.text", [BRICK_IDEAS_KEY]: true })).toBe(true);
    });

    it("is never a person's message, a notice, or a message without the mark", () => {
        expect(readBrickIdeas(ME, { msgtype: "m.text", [BRICK_IDEAS_KEY]: true })).toBe(false);
        expect(readBrickIdeas(BRICK_CHAT, { msgtype: "m.notice", [BRICK_IDEAS_KEY]: true })).toBe(false);
        expect(readBrickIdeas(BRICK_CHAT, { msgtype: "m.text", [BRICK_IDEAS_KEY]: "true" })).toBe(false);
        expect(readBrickIdeas(BRICK_CHAT, { msgtype: "m.text" })).toBe(false);
        expect(readBrickIdeas(undefined, { msgtype: "m.text", [BRICK_IDEAS_KEY]: true })).toBe(false);
    });
});

describe('"Bot" and "Brick" in a search', () => {
    it("are the same word: either one, typed whole, looks for every bot", () => {
        for (const word of ["bot", "Bot", "BOTS", "brick", "Brick", "bricks", "  brick  "]) {
            expect(searchesForBots(word)).toBe(true);
        }
    });

    it("is not looked for while a name that starts the same way is typed, or inside other words", () => {
        for (const word of ["", "b", "bo", "bri", "brick layer", "robot", "bottle", "my brick"]) {
            expect(searchesForBots(word)).toBe(false);
        }
    });
});

describe("what the bot server says about the one chat", () => {
    it("is the chat they have, to make it with the Brick's address, or to ask again", () => {
        expect(parseDirectChatAnswer({ roomId: "!abc:chat.test" })).toEqual({ roomId: "!abc:chat.test" });
        expect(parseDirectChatAnswer({ create: true, botChatId: BRICK_CHAT })).toEqual({
            create: true,
            botChatId: BRICK_CHAT,
        });
        expect(parseDirectChatAnswer({ wait: true })).toEqual({ wait: true });
    });

    it("is no answer when it is anything else", () => {
        expect(parseDirectChatAnswer({ roomId: "abc" })).toBeUndefined();
        expect(parseDirectChatAnswer({ create: true })).toBeUndefined();
        expect(parseDirectChatAnswer({ create: true, botChatId: ME })).toBeUndefined();
        expect(parseDirectChatAnswer({ wait: "yes" })).toBeUndefined();
        expect(parseDirectChatAnswer(undefined)).toBeUndefined();
        expect(parseDirectChatAnswer("create")).toBeUndefined();
    });
});

/** A device as the opening steps see it: a clock that only moves when the steps wait, and a list of chats. */
function device(myChatId: string | undefined = ME) {
    let now = 1_000_000;
    const chats = new Set<string>();
    const rooms = new Set<string>();
    const steps = {
        myChatId,
        ask: vi.fn<(brickId: string, myChatId: string) => Promise<unknown>>(() => Promise.resolve(undefined)),
        hasChatWith: vi.fn((chatId: string) => chats.has(chatId)),
        hasRoom: vi.fn((roomId: string) => rooms.has(roomId)),
        openChatWith: vi.fn((chatId: string) => Promise.resolve<string | undefined>(`chat with ${chatId}`)),
        openRoom: vi.fn((roomId: string) => Promise.resolve<string | undefined>(`room ${roomId}`)),
        sayStillLoading: vi.fn(),
        sleep: vi.fn((ms: number) => {
            now += ms;
            return Promise.resolve();
        }),
        now: () => now,
    } satisfies OpenBrickChatSteps<string>;
    return { steps, chats, rooms, passed: () => now - 1_000_000 };
}

describe("opening the one chat of a person and their Brick", () => {
    it("opens the chat this device has, without asking anyone", async () => {
        const { steps, chats } = device();
        chats.add(BRICK_CHAT);
        await expect(openBrickChatWith(BRICK, steps)).resolves.toBe(`chat with ${BRICK_CHAT}`);
        expect(steps.ask).not.toHaveBeenCalled();
    });

    it("asks the bot server first when this device has none, and makes the chat when told to", async () => {
        const { steps } = device();
        steps.ask.mockResolvedValue({ create: true, botChatId: BRICK_CHAT });
        await expect(openBrickChatWith(BRICK, steps)).resolves.toBe(`chat with ${BRICK_CHAT}`);
        expect(steps.ask).toHaveBeenCalledWith(BRICK, ME);
        expect(steps.openChatWith).toHaveBeenCalledTimes(1);
    });

    it("opens the chat the bot server knows once it has reached this device, and never makes a second one", async () => {
        const { steps, rooms } = device();
        steps.ask.mockResolvedValue({ roomId: "!one:chat.test" });
        // It arrives with the next sync, a moment after the answer
        steps.sleep.mockImplementationOnce(() => {
            rooms.add("!one:chat.test");
            return Promise.resolve();
        });
        await expect(openBrickChatWith(BRICK, steps)).resolves.toBe("room !one:chat.test");
        expect(steps.openChatWith).not.toHaveBeenCalled();
        expect(steps.sayStillLoading).not.toHaveBeenCalled();
    });

    it("says the chats are still loading when the chat the bot server knows does not arrive, and makes nothing", async () => {
        const { steps, passed } = device();
        steps.ask.mockResolvedValue({ roomId: "!one:chat.test" });
        await expect(openBrickChatWith(BRICK, steps)).resolves.toBeUndefined();
        expect(steps.sayStillLoading).toHaveBeenCalledTimes(1);
        expect(steps.openChatWith).not.toHaveBeenCalled();
        expect(steps.openRoom).not.toHaveBeenCalled();
        expect(passed()).toBeGreaterThanOrEqual(ROOM_WAIT_MS);
    });

    it("waits while another device makes the chat, and opens it when it arrives here", async () => {
        const { steps, chats } = device();
        steps.ask.mockResolvedValue({ wait: true });
        let waits = 0;
        steps.sleep.mockImplementation(() => {
            if (++waits === 3) chats.add(BRICK_CHAT);
            return Promise.resolve();
        });
        await expect(openBrickChatWith(BRICK, steps)).resolves.toBe(`chat with ${BRICK_CHAT}`);
        expect(steps.ask).toHaveBeenCalledTimes(3);
        expect(steps.sleep).toHaveBeenCalledWith(ASK_AGAIN_MS);
    });

    it("is told to make it once the device that was making it gave up", async () => {
        const { steps } = device();
        steps.ask
            .mockResolvedValueOnce({ wait: true })
            .mockResolvedValueOnce({ wait: true })
            .mockResolvedValue({ create: true, botChatId: BRICK_CHAT });
        await expect(openBrickChatWith(BRICK, steps)).resolves.toBe(`chat with ${BRICK_CHAT}`);
        expect(steps.ask).toHaveBeenCalledTimes(3);
        expect(steps.openChatWith).toHaveBeenCalledTimes(1);
    });

    it("opens the chat the way every direct chat opens when the bot server cannot say", async () => {
        const { steps } = device();
        steps.ask.mockResolvedValue(undefined);
        await expect(openBrickChatWith(BRICK, steps)).resolves.toBe(`chat with ${BRICK_CHAT}`);
        expect(steps.ask).toHaveBeenCalledTimes(1);
    });

    it("stops waiting in the end without making a second chat, and says to try again", async () => {
        const { steps } = device();
        steps.ask.mockResolvedValue({ wait: true });
        await expect(openBrickChatWith(BRICK, steps)).resolves.toBeUndefined();
        // A little longer than the 20 seconds the bot server keeps the other device's turn
        expect(steps.ask.mock.calls.length).toBeGreaterThan(20);
        expect(steps.ask.mock.calls.length).toBeLessThan(30);
        expect(steps.openChatWith).not.toHaveBeenCalled();
        expect(steps.sayStillLoading).toHaveBeenCalledTimes(1);
    });

    it("never makes the chat itself once told another device is making it, even when the bot server then cannot say", async () => {
        const { steps } = device();
        steps.ask.mockResolvedValueOnce({ wait: true }).mockResolvedValue(undefined);
        await expect(openBrickChatWith(BRICK, steps)).resolves.toBeUndefined();
        expect(steps.openChatWith).not.toHaveBeenCalled();
        expect(steps.sayStillLoading).toHaveBeenCalledTimes(1);
    });

    it("goes on making the chat on a second tap, instead of being told to wait for itself", async () => {
        const memory: MakeItMemory = new Map();
        const { steps } = device();
        steps.ask.mockResolvedValueOnce({ create: true, botChatId: BRICK_CHAT }).mockResolvedValue({ wait: true });
        // The first try fails after the bot server gave this device the turn
        steps.openChatWith.mockResolvedValueOnce(undefined);
        await expect(openBrickChatWith(BRICK, steps, memory)).resolves.toBeUndefined();
        await expect(openBrickChatWith(BRICK, steps, memory)).resolves.toBe(`chat with ${BRICK_CHAT}`);
        expect(steps.ask).toHaveBeenCalledTimes(1);
    });

    it("asks again once the turn it was given has run out", async () => {
        const memory: MakeItMemory = new Map();
        const { steps } = device();
        steps.ask.mockResolvedValue({ create: true, botChatId: BRICK_CHAT });
        steps.openChatWith.mockResolvedValueOnce(undefined);
        await openBrickChatWith(BRICK, steps, memory);
        await steps.sleep(MAKE_IT_FOR_MS + 1);
        await openBrickChatWith(BRICK, steps, memory);
        expect(steps.ask).toHaveBeenCalledTimes(2);
    });

    it("does nothing for someone with no chat address of their own", async () => {
        const { steps } = device("");
        await expect(openBrickChatWith(BRICK, steps)).resolves.toBeUndefined();
        expect(steps.ask).not.toHaveBeenCalled();
        expect(steps.openChatWith).not.toHaveBeenCalled();
    });
});

describe("a Brick on its page (#1996)", () => {
    const brickCard = parseBrickCard(card({ description: "Your everyday helper" }))!;

    it("is the bot page's own data, from Orbit's read of the bot", () => {
        const bot = brickPageBot(
            {
                ...card(),
                name: "  Brick  ",
                description: "Plans and reminds",
                chatInstructions: "Short answers.",
                aiProviderRef: "universe-ai",
                enabled: false,
                updatedAt: "2026-11-11T12:00:00.000Z",
                createdBy: { id: "u-omar", name: "Omar", email: "omar@example.com" },
                updatedBy: { id: "u-omar", name: null },
                roomId: null,
            },
            brickCard
        );
        expect(bot).toMatchObject({
            id: BRICK,
            name: "Brick",
            description: "Plans and reminds",
            characterTexture: "brick-orange",
            characterTextureIds: ["brick-orange"],
            chatInstructions: "Short answers.",
            aiProviderRef: "universe-ai",
            enabled: false,
            updatedAt: "2026-11-11T12:00:00.000Z",
            createdBy: { id: "u-omar", name: "Omar", email: "omar@example.com" },
            updatedBy: { id: "u-omar", name: null, email: null },
            behaviorType: "idle",
        });
    });

    it("takes from its card what the read does not say, so it always has a name", () => {
        const bot = brickPageBot({ name: "", createdBy: "someone" }, brickCard);
        expect(bot).toMatchObject({
            name: "Brick",
            description: "Your everyday helper",
            characterTexture: "brick-orange",
            enabled: true,
            createdBy: null,
            chatInstructions: "",
        });
        expect(brickPageBot(null, brickCard).name).toBe("Brick");
    });
});
