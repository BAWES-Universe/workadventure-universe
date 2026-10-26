/**
 * What the game shows about a bot before you write to it: in the chat header, the message box and the People list.
 * The bot server answers from the same cached configuration its replies use; nothing runs for a bot nobody looks at.
 */
export type BotAvailability = "online" | "resting" | "unready" | "gone";

/** Why a bot left a note instead of an answer (the `universe.bot_status` field of its notice). */
export type BotNoteState = "resting" | "unready" | "trouble" | "gone" | "no_access" | "limited";

export interface BotStatusNote {
    state: BotNoteState;
    title: string;
    text: string;
}

const BOT_CHAT_ID = /^@bot_([a-z0-9._=\-/]+):/;
const NOTE_STATES: BotNoteState[] = ["resting", "unready", "trouble", "gone", "no_access", "limited"];

/** The Orbit bot id behind a bot's chat ID, or undefined for people. Only the bot server can own these IDs. */
export function botIdFromChatId(chatId: string | null | undefined): string | undefined {
    return chatId ? BOT_CHAT_ID.exec(chatId)?.[1] : undefined;
}

/** The note a bot's notice carries, or undefined when it is anything else (or not sent by a bot). */
export function readBotStatusNote(
    sender: string | null | undefined,
    content: Record<string, unknown>
): BotStatusNote | undefined {
    if (!botIdFromChatId(sender) || content.msgtype !== "m.notice") return undefined;
    const note = content["universe.bot_status"] as Partial<BotStatusNote> | undefined;
    if (!note || typeof note !== "object" || !NOTE_STATES.includes(note.state as BotNoteState)) return undefined;
    if (typeof note.text !== "string" || typeof note.title !== "string") return undefined;
    return { state: note.state as BotNoteState, title: note.title, text: note.text };
}

/**
 * The availability a note tells about, or undefined for notes about one message (trouble) or one person (no_access,
 * limited).
 */
export function availabilityFromNote(state: BotNoteState): BotAvailability | undefined {
    return state === "resting" || state === "unready" || state === "gone" ? state : undefined;
}

/**
 * Whether to follow a chat partner's Matrix presence. A bot account never publishes presence (its state comes from the
 * bot server), so nothing is subscribed for it.
 */
export function followsPresence(chatId: string | null | undefined): boolean {
    return botIdFromChatId(chatId) === undefined;
}

/**
 * A bot that is no longer in its direct chat is either deleted or declined the invite (it was resting, not ready, or
 * the person had no access). Leaving the room cannot tell these apart, so only the bot server's own answer, or a
 * goodbye note from the bot itself, closes the chat.
 */
export function botChatClosed(state: BotAvailability | undefined): boolean {
    return state === "gone";
}

/**
 * The state under a bot's name in the chat header. Someone who can't reach the bot's room learns nothing more from
 * its state, and "Online" next to "Can't chat" reads like a bug, so the header stays quiet while the bot's latest word
 * is that note, unless the bot is gone.
 */
export function botHeaderState(
    state: BotAvailability | undefined,
    latestNote: BotNoteState | undefined
): BotAvailability | undefined {
    return latestNote === "no_access" && !botChatClosed(state) ? undefined : state;
}

/** Status dot colours, the same as people's (Utils/AvailabilityStatus). */
const COLOURS: Record<BotAvailability | BotNoteState, string> = {
    online: "#68e97a",
    trouble: "#68e97a",
    resting: "#e9c84e",
    unready: "#ffffff",
    no_access: "#ffffff",
    limited: "#ffffff",
    gone: "#e96e53",
};

export function botStatusColour(state: BotAvailability | BotNoteState): string {
    return COLOURS[state];
}
