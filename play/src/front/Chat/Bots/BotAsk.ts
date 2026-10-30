/**
 * A bot's card that waits for one person (prototype): an approval before a tool changes, deletes or sends something,
 * or a question with a few directions before a big job. It travels in the `universe.ask` field of a notice whose body
 * says the same in plain words, so other chat apps can read it. Typing in the chat box answers it in your own words.
 */
export type BotAskKind = "approval" | "question";

export interface BotAskOption {
    id: string;
    label: string;
    /** One short line under the label (question cards). */
    detail?: string;
    /** The action itself: the one gradient button of an approval. */
    main?: boolean;
}

export interface BotAsk {
    id: string;
    kind: BotAskKind;
    /** The tool's own title ("Create a Linear issue") or the question. */
    title: string;
    /** What exactly happens: team, title, recipient, text. Approval cards only. */
    lines?: Array<{ label?: string; text: string }>;
    /** Whose account acts, when it isn't the person asking ("Khalid's Linear"). */
    actsAs?: string;
    /** "Asks every time": deletes and sends out. */
    everyTime?: boolean;
    options: BotAskOption[];
    /** The one person who can answer, and their name for everyone else. */
    asker: string;
    askerName: string;
    expiresAt: number;
    /** Once answered or gone: which option, or typed, or expired. */
    answer?: { option?: string; typed?: boolean; expired?: boolean };
}

/** The ask a bot's notice carries, or undefined. */
export function parseBotAsk(value: unknown): BotAsk | undefined {
    if (!value || typeof value !== "object") return undefined;
    const field = value as Record<string, unknown>;
    if (field.v !== 1 || (field.kind !== "approval" && field.kind !== "question")) return undefined;
    if (typeof field.id !== "string" || typeof field.title !== "string" || !Array.isArray(field.options)) return undefined;
    return field as unknown as BotAsk;
}

/** The card still waiting for you: the chat box then says typing answers it. */
export function waitingForMe(asks: Array<BotAsk | undefined>, me: string | undefined, now: number): BotAsk | undefined {
    for (let i = asks.length - 1; i >= 0; i--) {
        const ask = asks[i];
        if (ask && !ask.answer && ask.asker === me && ask.expiresAt > now) return ask;
    }
    return undefined;
}
