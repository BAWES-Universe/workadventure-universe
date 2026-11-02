import { derived, writable, type Readable } from "svelte/store";
import type { BotStepKind } from "./BotSteps";

/**
 * How a bot feels and what it is busy with, for the emoji beside its Woka (#1667). The mood comes with a reply the bot
 * sends to the nearby chat; the work comes from the bot's own steps line there. Neither is kept anywhere else: a
 * private job (a direct message) never gets here, so others never see it.
 */

/** The moods a bot can show. Anything else a sender puts in is not drawn. */
export const BOT_MOODS = ["😄", "🙂", "😏", "😕", "😟", "😒", "😠"] as const;

export const WORK_EMOJI: Record<BotStepKind, string> = { read: "📖", search: "🔎", write: "✍️" };

export interface BotFeeling {
    mood?: string;
    /** Changes with every mood that arrives, so the same mood twice still shows twice. */
    moodSeq: number;
    work?: BotStepKind;
}

const feelings = writable<ReadonlyMap<string, BotFeeling>>(new Map());
let seq = 0;

function change(id: string, update: (feeling: BotFeeling) => BotFeeling | undefined): void {
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
        return next.mood || next.work ? next : undefined;
    });
}

/** What the bot is busy with now, or undefined when it is not working. */
export function setBotWork(id: string, work: BotStepKind | undefined): void {
    change(id, (feeling) => {
        const next = { ...feeling, work };
        return next.mood || next.work ? next : undefined;
    });
}

export function botFeeling(id: string): Readable<BotFeeling | undefined> {
    return derived(feelings, (all) => all.get(id));
}
