/**
 * What a bot remembers about a person, one thing at a time (game #2003). The same list and the same keys as Orbit's
 * (`lib/bot-memory-items.ts` in the Orbit repository): a person looks at it and forgets from it there, and says "forget
 * that" here, and both name a thing by its key.
 *
 * - A thing is known by a key made from what it says (a hash, never the text). Forgetting keeps only that key.
 * - What was built from a thing goes with it: the events written for it, where it was said, and the lines of the chat it
 *   was drawn from.
 * - A thing that was forgotten stays gone, wherever the bot server still holds it. Only something the person says again
 *   afterwards (it carries when it was said, `drawnFrom`) is learned again.
 *
 * Both sides test the same key values; change the key's text on both sides together.
 */
import { createHash } from 'node:crypto';
import type { BotPlayerMemory } from './ConversationMemory';
import { mayUse, type Heard, type MemoryView } from './Heard';
import { DISLIKE_LABEL, plainThing, tastesIn } from './PersonalInfoRules';

export const MEMORY_ITEM_KINDS = ['name', 'birthday', 'pref', 'fact'] as const;
export type MemoryItemKind = (typeof MEMORY_ITEM_KINDS)[number];

export interface MemoryItem {
    /** Its key. This is what Forget names. */
    id: string;
    kind: MemoryItemKind;
    /** A name, a date, what they like, a fact's value. */
    value: string;
    /** For a fact: what it is about ("current_state"). */
    label: string | null;
    /** When it was said, in milliseconds; null when the bot did not keep it. */
    at: number | null;
    /** Said where nobody else was, or where nothing was kept about who was there. */
    private: boolean;
}

/** Facts the bot keeps for itself, not about the person: never listed, and gone with what they belong to. */
function isInternalFact(key: string): boolean {
    return key === 'birthday_today' || key === 'birthday_mentioned_at' || key.endsWith('_mentioned_at');
}

/** How the key of a thing is made. The same text as Orbit's. */
export function memoryItemKey(kind: MemoryItemKind, label: string | null, value: string): string {
    const canonical = kind === 'fact' ? `${label ?? ''}|${value}` : value;
    return createHash('sha256').update(`${kind}|${canonical.trim().toLowerCase()}`).digest('hex').slice(0, 32);
}

/** Said where nobody else was, or never stamped: private. The same rule as Orbit's `isPrivateHeard`. */
export function isPrivateHeard(heard: Heard | undefined): boolean {
    if (!heard) return true;
    if (heard.place === 'open') return false;
    return !(heard.place === 'nearby' && Array.isArray(heard.with) && heard.with.length > 0);
}

const positive = (value: unknown): number | null => {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : null;
};

/** When a stored birthday was said: where it was drawn from, else the time noted with it, else its event. Listing and dropping use the same one. */
function birthdayAt(memory: BotPlayerMemory): number | null {
    const info = memory.personalInfo;
    const event = memory.relationship.importantEvents.find((one) => one.event.startsWith('birthday'));
    return positive(info.drawnFrom?.birthday) ?? positive(info.facts.get('birthday_mentioned_at')) ?? positive(event?.timestamp);
}

/** When a stored fact was said: where it was drawn from, else (for how someone feels) the time noted with it. Listing and dropping use the same one. */
function factAt(info: BotPlayerMemory['personalInfo'], name: string, value: string): number | null {
    return positive(info.drawnFrom?.[`fact:${name}`]) ?? (name === 'current_state' ? positive(info.facts.get(`${value}_mentioned_at`)) : null);
}

