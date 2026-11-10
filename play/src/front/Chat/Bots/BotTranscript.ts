import { botIdFromChatId } from "./BotChatStatus";

/**
 * What a bot heard in a voice note: the bot server sends one notice that points at the note (`universe.transcript`) and
 * edits it as the hearing goes: "listening", then the words, or that it could not listen. The notice itself is never drawn;
 * its content is shown inside the note's own bubble.
 */
export type NoteTranscriptState = "listening" | "heard" | "failed";

export interface NoteTranscript {
    state: NoteTranscriptState;
    /** The words, once heard. */
    text?: string;
}

export interface NoteTranscriptNotice extends NoteTranscript {
    /** The voice note it is about (its event id). */
    for: string;
}

const STATES: readonly string[] = ["listening", "heard", "failed"];
/** What a transcript may be, so a long one can't stretch the chat: far over what a two minute note holds. */
const TEXT_MAX = 8000;

/** The transcript a bot's notice carries, or undefined when it is anything else, or not sent by a bot. */
export function readNoteTranscript(
    sender: string | null | undefined,
    content: Record<string, unknown> | undefined
): NoteTranscriptNotice | undefined {
    if (!content || !botIdFromChatId(sender) || content.msgtype !== "m.notice") return undefined;
    return parseNoteTranscript(content["universe.transcript"]);
}

export function parseNoteTranscript(value: unknown): NoteTranscriptNotice | undefined {
    if (!value || typeof value !== "object") return undefined;
    const field = value as Record<string, unknown>;
    if (field.v !== 1 || typeof field.for !== "string" || !field.for) return undefined;
    if (typeof field.state !== "string" || !STATES.includes(field.state)) return undefined;
    const state = field.state as NoteTranscriptState;
    const text = typeof field.text === "string" ? field.text.trim().slice(0, TEXT_MAX) : "";
    // Words are what "heard" is made of: a heard note with none is a note that could not be listened to
    if (state === "heard" && !text) return { for: field.for, state: "failed" };
    return { for: field.for, state, ...(state === "heard" ? { text } : {}) };
}
