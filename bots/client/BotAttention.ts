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
    /** Who is in each space, apart from the bot itself and other bots. */
    private readonly people = new Map<string, Set<number>>();
    /** When the bot last answered each person, by space. */
    private readonly answeredAt = new Map<string, Map<number, number>>();
    /** People who summoned the bot (by uuid): theirs until the bot has answered them. */
    private readonly summoners = new Set<string>();

    constructor(
        botName: string,
        /** Seconds a person can go on without the name after the bot answered them. */
        readonly followUpSeconds: number,
        /** True for a real person: not this bot, not another bot. */
        private readonly isPerson: (userId: number) => boolean,
        /** The person's uuid, when the bot knows it (for a summon). */
        private readonly uuidOf: (userId: number) => string | undefined = () => undefined,
        private readonly now: () => number = Date.now
    ) {
        this.name = plainWords(botName);
    }

    // ---- who is in the bubble ----

    personJoined(spaceName: string, userId: number): void {
        if (!this.isPerson(userId)) return;
        let set = this.people.get(spaceName);
        if (!set) this.people.set(spaceName, (set = new Set()));
        set.add(userId);
    }

    personLeft(spaceName: string, userId: number): void {
        this.people.get(spaceName)?.delete(userId);
        this.answeredAt.get(spaceName)?.delete(userId);
        const uuid = this.uuidOf(userId);
        if (uuid) this.summoners.delete(uuid);
    }

    /** The bot left the space: nobody's window carries over to the next time. */
    spaceLeft(spaceName: string): void {
        this.people.delete(spaceName);
        this.answeredAt.delete(spaceName);
    }

    /** More than the speaker is in the bubble. The speaker counts even if their join was not seen yet. */
    private isGroup(spaceName: string, speakerId: number): boolean {
        const set = this.people.get(spaceName);
        if (!set) return false;
        for (const id of set) if (id !== speakerId) return true;
        return false;
    }

    // ---- who the bot listens to ----

    /** Someone summoned the bot: what they say next is for it, even with others around. */
    summonedBy(uuid: string): void {
        this.summoners.add(uuid);
    }

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
        const uuid = this.uuidOf(speakerId);
        if (uuid && this.summoners.has(uuid)) return 'summoned';
        const last = this.answeredAt.get(spaceName)?.get(speakerId);
        if (last !== undefined && this.now() - last < this.followUpSeconds * 1000) return 'follow-up';
        return 'ignored';
    }

    /** Whether what this person said is for the bot. */
    hears(spaceName: string, speakerId: number, text: string): boolean {
        return this.attention(spaceName, speakerId, text) !== 'ignored';
    }

    /** The bot has answered this person: they can go on without its name for the follow-up window. */
    answered(spaceName: string, speakerId: number): void {
        let answers = this.answeredAt.get(spaceName);
        if (!answers) this.answeredAt.set(spaceName, (answers = new Map()));
        answers.set(speakerId, this.now());
        const uuid = this.uuidOf(speakerId);
        if (uuid) this.summoners.delete(uuid);
    }
}
