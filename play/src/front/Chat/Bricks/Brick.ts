import type { BotData, BotUser } from "../../external-modules/bots/types";
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
    /** Its own first words in an empty chat (#1996); none: the game's hello. */
    hello: string | null;
}

/** A Brick its owner deleted (#1996): it waits on the Bricks page with Undo until the day it is gone for good. */
export interface DeletedBrickCard extends BrickCard {
    deletedAt: string;
    goneAt: string;
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
    const { id, name, description, characterTextureId, enabled, isDefault, createdAt, hello } = value as Record<
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
        hello: typeof hello === "string" && hello.trim() ? hello.trim().slice(0, LINE_MAX) : null,
    };
}

function botUser(value: unknown): BotUser | null {
    if (!value || typeof value !== "object") return null;
    const { id, name, email } = value as Record<string, unknown>;
    if (typeof id !== "string" || !id) return null;
    return { id, name: typeof name === "string" ? name : null, email: typeof email === "string" ? email : null };
}

function behaviorTypeOf(value: unknown): "idle" | "patrol" | "social" {
    return value === "patrol" || value === "social" ? value : "idle";
}

/** What Orbit saved of how a Brick behaves, with the circle the page's own groups expect when none is saved. */
function brickBehaviorConfig(value: unknown, behaviorType: "idle" | "patrol" | "social"): BotData["behaviorConfig"] {
    const saved = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const space = saved.assignedSpace as BotData["behaviorConfig"]["assignedSpace"] | undefined;
    return {
        ...saved,
        behaviorType,
        assignedSpace: space && typeof space.radius === "number" ? space : { center: { x: 0, y: 0 }, radius: 0 },
    };
}

/**
 * A Brick as its page shows it (game #1996): the bot page's own data, from Orbit's read of the bot. What the read does
 * not say is taken from its card, so the page never shows a Brick with no name. A Brick stands nowhere on a map.
 */
export function brickPageBot(value: unknown, card: BrickCard): BotData {
    const bot = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const text = (key: string): string | undefined => (typeof bot[key] === "string" ? bot[key] : undefined);
    const look = text("characterTextureId") ?? card.characterTextureId ?? "";
    return {
        id: card.id,
        botId: card.id,
        name: text("name")?.trim() || card.name,
        description: text("description") ?? card.description ?? undefined,
        characterTexture: look,
        characterTextureIds: look ? [look] : [],
        behaviorType: behaviorTypeOf(bot.behaviorType),
        behaviorConfig: brickBehaviorConfig(bot.behaviorConfig, behaviorTypeOf(bot.behaviorType)),
        companionTextureId: text("companionTextureId") ?? null,
        chatInstructions: text("chatInstructions") ?? "",
        aiProviderRef: text("aiProviderRef"),
        aiModel: text("aiModel") ?? null,
        enabled: typeof bot.enabled === "boolean" ? bot.enabled : card.enabled,
        createdAt: text("createdAt") ?? card.createdAt,
        updatedAt: text("updatedAt"),
        createdBy: botUser(bot.createdBy),
        updatedBy: botUser(bot.updatedBy),
    };
}

/** The deleted Bricks of a list as Orbit sends it (`{ deleted: [...] }`), the one gone soonest first. */
export function parseDeletedBricks(value: unknown): DeletedBrickCard[] {
    const list = (value as { deleted?: unknown } | null)?.deleted;
    if (!Array.isArray(list)) return [];
    const cards: DeletedBrickCard[] = [];
    for (const one of list) {
        const card = parseBrickCard(one);
        const { deletedAt, goneAt } = (one ?? {}) as Record<string, unknown>;
        if (!card || typeof goneAt !== "string" || !Number.isFinite(Date.parse(goneAt))) continue;
        if (cards.some((other) => other.id === card.id)) continue;
        cards.push({ ...card, deletedAt: typeof deletedAt === "string" ? deletedAt : "", goneAt });
    }
    return cards.sort((a, b) => Date.parse(a.goneAt) - Date.parse(b.goneAt));
}

/** How many days a deleted Brick waits, as Orbit's list says (`undoDays`); undefined when it does not. */
export function parseUndoDays(value: unknown): number | undefined {
    const days = (value as { undoDays?: unknown } | null)?.undoDays;
    return typeof days === "number" && Number.isFinite(days) && days > 0 ? days : undefined;
}

/**
 * A day as the Bricks page says it: "17 Nov", the day first. English is the one language here whose usual short date
 * can put the month first ("Nov 17"), so it is written the day-first way; every other language keeps its own order.
 * Empty for a date that cannot be read.
 */
