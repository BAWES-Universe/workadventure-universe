/**
 * What the game shows about a bot before you write to it: in the chat header, the message box and the People list.
 * The bot server answers from the same cached configuration its replies use; nothing runs for a bot nobody looks at.
 */
export type BotAvailability = "online" | "resting" | "unready" | "gone";

/** Why a bot left a note instead of an answer (the `universe.bot_status` field of its notice). */
export type BotNoteState = "resting" | "unready" | "trouble" | "gone" | "no_access";

export interface BotStatusNote {
    state: BotNoteState;
    title: string;
    text: string;
}

const BOT_CHAT_ID = /^@bot_([a-z0-9._=\-/]+):/;
const NOTE_STATES: BotNoteState[] = ["resting", "unready", "trouble", "gone", "no_access"];

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

/** Status dot colours, the same as people's (Utils/AvailabilityStatus). */
const COLOURS: Record<BotAvailability | BotNoteState, string> = {
    online: "#68e97a",
    trouble: "#68e97a",
    resting: "#e9c84e",
    unready: "#ffffff",
    no_access: "#ffffff",
    gone: "#e96e53",
};

export function botStatusColour(state: BotAvailability | BotNoteState): string {
    return COLOURS[state];
}
