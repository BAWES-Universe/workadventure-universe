/**
 * Who a bot listens to when several people are in its nearby chat (game #1220, option b).
 *
 * On its own with one person, a bot works as it always did: everything that person says is for it. With two or more
 * people in the bubble it only hears the person who is talking to it: they start with its name, they summoned it, or
 * they are inside the follow-up window right after it answered them. What anyone else says is dropped unread: no
 * transcript, no memory, no personal facts, no AI call. Everyone in the bubble still sees the bot's answer.
 *
 * One instance per bot. `BotClient` asks it before a chat line reaches the behavior, and a voice bot asks it before
 * a spoken turn is offered back to the person as their line (see `VoiceCalls.hears`).
 */

/** How long, after the bot answers someone, they can go on without saying its name. Seconds; the default is 30. */
export const DEFAULT_FOLLOW_UP_SECONDS = 30;
/** The longest a window may be, the same limit the game applies to the number it is told. */
export const MAX_FOLLOW_UP_SECONDS = 24 * 60 * 60;

/** The follow-up window from `BOT_FOLLOW_UP_SECONDS`. 0 means the name is needed every time; anything unusable is the default. */
export function followUpSeconds(env: NodeJS.ProcessEnv = process.env): number {
    const text = env.BOT_FOLLOW_UP_SECONDS?.trim();
    if (!text || !/^\d+$/.test(text)) return DEFAULT_FOLLOW_UP_SECONDS;
    const parsed = Number.parseInt(text, 10);
    return parsed <= MAX_FOLLOW_UP_SECONDS ? parsed : DEFAULT_FOLLOW_UP_SECONDS;
}

/** Why a line was let through (or not). Only `ignored` stops it. */
export type Attention = 'alone' | 'named' | 'summoned' | 'follow-up' | 'ignored';

/** Words people put before a name when they call someone ("hey Nora, ..."). */
const CALLING_WORDS = ['hey', 'hi', 'hello', 'ok', 'okay', 'yo', 'hey there', 'hi there', 'hello there'];

/** Lowercase letters and numbers only, one space between words, accents dropped: "Hey, Núra!" -> "hey nura". */
function plainWords(text: string): string {
    return text
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

export class BotAttention {
    private readonly name: string;
    /** Who is in each space: people only. The caller leaves out this bot and other bots (see `personJoined`). */
    private readonly people = new Map<string, Set<number>>();
    /** When the bot last answered each person, by space. */
    private readonly answeredAt = new Map<string, Map<number, number>>();
    /** How many of a person's lines the bot is working on right now, by space: they are in the conversation until it is done. */
    private readonly working = new Map<string, Map<number, number>>();

    constructor(
        botName: string,
        /** Seconds a person can go on without the name after the bot answered them. */
        readonly followUpSeconds: number,
        /** Whether the bot is on a summon to this person right now. The summon itself says when that ends. */
        private readonly isSummonedBy: (userId: number) => boolean = () => false,
        private readonly now: () => number = Date.now
    ) {
        this.name = plainWords(botName);
    }

    // ---- who is in the bubble ----

    /** Someone is in the space. Only people: the bot does not tell people from bots by an id (ids repeat from room to room) but by who they are, so it is the caller that leaves bots out. */
    personJoined(spaceName: string, userId: number): void {
        let set = this.people.get(spaceName);
        if (!set) this.people.set(spaceName, (set = new Set()));
        set.add(userId);
    }

    personLeft(spaceName: string, userId: number): void {
        this.people.get(spaceName)?.delete(userId);
        this.answeredAt.get(spaceName)?.delete(userId);
        this.working.get(spaceName)?.delete(userId);
    }

    /** The bot left the space: nobody's window carries over to the next time. */
    spaceLeft(spaceName: string): void {
        this.people.delete(spaceName);
        this.answeredAt.delete(spaceName);
        this.working.delete(spaceName);
    }

    /** More than the speaker is in the bubble. The speaker counts even if their join was not seen yet. */
    private isGroup(spaceName: string, speakerId: number): boolean {
        const set = this.people.get(spaceName);
        if (!set) return false;
        for (const id of set) if (id !== speakerId) return true;
        return false;
    }

    // ---- who the bot listens to ----

    /** Whether the words begin with the bot's name, with or without a calling word or an @ before it. */
    isNamed(text: string): boolean {
        if (!this.name) return false;
        const words = plainWords(text);
        for (const prefix of ['', ...CALLING_WORDS.map((word) => `${word} `)]) {
            if (words === `${prefix}${this.name}` || words.startsWith(`${prefix}${this.name} `)) return true;
        }
        return false;
    }

    /** Decides without changing anything: asking twice about the same line gives the same answer. */
    attention(spaceName: string, speakerId: number, text: string): Attention {
        if (!this.isGroup(spaceName, speakerId)) return 'alone';
        if (this.isNamed(text)) return 'named';
        if (this.isSummonedBy(speakerId)) return 'summoned';
        // A follow-up sent while the bot is still answering is part of that conversation (it may change or add to the ask)
        if ((this.working.get(spaceName)?.get(speakerId) ?? 0) > 0) return 'follow-up';
        const last = this.answeredAt.get(spaceName)?.get(speakerId);
        if (last !== undefined && this.now() - last < this.followUpSeconds * 1000) return 'follow-up';
        return 'ignored';
    }

    /** Whether what this person said is for the bot. */
    hears(spaceName: string, speakerId: number, text: string): boolean {
        return this.attention(spaceName, speakerId, text) !== 'ignored';
    }

    /** The bot starts working on a line from this person: until it is done they can go on without its name. */
    began(spaceName: string, speakerId: number): void {
        let counts = this.working.get(spaceName);
        if (!counts) this.working.set(spaceName, (counts = new Map()));
        counts.set(speakerId, (counts.get(speakerId) ?? 0) + 1);
    }

    /** The bot is done with a line from this person. When it answered, the follow-up window starts from now. */
    ended(spaceName: string, speakerId: number, answered: boolean): void {
        const counts = this.working.get(spaceName);
        const left = (counts?.get(speakerId) ?? 0) - 1;
        if (left > 0) counts?.set(speakerId, left);
        else counts?.delete(speakerId);
        if (answered) this.answered(spaceName, speakerId);
    }

    /** The bot has answered this person: they can go on without its name for the follow-up window. */
    answered(spaceName: string, speakerId: number): void {
        let answers = this.answeredAt.get(spaceName);
        if (!answers) this.answeredAt.set(spaceName, (answers = new Map()));
        answers.set(speakerId, this.now());
    }
}
