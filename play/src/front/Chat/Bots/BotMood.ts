import { derived, writable, type Readable } from "svelte/store";
import type { BotStepKind } from "./BotSteps";

/**
 * How a bot feels and what it is busy with, for the emoji beside its Woka (#1667). The mood comes with a reply the bot
 * sends to the nearby chat; the work comes from the bot's own steps line there. Neither is kept anywhere else: a
 * private job (a direct message) never gets here, so others never see it.
 */

/** A bot's wave when a person told it they are done talking with it (#1670): it comes with no words, and shows like a mood. */
export const WAVE_MOOD = "👋";

/** The moods a bot can show. Anything else a sender puts in is not drawn. */
export const BOT_MOODS = ["😄", "🙂", "😏", "😕", "😟", "😒", "😠", WAVE_MOOD] as const;

/** What each mood is called, so the label for a screen reader matches the emoji (the words are in the video texts). */
export const MOOD_NAME = {
    "😄": "happy",
    "🙂": "content",
    "😏": "cheeky",
    "😕": "puzzled",
    "😟": "worried",
    "😒": "unimpressed",
    "😠": "annoyed",
    [WAVE_MOOD]: "waving",
} as const;

export const WORK_EMOJI: Record<BotStepKind, string> = { read: "📖", search: "🔎", write: "✍️" };

export interface BotFeeling {
    mood?: string;
    /** Changes with every mood that arrives, so the same mood twice still shows twice. */
    moodSeq: number;
    /** What the bot is busy with: its newest running step, else writing while it writes a reply in the nearby chat. */
    work?: BotStepKind;
}

/** What the bot's own steps line says it is busy with, and whether it writes a reply right now (no tool involved). */
interface BotFeelingState {
    mood?: string;
    moodSeq: number;
    steps?: BotStepKind;
    writing?: boolean;
}

const feelings = writable<ReadonlyMap<string, BotFeelingState>>(new Map());
let seq = 0;

function change(id: string, update: (feeling: BotFeelingState) => BotFeelingState | undefined): void {
    feelings.update((all) => {
        const next = new Map(all);
        const changed = update(all.get(id) ?? { moodSeq: 0 });
        if (changed) next.set(id, changed);
        else next.delete(id);
        return next;
    });
}

/** A bot's reply came with this mood, or with none (a reply without one clears the last). */
export function setBotMood(id: string, mood: string | undefined): void {
    const known = (BOT_MOODS as readonly string[]).includes(mood ?? "") ? mood : undefined;
    change(id, (feeling) => {
        const next = { ...feeling, mood: known, moodSeq: known ? ++seq : feeling.moodSeq };
        return kept(next);
    });
}

function kept(feeling: BotFeelingState): BotFeelingState | undefined {
    return feeling.mood || feeling.steps || feeling.writing ? feeling : undefined;
}

/** What the bot's steps line says it is busy with now, or undefined when it is not working. */
export function setBotWork(id: string, work: BotStepKind | undefined): void {
    change(id, (feeling) => kept({ ...feeling, steps: work }));
}

/**
 * The bot writes a reply in the nearby chat right now, with or without a tool call (its typing, or its words streaming
 * in). It shows as the pen beside the Woka, unless a running step already names what the bot is doing. Only the
 * nearby chat calls this: a direct message never does, so others never see it.
 */
export function setBotWriting(id: string, writing: boolean): void {
    feelings.update((all) => {
        const current = all.get(id);
        if (!!current?.writing === writing) return all;
        const next = new Map(all);
        const changed = kept({ moodSeq: 0, ...current, writing });
        if (changed) next.set(id, changed);
        else next.delete(id);
        return next;
    });
}

export function botFeeling(id: string): Readable<BotFeeling | undefined> {
    return derived(feelings, (all) => {
        const feeling = all.get(id);
        if (!feeling) return undefined;
        return {
            mood: feeling.mood,
            moodSeq: feeling.moodSeq,
            work: feeling.steps ?? (feeling.writing ? "write" : undefined),
        };
    });
}

/** A bot left, or the chat it was in closed: its emoji goes with it (one bot's, or every bot's when no id is given). */
export function forgetBotFeelings(id?: string): void {
    feelings.update((all) => {
        if (id === undefined) return all.size ? new Map() : all;
        if (!all.has(id)) return all;
        const next = new Map(all);
        next.delete(id);
        return next;
    });
}
