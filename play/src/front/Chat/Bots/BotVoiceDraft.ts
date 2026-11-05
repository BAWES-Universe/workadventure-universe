/**
 * What a voice bot hears a person say (#1664), shown to that person only, above their message box.
 *
 * It comes as a private event from the bot while they talk. The words fill in as a live draft. When they pause and
 * every word came through, their own game sends the words as their chat line (marked as spoken to that bot, so nobody
 * else's bot takes it for a new request). Words that did not all come through (the connection dropped, the limit was
 * reached, the voice stopped) are only offered back: Edit, Send or Discard, and nothing is sent until they choose. A line
 * they type and send while still talking wins: what they were saying is not sent, it is put in the message box for
 * them once the stretch ends (the same as Edit).
 *
 * Everything here is pure so it can be tested without a chat: `applyDraftEvent` and `afterTypedSend` return the next
 * list, and what to send, if anything.
 */

/**
 * live: words filling in. held: they typed a line meanwhile, so nothing is shown and the words go to the message box
 * when the stretch ends. lost: words that did not come through.
 */
export type VoiceDraftState = "live" | "held" | "lost";

export interface BotVoiceDraft {
    botId: string;
    botName: string;
    /** One stretch of speech: the words of a later one never replace an earlier one. */
    turnId: string;
    state: VoiceDraftState;
    text: string;
}

/** A line for the person's own game to send as theirs, with the bot and the turn it was spoken to. */
export interface SpokenLine {
    botId: string;
    turnId: string;
    text: string;
}

export type VoiceDraftEvent =
    | { kind: "live"; botId: string; botName: string; turnId: string; text: string }
    | { kind: "final"; botId: string; botName: string; turnId: string; text: string }
    | { kind: "lost"; botId: string; botName: string; turnId: string; text: string }
    | { kind: "cleared"; botId: string; botName: string; turnId: string };

/** Drafts shown at once: a person is never more than a stretch or two behind, so more is a bot gone wrong. */
export const MAX_VOICE_DRAFTS = 4;
const NAME_MAX = 120;
const ID_MAX = 128;
const TEXT_MAX = 8000;

const STATES = ["live", "final", "lost", "cleared"] as const;

/** What a bot's event says, or undefined when any part of it is missing or not one we know. */
export function parseBotVoiceDraft(value: unknown, botName: string): VoiceDraftEvent | undefined {
    if (!value || typeof value !== "object") return undefined;
    const { botId, turnId, state, text } = value as Partial<Record<"botId" | "turnId" | "state" | "text", unknown>>;
    if (typeof botId !== "string" || botId === "" || botId.length > ID_MAX) return undefined;
    if (typeof turnId !== "string" || turnId === "" || turnId.length > ID_MAX) return undefined;
    if (!STATES.includes(state as (typeof STATES)[number])) return undefined;
    const name = botName.trim().slice(0, NAME_MAX);
    if (state === "cleared") return { kind: "cleared", botId, botName: name, turnId };
    if (typeof text !== "string" || text.length > TEXT_MAX) return undefined;
    return { kind: state as "live" | "final" | "lost", botId, botName: name, turnId, text };
}

export interface DraftChange {
    drafts: BotVoiceDraft[];
    /** The person's own game sends this as their line. */
    send?: SpokenLine;
    /** Words for the message box, as Edit does: a stretch they typed over is over. */
    toComposer?: string;
}

const same = (draft: BotVoiceDraft, event: { botId: string; turnId: string }): boolean =>
    draft.botId === event.botId && draft.turnId === event.turnId;

function draftOf(
    event: { botId: string; botName: string; turnId: string; text: string },
    state: VoiceDraftState
): BotVoiceDraft {
    return { botId: event.botId, botName: event.botName, turnId: event.turnId, state, text: event.text };
}

function capped(drafts: BotVoiceDraft[]): BotVoiceDraft[] {
    return drafts.length > MAX_VOICE_DRAFTS ? drafts.slice(drafts.length - MAX_VOICE_DRAFTS) : drafts;
}