/** The things in one person's memory, newest first where a date is known. */
export function memoryItemsOf(memory: BotPlayerMemory): MemoryItem[] {
    const info = memory.personalInfo;
    const privateOf = (key: string) => isPrivateHeard(info.heard?.[key]);
    const drawn = (key: string) => positive(info.drawnFrom?.[key]);
    const items: MemoryItem[] = [];
    if (info.name?.trim()) {
        items.push({ id: memoryItemKey('name', null, info.name), kind: 'name', value: info.name, label: null, at: drawn('name'), private: privateOf('name') });
    }
    if (info.birthday?.trim()) {
        const at = birthdayAt(memory);
        items.push({ id: memoryItemKey('birthday', null, info.birthday), kind: 'birthday', value: info.birthday, label: null, at, private: privateOf('birthday') });
    }
    for (const preference of info.preferences ?? []) {
        if (!preference.trim()) continue;
        const key = `pref:${preference}`;
        items.push({ id: memoryItemKey('pref', null, preference), kind: 'pref', value: preference, label: null, at: drawn(key), private: privateOf(key) });
    }
    for (const [name, value] of info.facts) {
        if (isInternalFact(name) || !String(value).trim()) continue;
        const key = `fact:${name}`;
        const at = factAt(info, name, String(value));
        items.push({ id: memoryItemKey('fact', name, String(value)), kind: 'fact', value: String(value), label: name, at, private: privateOf(key) });
    }
    return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => (b.item.at ?? -1) - (a.item.at ?? -1) || a.index - b.index)
        .map(({ item }) => item);
}

/**
 * What a reply for this view may be told the bot remembers: the things said where those present were also there, or
 * everything when the person is alone with the bot. A person's own list in a direct message is `'all'`.
 */
export function visibleItems(memory: BotPlayerMemory, view: MemoryView): MemoryItem[] {
    const info = memory.personalInfo;
    return memoryItemsOf(memory).filter((item) => {
        const key = item.kind === 'name' ? 'name' : item.kind === 'birthday' ? 'birthday' : item.kind === 'pref' ? `pref:${item.value}` : `fact:${item.label}`;
        return mayUse(info.heard?.[key], view);
    });
}

/** The shortest a phrase may be for lines of the chat to be taken out by the words they hold, when no line was noted. */
const MIN_PHRASE = 4;

/** Matches nothing: an echo that is only looked for in the reply right after its line. */
const NEVER = /(?!)/;

