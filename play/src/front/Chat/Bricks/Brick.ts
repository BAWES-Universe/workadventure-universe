import { botIdFromChatId } from "../Bots/BotChatStatus";

/**
 * A person's own Brick (game #1995): a bot that lives in its owner's chats instead of a room on the map. Everyone who is
 * signed in gets one, made once per account by Orbit. Nothing in here talks to a server or reads a store, so every rule
 * can be unit tested.
 */

/** A Brick as Orbit's Bricks routes describe it to its owner. */
export interface BrickCard {
    id: string;
    name: string;
    description: string | null;
    /** The look Orbit keeps for it ("brick-orange"): the game draws it. */
    characterTextureId: string | null;
    enabled: boolean;
    /** The Brick this account got by itself, as opposed to one its owner made. */
    isDefault: boolean;
    createdAt: string;
}

/** A tap on a starter says which one, beside the words it sends; the bot server answers "ideas" with fixed text. */
export const STARTER_KEY = "universe.starter";
export const STARTER_IDEAS = "ideas";
/** The bot server marks its fixed "what I can do" answer, so the game shows the ideas under it. */
export const BRICK_IDEAS_KEY = "universe.brick_ideas";

const NAME_MAX = 100;
const LINE_MAX = 300;

export function parseBrickCard(value: unknown): BrickCard | undefined {
    if (!value || typeof value !== "object") return undefined;
    const { id, name, description, characterTextureId, enabled, isDefault, createdAt } = value as Record<
        string,
        unknown
    >;
    if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) return undefined;
    return {
        id,
        name: name.trim().slice(0, NAME_MAX),
        description:
            typeof description === "string" && description.trim() ? description.trim().slice(0, LINE_MAX) : null,
        characterTextureId: typeof characterTextureId === "string" && characterTextureId ? characterTextureId : null,
        enabled: enabled !== false,
        isDefault: isDefault === true,
        createdAt: typeof createdAt === "string" ? createdAt : "",
    };
}

/** A list of Bricks as Orbit sends it (`{ bricks: [...] }`); anything else is no Bricks. */
export function parseBrickCards(value: unknown): BrickCard[] {
    const list = (value as { bricks?: unknown } | null)?.bricks;
    if (!Array.isArray(list)) return [];
    const cards: BrickCard[] = [];
    for (const one of list) {
        const card = parseBrickCard(one);
        if (card && !cards.some((other) => other.id === card.id)) cards.push(card);
    }
    return cards;
}

/** When the Brick was made, in ms; 0 when Orbit did not say. */
export function brickMadeAt(brick: Pick<BrickCard, "createdAt">): number {
    const at = Date.parse(brick.createdAt);
    return Number.isFinite(at) && at > 0 ? at : 0;
}

/**
 * A Brick's chat address. Bot accounts live on the person's own chat server (`@bot_<id>:<server>`), so the server part
 * is the one of the person's own address. Undefined when either part is missing or the id cannot be an address.
 */
export function brickChatId(brickId: string, myChatId: string | null | undefined): string | undefined {
    const server = myChatId?.startsWith("@") ? myChatId.slice(myChatId.indexOf(":") + 1) : undefined;
    if (!server || !myChatId?.includes(":")) return undefined;
    const chatId = `@bot_${brickId}:${server}`;
    return botIdFromChatId(chatId) === brickId ? chatId : undefined;
}

/** The pictures the game has for a Brick's look. Every Brick is the orange one until more looks arrive (#1996). */
const PICTURES: Record<string, string> = {
    "brick-orange": "/static/images/bricks/brick-orange.png",
};
const DEFAULT_PICTURE = PICTURES["brick-orange"];

/** The picture of a Brick's look. A look the game has no picture for is drawn as the Brick everyone gets. */
export function brickPictureUrl(look: string | null | undefined): string {
    return (look ? PICTURES[look] : undefined) ?? DEFAULT_PICTURE;
}

/** Whether a bot's message is the fixed "what I can do" answer (only a bot's own plain message can be). */
export function readBrickIdeas(sender: string | null | undefined, content: Record<string, unknown>): boolean {
    return botIdFromChatId(sender) !== undefined && content.msgtype === "m.text" && content[BRICK_IDEAS_KEY] === true;
}

const BOT_WORDS = new Set(["bot", "bots", "brick", "bricks"]);

/**
 * "Bot" and "Brick" are the same word (#1995): searching for either finds every bot and Brick, whatever it is named.
 * Only the whole word counts, so typing a name that starts the same way ("Bo…") lists nobody extra.
 */
