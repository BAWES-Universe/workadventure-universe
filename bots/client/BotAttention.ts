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

/**
 * Words people put before a name when they call someone ("hey Nora, ...", "يا نورة"), in the languages people use with
 * bots most. Written as `plainWords` leaves them: lowercase, accents and Arabic marks dropped ("أهلا" is "اهلا", "hé" is "he").
 */
const CALLING_WORDS = [
    // English
    'hey', 'hi', 'hello', 'ok', 'okay', 'yo', 'hey there', 'hi there', 'hello there',
    // Arabic, and the same words typed in Latin letters
    'يا', 'هلا', 'هاي', 'اهلا', 'مرحبا', 'السلام عليكم', 'ya', 'hala', 'hala wallah', 'marhaba', 'ahlan', 'salam',
    // French
    'salut', 'bonjour', 'coucou', 'dis', 'he', 'eh', 'allo',
    // Spanish
    'hola', 'oye', 'oiga', 'buenas', 'ey',
];

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
    /** Who told the bot they are done, by space: nothing but its name (or a summon) reaches it from them until they say it. */
    private readonly closed = new Map<string, Set<number>>();

    constructor(
        botName: string,
        /** Seconds a person can go on without the name after the bot answered them, until Orbit says otherwise (see `useFollowUpSeconds`). */
        private followUp: number,
        /** Whether the bot is on a summon to this person right now. The summon itself says when that ends. */
        private readonly isSummonedBy: (userId: number) => boolean = () => false,
        /** Whether the bot is answering this person right now, or has their earlier line waiting its turn. */
        private readonly isBusyWith: (userId: number) => boolean = () => false,
        private readonly now: () => number = Date.now
    ) {
        this.name = plainWords(botName);
    }

    /** Seconds a person can go on without the name after the bot answered them. */
    get followUpSeconds(): number {
        return this.followUp;
    }

    /** Orbit's follow-up window for this bot (its voice limits), which replaces the one from the environment. Anything else is ignored. */
    useFollowUpSeconds(seconds: number): void {
        if (Number.isInteger(seconds) && seconds >= 0 && seconds <= MAX_FOLLOW_UP_SECONDS) this.followUp = seconds;
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
        this.closed.get(spaceName)?.delete(userId);
    }

    /** The bot left the space: nobody's window carries over to the next time. */
    spaceLeft(spaceName: string): void {
        this.people.delete(spaceName);
        this.answeredAt.delete(spaceName);
        this.closed.delete(spaceName);
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
        // They told the bot they are done: not even the answer to an earlier line, or a line of theirs waiting, brings them back
        if (this.closed.get(spaceName)?.has(speakerId)) return 'ignored';
        // A follow-up sent while the bot is still answering is part of that conversation (it may change or add to the ask)
        if (this.isBusyWith(speakerId)) return 'follow-up';
        const last = this.answeredAt.get(spaceName)?.get(speakerId);
        if (last !== undefined && this.now() - last < this.followUp * 1000) return 'follow-up';
        return 'ignored';
    }

    /**
     * Whether what this person said is for the bot. Their name from someone who had said they were done is what brings
     * them back (asking again about the same line gives the same answer: it is already back).
     */
    hears(spaceName: string, speakerId: number, text: string): boolean {
        const attention = this.attention(spaceName, speakerId, text);
        if (attention === 'named') this.closed.get(spaceName)?.delete(speakerId);
        return attention !== 'ignored';
    }

    /** Whether this person shares the bubble with at least one other person (#1670: only then does a window exist to end). */
    inGroup(spaceName: string, speakerId: number): boolean {
        return this.isGroup(spaceName, speakerId);
    }

    /**
     * The person told the bot they are done talking with it (#1670): their window is over at once, and they need the
     * name again. Nobody else's window is touched, and a summon is not ended by it (see `endable`). It stays over until
     * they say the name: an answer still on its way to them (a line said while the bot was thinking about "stop") does
     * not open a window again, so their talk with others around is not taken for the bot's.
     */
    ended(spaceName: string, speakerId: number): void {
        this.answeredAt.get(spaceName)?.delete(speakerId);
        let set = this.closed.get(spaceName);
        if (!set) this.closed.set(spaceName, (set = new Set()));
        set.add(speakerId);
    }

    /** Whether "stop" from this person can end something: others are here and the bot is not on a summon to them. */
    endable(spaceName: string, speakerId: number): boolean {
        return this.isGroup(spaceName, speakerId) && !this.isSummonedBy(speakerId);
    }

    /** The bot has answered this person: they can go on without its name for the follow-up window (not after they said they are done: see `ended`). */
    answered(spaceName: string, speakerId: number): void {
        if (this.closed.get(spaceName)?.has(speakerId)) return;
        let answers = this.answeredAt.get(spaceName);
        if (!answers) this.answeredAt.set(spaceName, (answers = new Map()));
        answers.set(speakerId, this.now());
    }
}