/** These words as their own words, not a piece of a longer one. */
function wholeWords(text: string, exactCase = false): RegExp {
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(text)}($|[^\\p{L}\\p{N}])`, exactCase ? 'u' : 'iu');
}

/** A name written with a capital ("Will", "Rose") is found only as written, so the word it is also ("will", "rose") is left alone. */
function sameCaseAsWritten(name: string): boolean {
    return name !== name.toLowerCase();
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LIKE_WORDS = `likes?|loves?|loved|enjoys?|enjoyed|prefer|prefers|preferred|adores?|favou?rite|fan of|into|go-to`;
const DISLIKE_WORDS = `hates?|hated|dislikes?|disliked|despises?|detests?|loathes?|avoid|avoids|(?:can['’]?t|cannot|can not) stand|(?:don['’]?t|do not|doesn['’]?t|does not) (?:like|enjoy|love)|not a fan of|not into|sick of|tired of`;

/** How a person gives their name, in any capitals: "my name is sara", "call me Ali", "I'm ali". Said again lower case, it is still their name. */
function givenAs(name: string): RegExp {
    return new RegExp(`(?:my name(?:['’]s| is)|call me|(?<![\\p{L}\\p{N}])i(?:['’]m| am)(?: called| named)?)\\s+${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'iu');
}

/** A bot line that tells the person what they like (or, with the dislike words, do not like) back ("You love tea", "You hate tea"), not one that only has the word. */
function saidBackToThem(text: string, words = LIKE_WORDS): RegExp {
    const word = `(^|[^\\p{L}\\p{N}])${escapeRegExp(text)}($|[^\\p{L}\\p{N}])`;
    const person = `(?<![\\p{L}\\p{N}])(you|your|you're|you've)(?![\\p{L}\\p{N}])`;
    const likes = `(?<![\\p{L}\\p{N}])(${words})(?![\\p{L}\\p{N}])`;
    // "You love tea" and "Tea is your favorite": the person, a word for liking, and the value, in either order, in one sentence
    return new RegExp(`${person}[^.!?\\n]{0,40}?${likes}[^.!?\\n]{0,25}?${word}|${word}[^.!?\\n]{0,40}?${person}[^.!?\\n]{0,40}?${likes}`, 'iu');
}

/**
 * Takes these things out of a person's memory, with what was built from them. Changes the memory it is given and returns
 * how many things went. With `forgotAt`, a thing the person said again after they forgot it (it carries when it was
 * said) stays.
 */
export function dropItems(memory: BotPlayerMemory, keys: ReadonlySet<string>, forgotAt?: ReadonlyMap<string, number>): number {
    if (keys.size === 0) return 0;
    const info = memory.personalInfo;
    const history = memory.conversationHistory;
    // Each thing being forgotten is an owner: a line it took remembers which thing took it, so the bot's reply after it is only
    // looked at for the words of that same thing
    let owner = 0;
    const doomedLines = new Map<object, Set<number>>();
    const phrases: Array<{ words: RegExp; owner: number }> = [];
    const echoes: Array<{ owner: number; at: number | null; ownName: boolean; words: RegExp; toldBack: RegExp }> = [];
    let removed = 0;

    const goes = (id: string, at: number | null) => {
        if (!keys.has(id)) return false;
        const forgot = forgotAt?.get(id);
        // A forget that carries no time (0) cannot say what was said after it, so it takes the thing whenever it was said
        return !(forgot !== undefined && forgot > 0 && at !== null && at > forgot);
    };
    const forgetPlace = (key: string) => {
        if (info.heard) delete info.heard[key];
        if (info.drawnFrom) delete info.drawnFrom[key];
    };
    // Short dislikes ("tea"): the person's lines that say they do not like it, found by what they say and not by the bare word
    const shortDislikes: Array<{ value: string; owner: number }> = [];
    const shortLikes: Array<{ value: string; owner: number }> = [];
    // Short names ("Ali"): the person's lines that give it ("my name is Ali", "I'm Ali", "call me Ali")
    const shortNames: Array<{ words: RegExp; owner: number }> = [];
    const takeLines = (at: number | null, phrase: string, ownName = false, taste: 'like' | 'dislike' | null = null) => {
        const dislike = taste === 'dislike';
        owner++;
        const mine = owner;
        if (at !== null) {
            for (const line of history) {
                if (line.timestamp === at && line.sender === 'person') doomedLines.set(line, (doomedLines.get(line) ?? new Set<number>()).add(mine));
            }
        }
        // The lines that say it back go too, the bot's and the person's: only the last line it was said in is noted, and a thing
        // said twice would otherwise leave the first. Words are matched whole ("Mark" is not "bookmark").
        if (phrase.trim().length >= MIN_PHRASE) phrases.push({ words: wholeWords(phrase.trim(), ownName && sameCaseAsWritten(phrase.trim())), owner: mine });
        // The lines that give a name are found in any capitals, for a long name too: "my name is sara" for "Sara"
        if (ownName && phrase.trim().length >= MIN_PHRASE) phrases.push({ words: givenAs(phrase.trim()), owner: mine });
        // A value too short to match everywhere ("Amy") is still said back in the reply right after the line it came from
        else if (phrase.trim().length > 0) {
            const short = phrase.trim();
            echoes.push({ owner: mine, at, ownName, words: wholeWords(short, ownName && sameCaseAsWritten(short)), toldBack: saidBackToThem(short, dislike ? DISLIKE_WORDS : LIKE_WORDS) });
            if (ownName) shortNames.push({ owner: mine, words: givenAs(short) });
            if (taste === 'dislike') shortDislikes.push({ value: short.toLowerCase(), owner: mine });
            else if (taste === 'like') shortLikes.push({ value: short.toLowerCase(), owner: mine });
        }
    };

    if (info.name) {
        const at = positive(info.drawnFrom?.name);
        if (goes(memoryItemKey('name', null, info.name), at)) {
            takeLines(at, info.name, true);
            delete info.name;
            forgetPlace('name');
            removed++;
        }
    }
    if (info.birthday) {
        const at = birthdayAt(memory);
        if (goes(memoryItemKey('birthday', null, info.birthday), at)) {
            takeLines(at, info.birthday);
            delete info.birthday;
            forgetPlace('birthday');
            memory.relationship.importantEvents = memory.relationship.importantEvents.filter((event) => !event.event.startsWith('birthday'));
            info.facts.delete('birthday_today');
            info.facts.delete('birthday_mentioned_at');
            removed++;
        }
    }
    if (info.preferences) {
        info.preferences = info.preferences.filter((preference) => {
            const key = `pref:${preference}`;
            const at = positive(info.drawnFrom?.[key]);
            if (!goes(memoryItemKey('pref', null, preference), at)) return true;
            // A favorite is kept as "pizza (favorite food)", and what is said in the chat is "pizza"
            takeLines(at, plainThing(preference), false, 'like');
            forgetPlace(key);
            removed++;
            return false;
        });
    }
    for (const [name, value] of [...info.facts]) {
        if (isInternalFact(name)) continue;
        const key = `fact:${name}`;
        const at = factAt(info, name, String(value));
        if (!goes(memoryItemKey('fact', name, String(value)), at)) continue;
        // How someone feels, and what they do not like, go with every line that says it, as a like does
        const dislike = name.startsWith(DISLIKE_LABEL);
        takeLines(at, name === 'current_state' || dislike ? String(value) : '', false, dislike ? 'dislike' : null);
        // The bot's reply right after the line this fact came from, when it says the value back, goes with it (a general fact's
        // value is never taken out of every line, so only that one reply is looked for)
        if (name !== 'current_state' && !dislike && String(value).trim() && at !== null) {
            echoes.push({ owner, at, ownName: false, words: wholeWords(String(value).trim()), toldBack: NEVER });
        }
        forgetPlace(key);
        info.facts.delete(name);
        // "tired" and when it was said
        if (name === 'current_state') info.facts.delete(`${value}_mentioned_at`);
        removed++;
    }

    if (doomedLines.size > 0 || phrases.length > 0 || echoes.length > 0 || shortDislikes.length > 0 || shortLikes.length > 0 || shortNames.length > 0) {
        // The things that take a person's line: the one it came from, the ones whose words it holds, and the ones it says as a taste or a name
        const takenBy = (line: BotPlayerMemory['conversationHistory'][number]): Set<number> => {
            const owners = new Set<number>();
            if (line.sender !== 'person') return owners;
            for (const one of doomedLines.get(line) ?? []) owners.add(one);
            for (const phrase of phrases) if (phrase.words.test(line.message)) owners.add(phrase.owner);
            for (const name of shortNames) if (name.words.test(line.message)) owners.add(name.owner);
            if (shortDislikes.length > 0 || shortLikes.length > 0) {
                const tastes = tastesIn(line.message);
                for (const dislike of shortDislikes) if (tastes.dislikes.some((one) => one.toLowerCase() === dislike.value)) owners.add(dislike.owner);
                for (const like of shortLikes) if (tastes.likes.some((one) => plainThing(one).toLowerCase() === like.value)) owners.add(like.owner);
            }
            return owners;
        };
        memory.conversationHistory = history.filter((line, index) => {
            if (takenBy(line).size > 0) return false;
            if (line.sender === 'person') return true;
            const text = line.message;
            if (phrases.some((phrase) => phrase.words.test(text))) return false;
            // The person's own name is not said back by the bot in any later line either: it is the person who forgot it
            if (echoes.some((echo) => echo.ownName && echo.words.test(text))) return false;
            // A later bot line that tells the person what they like back ("You love tea") goes too; one that only has the word stays
            if (echoes.some((echo) => echo.toldBack.test(text))) return false;
            // The bot's reply right after a line a thing took, when it says that same thing's short value back ("I like tea" / "Tea it is!")
            const before = history[index - 1];
            if (!before) return true;
            const owners = takenBy(before);
            return !(owners.size > 0 && echoes.some((echo) => owners.has(echo.owner) && echo.words.test(text)));
        });
    }
    if (removed > 0) info.lastInfoUpdate = Date.now();
    return removed;
}