export function searchesForBots(search: string): boolean {
    return BOT_WORDS.has(search.trim().toLocaleLowerCase());
}

/**
 * What the bot server tells a device that has no chat with a Brick yet (#1995): the chat they already have, to make it
 * (naming the Brick's chat address), or to ask again in a moment.
 */
export type DirectChatAnswer = { roomId: string } | { create: true; botChatId: string } | { wait: true };

export function parseDirectChatAnswer(value: unknown): DirectChatAnswer | undefined {
    if (!value || typeof value !== "object") return undefined;
    const { roomId, create, botChatId, wait } = value as Record<string, unknown>;
    if (typeof roomId === "string" && roomId.startsWith("!")) return { roomId };
    if (create === true && typeof botChatId === "string" && botIdFromChatId(botChatId) !== undefined) {
        return { create: true, botChatId };
    }
    return wait === true ? { wait: true } : undefined;
}

/** What opening a Brick's chat needs from the game, so the steps can be tested without one. */
export interface OpenBrickChatSteps<Room> {
    /** The person's own chat address. */
    myChatId: string | null | undefined;
    /** Asks the bot server who makes the chat. Undefined when it can't say. */
    ask: (brickId: string, myChatId: string) => Promise<unknown>;
    /** Whether this device already has a chat with that address. */
    hasChatWith: (chatId: string) => boolean;
    /** Whether this device's chat list holds that chat. */
    hasRoom: (roomId: string) => boolean;
    /** Opens the chat with that address: the one this device has, else a new one. */
    openChatWith: (chatId: string) => Promise<Room | undefined>;
    /** Opens a chat this device's list holds. */
    openRoom: (roomId: string) => Promise<Room | undefined>;
    /** Says the chats are still loading, so the person tries again. */
    sayStillLoading: () => void;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
}

/** How long between two questions while another device makes the chat. */
export const ASK_AGAIN_MS = 1000;
/** The bot server lets another device make the chat when the first has not within 20 seconds: a little longer than that. */
export const ASK_FOR_MS = 24_000;
/** How long a chat the bot server knows may take to reach this device before the person is told to try again. */
export const ROOM_WAIT_MS = 10_000;
const ROOM_LOOK_MS = 250;
/** As long as the bot server keeps a "make it" for one device. */
export const MAKE_IT_FOR_MS = 20_000;

/** Bricks this device was told to make the chat of, and until when: a second tap goes on making it instead of waiting. */
export type MakeItMemory = Map<string, { botChatId: string; until: number }>;

/**
 * Opens the one chat of a person and their Brick (#1995). A device that has the chat opens it. One that has none asks
 * the bot server first, so two devices opening Chats at the same moment never make two: one is told to make it, the
 * others wait for it to arrive. Without an answer the chat opens the way every direct chat does.
 */
export async function openBrickChatWith<Room>(
    brickId: string,
    steps: OpenBrickChatSteps<Room>,
    makeIt: MakeItMemory = new Map()
): Promise<Room | undefined> {
    const myChatId = steps.myChatId;
    const ownGuess = brickChatId(brickId, myChatId);
    if (!myChatId || !ownGuess) return undefined;
    if (steps.hasChatWith(ownGuess)) return steps.openChatWith(ownGuess);

    const told = makeIt.get(brickId);
    if (told && told.until > steps.now()) return steps.openChatWith(told.botChatId);

    // One question at a time, each after the answer to the one before: the waits in these loops are the point.
    /* eslint-disable no-await-in-loop */
    const askUntil = steps.now() + ASK_FOR_MS;
    while (steps.now() < askUntil) {
        const answer = parseDirectChatAnswer(await steps.ask(brickId, myChatId));
        if (!answer) break;
        if ("create" in answer) {
            makeIt.set(brickId, { botChatId: answer.botChatId, until: steps.now() + MAKE_IT_FOR_MS });
            return steps.openChatWith(answer.botChatId);
        }
        if ("roomId" in answer) {
            // The chat exists: it is never made a second time. It reaches this device with the next sync.
            const waitUntil = steps.now() + ROOM_WAIT_MS;
            while (!steps.hasRoom(answer.roomId) && steps.now() < waitUntil) await steps.sleep(ROOM_LOOK_MS);
            if (steps.hasRoom(answer.roomId)) return steps.openRoom(answer.roomId);
            steps.sayStillLoading();
            return undefined;
        }
        await steps.sleep(ASK_AGAIN_MS);
        if (steps.hasChatWith(ownGuess)) return steps.openChatWith(ownGuess);
    }
    /* eslint-enable no-await-in-loop */
    return steps.openChatWith(ownGuess);
}