/** What an event from a bot does to the drafts shown, and whether it finishes a line to send. */
export function applyDraftEvent(drafts: BotVoiceDraft[], event: VoiceDraftEvent): DraftChange {
    const known = drafts.find((draft) => same(draft, event));
    switch (event.kind) {
        case "live":
            // A lost stretch is over: late words do not bring it back
            if (known?.state === "lost") return { drafts };
            if (known)
                return { drafts: drafts.map((draft) => (draft === known ? { ...draft, text: event.text } : draft)) };
            return { drafts: capped([...drafts, draftOf(event, "live")]) };
        case "final":
            // They typed a line meanwhile: these words are not sent, they go to the message box
            if (known?.state === "held") return held(drafts, known, event.text);
            if (known?.state === "lost") return { drafts };
            return {
                drafts: drafts.filter((draft) => draft !== known),
                send: { botId: event.botId, turnId: event.turnId, text: event.text },
            };
        case "lost":
            if (known?.state === "held") return held(drafts, known, event.text);
            if (known)
                return {
                    drafts: drafts.map((draft) =>
                        draft === known ? { ...draft, state: "lost", text: event.text } : draft
                    ),
                };
            return { drafts: capped([...drafts, draftOf(event, "lost")]) };
        case "cleared":
            return { drafts: drafts.filter((draft) => draft !== known) };
    }
}

/** A stretch they typed over is over: its words are theirs to edit, never sent by themselves. */
function held(drafts: BotVoiceDraft[], draft: BotVoiceDraft, text: string): DraftChange {
    const words = text.trim();
    return { drafts: drafts.filter((d) => d !== draft), ...(words ? { toComposer: words } : {}) };
}

/** The person typed a line and sent it: any words they are still saying are not sent too, and are no longer shown. */
export function afterTypedSend(drafts: BotVoiceDraft[]): BotVoiceDraft[] {
    if (!drafts.some((draft) => draft.state === "live")) return drafts;
    return drafts.map((draft) => (draft.state === "live" ? { ...draft, state: "held" } : draft));
}

/** The one card to show: the newest draft, for the bot that was addressed last. Held words have no card. */
export function cardToShow(drafts: BotVoiceDraft[]): BotVoiceDraft | undefined {
    for (let i = drafts.length - 1; i >= 0; i--) if (drafts[i].state !== "held") return drafts[i];
    return undefined;
}

/** Send on a draft that was offered back: its words as the person's line. Nothing else in the list changes. */
export function sendDraft(drafts: BotVoiceDraft[], turnId: string): DraftChange {
    const draft = drafts.find((d) => d.turnId === turnId && d.state === "lost");
    if (!draft || draft.text.trim() === "") return { drafts };
    return {
        drafts: drafts.filter((d) => d !== draft),
        send: { botId: draft.botId, turnId: draft.turnId, text: draft.text },
    };
}

/** Discard: the words are gone. A stretch still being heard (live) is not discarded from here. */
export function discardDraft(drafts: BotVoiceDraft[], turnId: string): BotVoiceDraft[] {
    return drafts.filter((d) => !(d.turnId === turnId && d.state === "lost"));
}

/** Edit: the words go to the message box to be changed and sent as typed. Returns the words, and the drafts without them. */
export function editDraft(drafts: BotVoiceDraft[], turnId: string): { drafts: BotVoiceDraft[]; text?: string } {
    const draft = drafts.find((d) => d.turnId === turnId && d.state === "lost");
    if (!draft) return { drafts };
    return { drafts: drafts.filter((d) => d !== draft), text: draft.text };
}

/** The words of a live draft, split so the newest word can be shown quieter: it is the one the recognizer may still change. */
export function splitTentativeWord(text: string): { settled: string; tentative: string } {
    const trimmed = text.replace(/\s+$/, "");
    const cut = trimmed.search(/\s\S+$/);
    if (cut < 0) return { settled: "", tentative: trimmed };
    return { settled: trimmed.slice(0, cut + 1), tentative: trimmed.slice(cut + 1) };
}