export function shortDay(date: string | number | Date, locale?: string): string {
    const day = new Date(date);
    if (Number.isNaN(day.getTime())) return "";
    return day.toLocaleDateString(locale?.toLowerCase().startsWith("en") ? "en-GB" : locale, {
        day: "numeric",
        month: "short",
    });
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

/** The Brick looks (#1996), in the order New Brick offers them. Orbit keeps the id; the game draws it. */
export const BRICK_LOOKS = [
    "brick-orange",
    "brick-red",
    "brick-amber",
    "brick-lime",
    "brick-green",
    "brick-teal",
    "brick-sky",
    "brick-blue",
    "brick-violet",
    "brick-pink",
    "brick-white",
    "brick-charcoal",
] as const;
export type BrickLook = (typeof BRICK_LOOKS)[number];
export const DEFAULT_BRICK_LOOK: BrickLook = "brick-orange";

export function isBrickLook(look: string | null | undefined): look is BrickLook {
    return typeof look === "string" && (BRICK_LOOKS as readonly string[]).includes(look);
}

/**
 * The picture of a Brick look. Anything that is not one (no look, or a WOKA, which has its own pictures) is drawn as
 * the Brick everyone gets.
 */
export function brickPictureUrl(look: string | null | undefined): string {
    return `/static/images/bricks/${isBrickLook(look) ? look : DEFAULT_BRICK_LOOK}.png`;
}

/** Whether a bot's message is the fixed "what I can do" answer (only a bot's own plain message can be). */
export function readBrickIdeas(sender: string | null | undefined, content: Record<string, unknown>): boolean {
    return botIdFromChatId(sender) !== undefined && content.msgtype === "m.text" && content[BRICK_IDEAS_KEY] === true;
}

/** On a Brick's answer: the Bricks it made while answering (#1996). The chat shows a line for each, one tap from its chat. */
export const BRICK_MADE_KEY = "universe.brick_made";
/** A Brick's suggestion of a Brick for a job that keeps coming back (#1996): its own message, right after an answer. */
export const BRICK_OFFER_KEY = "universe.brick_offer";
/** On the person's message that a tap on "Make it" sends: the Brick the card described. */
export const BRICK_MAKE_KEY = "universe.brick_make";

/** A Brick another Brick made (or found, when one of that name was there) while answering. */
export interface MadeBrick {
    id: string;
    name: string;
    /** What it is for, in a few words ("keeps your mum's recipes"). */
    line: string;
    look: string | null;
    /** False when it was already there and the answer only points to it. */
    made: boolean;
}

const MADE_MAX = 5;
const text = (value: unknown, max: number): string =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** The Bricks a bot's message says it made; none for anyone else's message or anything malformed. */
export function readBrickMade(sender: string | null | undefined, content: Record<string, unknown>): MadeBrick[] {
    const list = content[BRICK_MADE_KEY];
    if (botIdFromChatId(sender) === undefined || content.msgtype !== "m.text" || !Array.isArray(list)) return [];
    const made: MadeBrick[] = [];
    for (const one of list.slice(0, MADE_MAX)) {
        if (!one || typeof one !== "object") continue;
        const { id, name, line, look, made: isNew } = one as Record<string, unknown>;
        if (typeof id !== "string" || !id || !text(name, NAME_MAX)) continue;
        if (made.some((other) => other.id === id)) continue;
        made.push({
            id,
            name: text(name, NAME_MAX),
            line: text(line, LINE_MAX),
            look: typeof look === "string" && look ? look : null,
            made: isNew !== false,
        });
    }
    return made;
}

/** A Brick's suggestion as the card shows it and as "Make it" sends it back. */
export interface BrickOffer {
    topic: string;
    /** The question ("You cook a lot. Want a Brick just for recipes?"). */
    ask: string;
    /** The Brick it would make ("Recipe Brick"). */
    name: string;
    /** What that Brick does, in a few words ("It keeps your recipes in one place"). */
    line: string;
    instructions: string;
}

const TOPIC_MAX = 60;
const ASK_MAX = 200;
const OFFER_LINE_MAX = 120;
const INSTRUCTIONS_MAX = 2000;

/** The suggestion a bot's message carries; undefined for anyone else's message or one that lacks a part. */
export function readBrickOffer(
    sender: string | null | undefined,
    content: Record<string, unknown>
): BrickOffer | undefined {
    const offer = content[BRICK_OFFER_KEY];
    if (botIdFromChatId(sender) === undefined || content.msgtype !== "m.text") return undefined;
    if (!offer || typeof offer !== "object") return undefined;
    const { topic, ask, name, line, instructions } = offer as Record<string, unknown>;
    const read: BrickOffer = {
        topic: text(topic, TOPIC_MAX),
        ask: text(ask, ASK_MAX),
        name: text(name, NAME_MAX),
        line: text(line, OFFER_LINE_MAX),
        instructions: typeof instructions === "string" ? instructions.trim().slice(0, INSTRUCTIONS_MAX) : "",
    };
    return read.topic && read.ask && read.name ? read : undefined;
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
 * others wait for it to arrive. Without an answer the chat opens the way every direct chat does, but never after the
 * bot server said another device is making it: then the person is told to try again.
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
    let heardWait = false;
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
        heardWait = true;
        await steps.sleep(ASK_AGAIN_MS);
        if (steps.hasChatWith(ownGuess)) return steps.openChatWith(ownGuess);
    }
    /* eslint-enable no-await-in-loop */
    // Once the bot server said another device is making the chat, this one never makes a second: the person tries again
    if (heardWait) {
        steps.sayStillLoading();
        return undefined;
    }
    return steps.openChatWith(ownGuess);
}
