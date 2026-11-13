/**
 * What a bot remembers about a person, in the chat (game #2003): "what do you remember about me?" and "forget that".
 *
 * Both tools are for a direct message only, where the person is alone with the bot, so what they hear back is never read by
 * anyone else. They work on the same list a person sees in Orbit and name a thing by the same key. Forgetting is the
 * bot server's own: the thing is dropped from memory at once, with what was built from it, and Orbit is told by key so it
 * stays gone wherever a copy of the memory is held.
 */
import { memoryItemsOf, type MemoryItem } from '../memory/MemoryItems';
import type { BotPlayerMemory } from '../memory/ConversationMemory';

export const WHAT_I_REMEMBER_TOOL = 'what_i_remember';
export const FORGET_MEMORY_TOOL = 'forget_memory';
export const MEMORY_TOOL_NAMES: readonly string[] = [WHAT_I_REMEMBER_TOOL, FORGET_MEMORY_TOOL];

export function isMemoryTool(name: string): boolean {
    return MEMORY_TOOL_NAMES.includes(name);
}

type ToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: object } };

export function memoryToolDefinitions(): ToolDefinition[] {
    return [
        {
            type: 'function',
            function: {
                name: WHAT_I_REMEMBER_TOOL,
                description:
                    'List what you remember about this person, one thing at a time. Use it when they ask what you remember or know about them, and before forgetting something when it is not clear which thing they mean. ' +
                    'Tell them in your own words, short and plain. Never list the ids.',
                parameters: { type: 'object', properties: {} },
            },
        },
        {
            type: 'function',
            function: {
                name: FORGET_MEMORY_TOOL,
                description:
                    'Forget something you remember about this person. Use it the moment they ask you to forget it ("forget that", "forget my name", "forget I like coffee", "forget everything about my birthday"). ' +
                    'Never use it for a question ("when is my birthday?", "what do you remember?") or when they ask you to keep or not forget something. ' +
                    'Give the words of what to forget in `about`, or the ids from what_i_remember; when you give ids, only those things go and `about` is not looked at. The thing goes at once, with the lines of the chat it came from. ' +
                    'When it is clear which thing they mean, do it without asking them to confirm first, then tell them in one short sentence that it is forgotten. ' +
                    'When this says it is not clear which memory they mean, nothing was forgotten: ask them which one in one short sentence, offer the ones it lists, and forget the one they pick by its id. Never say you still remember it once it is forgotten.',
                parameters: {
                    type: 'object',
                    properties: {
                        about: { type: 'string', description: 'What to forget, in a few of the person\'s own words: "coffee", "my birthday", "my name", "that I was tired". Short, and only what they asked to forget.' },
                        ids: { type: 'array', items: { type: 'string' }, description: 'The ids of things from what_i_remember, when you know exactly which.' },
                    },
                },
            },
        },
    ];
}

/** What a bot with these tools is told with its instructions. */
export function memoryToolsNote(): string {
    return 'Memory: this person can ask what you remember about them (what_i_remember) and can ask you to forget any of it (forget_memory) at any time. Do it the moment they ask, and say so plainly. They can also look at, and forget from, the list in the chat menu.';
}

/** How a thing reads to the model, in plain words. */
function describe(item: MemoryItem): string {
    switch (item.kind) {
        case 'name':
            return `Their name is ${item.value}`;
        case 'birthday':
            return `Their birthday is ${item.value}`;
        case 'pref':
            return `They like ${item.value}`;
        default:
            return item.label === 'current_state' ? `They said they were ${item.value}` : `${item.label?.replace(/_/g, ' ') ?? 'A fact'}: ${item.value}`;
    }
}

/** Words that name a kind of thing, not what it is. */
const KIND_WORDS = new Set(['name', 'birthday']);

/** Words that may follow "name" or "birthday" without turning it into another thing ("my name now"). */
const MAY_FOLLOW = new Set([
    'now', 'again', 'today', 'tonight', 'tomorrow', 'yesterday', 'already', 'anymore', 'forever', 'permanently', 'completely', 'entirely', 'totally', 'immediately', 'instead', 'then', 'there', 'here',
    'please', 'pls', 'plz', 'thanks', 'thank', 'sorry', 'okay', 'right', 'asap', 'sure', 'actually', 'really', 'honestly',
]);

/** Words that put "name" or "birthday" in someone else's hands: "her birthday", "my dog name". */
const SOMEONE_ELSES = new Set([
    'his', 'her', 'hers', 'their', 'theirs', 'its', 'our', 'he', 'she', 'they', 'him', 'them', 'dog', 'cat', 'pet', 'friend', 'mom', 'mum', 'dad', 'boss', 'wife', 'husband', 'brother', 'sister', 'kid', 'son', 'daughter', 'partner', 'child',
]);

/**
 * The only other words a request may hold for "name" or "birthday" to be clearly the person's own: who it belongs to ("my",
 * "me") and the plain words around a request to forget ("can you forget that my name please"). Words that ask for it to be
 * told or kept ("tell", "know", "remember", "what", "when") are not among them: "tell me my name" is not a request to forget.
 * Anything else in the phrase ("dog", "friend", "Sam's", "cake", "gave", "of Sam") makes it not clearly theirs.
 */
const OWN_FILLER = new Set([
    'my', 'me', 'i', 'mine', 'myself', 'the', 'a', 'an', 'that', 'this', 'is', 'was', 'are', 'to', 'of', 'and', 'it', 'about',
    'forget', 'delete', 'remove', 'erase', 'clear', 'drop', 'please', 'pls', 'you', 'do', 'does', 'can', 'could', 'will', 'would',
    'everything', 'all', 'anything',
]);

/** Said just before a value, so that the value is the person's own name or date: "my name is Mark". */
const VALUE_LEADS = new Set(['is', 'was', 'as', 'called']);

/** Words around a request that say nothing about which thing is meant, when it is not a name or a birthday. */
const FILLER = new Set([
    ...OWN_FILLER, ...MAY_FOLLOW, 'am', "i'm", 'im', "i've", 'ive', 'like', 'likes', 'love', 'loves', 'prefer', 'prefers', 'enjoy', 'enjoys', 'said', 'say', 'says', 'told', 'mentioned', 'thing', 'things', 'stuff', 'something', 'be', 'been', 'were', 'just', 'also', 'too', 'only',
]);

/** Words that turn a thing around. "tired" and "not tired" are different things. */
const NEGATIONS = new Set(['not', 'no', 'never', 'without', 'nothing', "don't", 'dont', "isn't", "wasn't", "aren't", "doesn't", "didn't"]);

const POSSESSIVE = /['’]s$|s['’]$/u;

/** The words of a phrase, lower-case and in one spelling of each letter. Apostrophes and hyphens inside a word stay in it ("o'brien", "jean-luc"). */
function tokensOf(text: string): string[] {
    return text
        .toLowerCase()
        .normalize('NFC')
        .replace(/[‘’]/gu, "'")
        .split(/[^\p{L}\p{N}'-]+/u)
        .map((token) => token.replace(/^['-]+|-+$/gu, ''))
        .filter(Boolean);
}

/** The same thing said in another way becomes one way: "date of birth" is "birthday", "my full name" is "my name". */
function plainly(text: string): string {
    return text
        .toLowerCase()
        .replace(/[‘’]/gu, "'")
        .replace(/\bdate of birth\b|\bb-?day\b/gu, 'birthday')
        .replace(/\b(?:full|first|last|whole|real|legal)\s+name\b/gu, 'name')
        .replace(/\bfor (?:now|good|me|you)\b/gu, ' ');
}

/**
 * Whether "name" or "birthday" in these words is the person's own, decided from the whole phrase and always on the side of
 * keeping it: "my dog's name", "her birthday", "the name of my dog" and "Sam's birthday" are somebody else's, and forgetting is
 * for good. It is theirs only when the target word is there and every other word is who it belongs to, a plain word around a
 * request, or the remembered value said right after "is" ("forget that my name is Mark"; "the name of Mark" is not enough, as
 * Mark may be somebody else). A person who says it any other way is asked which one, and is shown the list.
 */
function isAboutThem(tokens: readonly string[], words: readonly string[], ownValue: string): boolean {
    if (!tokens.some((token) => words.includes(token))) return false;
    const valueTokens = new Set(tokensOf(ownValue));
    let valueNext = false;
    return tokens.every((token, index) => {
        const before = tokens[index - 1];
        if (words.includes(token) || KIND_WORDS.has(token)) {
            valueNext = false;
            return !(before !== undefined && ((POSSESSIVE.test(before) && !OWN_FILLER.has(before)) || SOMEONE_ELSES.has(before)));
        }
        if (valueNext && valueTokens.has(token)) return true;
        valueNext = VALUE_LEADS.has(token);
        return OWN_FILLER.has(token) || MAY_FOLLOW.has(token) || VALUE_LEADS.has(token);
    });
}

/** What a thing says, without the plain words around it: a fact is its label and its value ("next trip Paris"). */
function wordsOf(item: MemoryItem): { value: string[]; whole: string[] } {
    const value = tokensOf(item.value).filter((token) => !FILLER.has(token));
    const label = item.kind === 'fact' && item.label && item.label !== 'current_state' ? tokensOf(item.label.replace(/_/g, ' ')).filter((token) => !FILLER.has(token)) : [];
    return { value, whole: [...label, ...value] };
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((word, index) => word === b[index]);

/** Where these words sit inside those, whole and in order; -1 when they do not. */
function placeOf(words: readonly string[], inside: readonly string[]): number {
    for (let start = 0; start + words.length <= inside.length; start++) if (words.every((word, offset) => inside[start + offset] === word)) return start;
    return -1;
}

/**
 * The preferences and facts these words are about, and the ones they could be about but do not settle. Every word that is
 * not a plain word around a request must be part of the thing, in order, with its kind and its label: "my next trip to Paris"
 * is the trip and not the home city, "my sister likes coffee" is nothing of theirs, "pizza place" is not "pizza", and "tired"
 * is not "not tired". Said whole (or as its value) a thing is meant; said in part, it is meant only when it is the one thing
 * that holds those words.
 */
function matchesOf(items: readonly MemoryItem[], tokens: readonly string[]): { picked: MemoryItem[]; unsure: MemoryItem[] } {
    const asked = tokens.filter((token) => !FILLER.has(token));
    if (asked.length === 0) return { picked: [], unsure: [] };
    const whole: MemoryItem[] = [];
    const part: MemoryItem[] = [];
    for (const item of items) {
        if (item.kind !== 'pref' && item.kind !== 'fact') continue;
        const { value, whole: held } = wordsOf(item);
        if (same(asked, value) || same(asked, held)) {
            whole.push(item);
            continue;
        }
        const start = placeOf(asked, held);
        // "coffee" is the start of "coffee, no sugar", but "sugar" is only what comes after a "no", and "tired" is not "not tired"
        const turned = start > 0 && NEGATIONS.has(held[start - 1]) && !NEGATIONS.has(asked[0]);
        if (start >= 0 && !turned) part.push(item);
    }
    const best = whole.length > 0 ? whole : part;
    return best.length === 1 ? { picked: best, unsure: [] } : { picked: [], unsure: best };
}

interface Clause {
    text: string;
    /** Said to be kept: "but not tea", "remember my birthday", "don't forget". */
    keep: boolean;
}

/** Words that ask for something to be kept or told, not forgotten. */
/** Words that point back at what was just said. */
const PRONOUNS = new Set(['it', 'that', 'this', 'them', 'those', 'these', 'one', 'ones']);
const KEEP_WORDS = new Set(['remember', 'keep', 'save', 'leave', 'remind']);
const FORGET_WORDS = new Set(['forget', 'delete', 'remove', 'erase', 'drop', 'clear']);
const NOT_FORGET = /\b(?:do\s*n['o]?t|do not|never)\s+(?:forget|delete|remove|erase|drop|clear)\b/u;

/**
 * Whether a clause asks for something to be kept: "don't forget", or "remember"/"keep" anywhere in it, or what follows a
 * "but", "except" or "not". A clause that says forget, delete, remove or erase is never one ("remember coffee but forget tea").
 */
function asksToKeep(text: string, joiner: string, first: boolean): boolean {
    if (NOT_FORGET.test(text)) return true;
    const tokens = tokensOf(text);
    if (tokens.some((token) => FORGET_WORDS.has(token))) return false;
    if (tokens.some((token) => KEEP_WORDS.has(token))) return true;
    return !first && (joiner === 'but' || joiner === 'except' || joiner === 'although' || joiner === 'though' || /^(?:not|no)\s/u.test(text));
}

/** A request cut into the things it asks about, and what it says to keep. Words joining them ("and", "but") are at a boundary. */
function clausesOf(asked: string): Clause[] {
    const parts = asked.split(/(;|[.!?]+|,(?=\s*(?:and|but|then|except|remember|keep|not|don'?t|do not)\s)|(?<=\s)(?:and|but|then|also|except|plus|while|although|though)(?=\s))/u);
    const clauses: Clause[] = [];
    let joiner = '';
    for (const part of parts) {
        const text = part.trim();
        if (/^(?:;|[.!?]+|,|and|but|then|also|except|plus|while|although|though)$/u.test(text)) {
            joiner = text;
            continue;
        }
        if (text) clauses.push({ text, keep: asksToKeep(text, joiner, clauses.length === 0) });
        joiner = '';
    }
    return clauses;
}

/** What one request says to forget: the things, the ones it could mean but does not settle, and whether it settled everything. */
export interface Forgetting {
    chosen: MemoryItem[];
    unsure: MemoryItem[];
    /** Every part of the request is one clear thing, and there is at least one. */
    clear: boolean;
    /** It asked only for things to be kept. */
    keepOnly: boolean;
}

/**
 * What these words ask to forget. Forgetting is for good, so a part of the request that is not clearly one thing of this
 * person's, or that someone else's words or a "not" would change, settles nothing: the whole request forgets nothing and the
 * caller asks which memory is meant. A thing said to be kept ("but not tea", "and remember my birthday") is never taken.
 */
export function resolveForgetting(items: MemoryItem[], about: string): Forgetting {
    const asked = plainly(about).trim();
    const none: Forgetting = { chosen: [], unsure: [], clear: false, keepOnly: false };
    if (!asked) return none;
    const chosen = new Map<string, MemoryItem>();
    const kept = new Set<string>();
    const unsure = new Map<string, MemoryItem>();
    let unsettled = false;
    let asking = 0;
    let lastAsked: MemoryItem[] = [];
    for (const clause of clausesOf(asked)) {
        const tokens = tokensOf(clause.text);
        // "keep coffee" and "remember my name" name the thing after the verb: the verb is not part of what is named
        const found = resolveClause(items, clause.keep ? tokens.filter((token) => !KEEP_WORDS.has(token) && !FORGET_WORDS.has(token)) : tokens);
        if (clause.keep) {
            for (const item of found.picked) kept.add(item.id);
            // "my name, remember it": a keep that names nothing but "it" is about what was just said, so that is kept, not forgotten
            if (found.picked.length === 0 && tokens.every((token) => FILLER.has(token) || KEEP_WORDS.has(token) || PRONOUNS.has(token) || NEGATIONS.has(token) || FORGET_WORDS.has(token))) for (const item of lastAsked) kept.add(item.id);
            continue;
        }
        asking++;
        for (const item of found.unsure) unsure.set(item.id, item);
        if (found.picked.length === 0) unsettled = true;
        for (const item of found.picked) chosen.set(item.id, item);
        lastAsked = found.picked;
    }
    const taken = [...chosen.values()].filter((item) => !kept.has(item.id));
    // A stored thing can have "and" in it ("fish and chips" beside "fish"). When the whole request is exactly one such thing,
    // cutting it at the "and" must not take more than that thing: if it would, which one is meant is asked, not guessed.
    const whole = wholeThingOf(items, asked);
    if (whole && !unsettled && taken.some((item) => item.id !== whole.id)) {
        for (const item of [whole, ...taken]) unsure.set(item.id, item);
        return { chosen: [], unsure: [...unsure.values()], clear: false, keepOnly: false };
    }
    return {
        chosen: unsettled ? [] : taken,
        unsure: [...unsure.values()],
        clear: asking > 0 && !unsettled && taken.length > 0,
        keepOnly: asking === 0,
    };
}

/** The one preference or fact that this whole request says, word for word, when it is cut up by "and" or the like. */
function wholeThingOf(items: readonly MemoryItem[], asked: string): MemoryItem | undefined {
    const words = tokensOf(asked).filter((token) => !FILLER.has(token));
    if (words.length === 0) return undefined;
    const hits = items.filter((item) => {
        if (item.kind !== 'pref' && item.kind !== 'fact') return false;
        const { value, whole } = wordsOf(item);
        return same(words, value) || same(words, whole);
    });
    return hits.length === 1 ? hits[0] : undefined;
}

function resolveClause(items: readonly MemoryItem[], tokens: readonly string[]): { picked: MemoryItem[]; unsure: MemoryItem[] } {
    const nameWords = tokens.some((token) => token === 'name');
    const birthdayWords = tokens.some((token) => token === 'birthday');
    // Two kinds in one clause ("forget my name remember my birthday") is two requests said as one: it settles nothing
    if (nameWords && birthdayWords) return { picked: [], unsure: items.filter((item) => item.kind === 'name' || item.kind === 'birthday') };
    // The person's own name and birthday are decided only by whether they were asked for as theirs ("my name", "birthday").
    // Their value inside a longer phrase ("my friend Mark", "the name of Mark", "the party on 12 June") is about someone or
    // something else. Someone who says only the value is shown the list.
    const kind = nameWords ? 'name' : birthdayWords ? 'birthday' : null;
    if (kind) {
        const item = items.find((one) => one.kind === kind);
        if (isAboutThem(tokens, kind === 'name' ? ['name'] : ['birthday'], item?.value ?? '')) return { picked: item ? [item] : [], unsure: [] };
    }
    return matchesOf(items, tokens);
}

/** The things these words ask to forget, when they settle it; nothing otherwise. */
export function itemsAbout(items: MemoryItem[], about: string): MemoryItem[] {
    return resolveForgetting(items, about).chosen;
}

/** The most characters of a request to forget that are weighed. A longer one is not cut: a "but not" past the cut would be lost, so it is not acted on. */
const ABOUT_MOST = 200;

export interface MemoryToolContext {
    memory: BotPlayerMemory | null | undefined;
    /** Drops these things from memory, with what was built from them, and tells Orbit. Returns how many went. */
    forget: (keys: ReadonlySet<string>, kinds: ReadonlyMap<string, string>) => Promise<number | { went: number; waiting: number }>;
}

/** Runs one of the two tools. Never throws: the model is told in plain words what happened. */
export async function runMemoryTool(name: string, args: Record<string, unknown>, context: MemoryToolContext): Promise<Record<string, unknown>> {
    if (!context.memory) return { error: "That can't be done in this chat right now." };
    const items = memoryItemsOf(context.memory);

    if (name === WHAT_I_REMEMBER_TOOL) {
        return items.length === 0
            ? { things: [], note: 'You remember nothing about them yet. Say so.' }
            : { things: items.map((item) => ({ id: item.id, what: describe(item) })) };
    }

    if (name === FORGET_MEMORY_TOOL) {
        const ids = Array.isArray(args.ids) ? args.ids.filter((id): id is string => typeof id === 'string') : [];
        const about = typeof args.about === 'string' ? args.about : '';
        if (ids.length === 0 && !about.trim()) return { error: 'Say what to forget, or call what_i_remember first and ask them which one.' };
        if (items.length === 0) return { forgotten: [], note: 'You remember nothing about them, so there is nothing to forget. Tell them so in one short sentence.' };
        const unclear = (why: string, among: readonly MemoryItem[] = items) => ({
            forgotten: [],
            unclear: true,
            things: (among.length > 0 ? among : items).map((item) => ({ id: item.id, what: describe(item) })),
            note: `${why} Nothing was forgotten. Tell them in one short sentence, like "I haven't forgotten anything yet. Which memory do you mean?", and offer the ones in things in your own words (never the ids). When they say which, call forget_memory with its id.`,
        });
        const chosen = new Map<string, MemoryItem>();
        let notFound = 0;
        if (ids.length > 0) {
            // Ids say exactly which things, and nothing else is added by words: a stale id is not a reason to guess
            for (const id of new Set(ids)) {
                const item = items.find((one) => one.id === id);
                if (item) chosen.set(item.id, item);
                else notFound++;
            }
            if (chosen.size === 0) return unclear('None of those ids is a thing you remember now.');
        } else {
            // A question is never a request to forget, whatever it names ("when is my birthday?")
            if (/\?\s*$/u.test(about) || /^\s*(?:when|what|who|where|how|why|which)(?:'?s|\s+(?:is|are|was|were|does|do|did))\b|^\s*(?:do|did|does)\s+(?:you|i)\b/iu.test(about)) {
                return { forgotten: [], note: 'That was a question, not a request to forget, so nothing was forgotten. Answer it instead.' };
            }
            if (about.length > ABOUT_MOST) {
                return unclear('That is too much to pick one thing from: a part of it could change what is meant.');
            }
            const forgetting = resolveForgetting(items, about);
            if (forgetting.keepOnly) return { forgotten: [], note: 'They asked you to keep it, not to forget it. Nothing was forgotten. Tell them in one short sentence that you will keep it.' };
            if (!forgetting.clear) return unclear('It is not clear which memory they mean.', forgetting.unsure);
            for (const item of forgetting.chosen) chosen.set(item.id, item);
        }
        try {
            const result = await context.forget(new Set(chosen.keys()), new Map([...chosen].map(([id, item]) => [id, item.kind])));
            const went = typeof result === 'number' ? result : result.went;
            const waiting = typeof result === 'number' ? 0 : result.waiting;
            const missed = notFound > 0 ? ` ${notFound} of the ids were not things you remember.` : '';
            if (went === 0) return { forgotten: [], note: `Nothing was removed just now: ${chosen.size === 1 ? 'it was' : 'they were'} already gone.${missed} Tell them so in one short sentence, and do not say it was forgotten just now.` };
            if (went < chosen.size) return { count: went, asked: chosen.size, note: `Only ${went} of the ${chosen.size} things went; the rest were already gone.${missed} Tell them so in one short sentence, and do not say all of it was forgotten.` };
            // Orbit could not take it just now: it is gone from this chat and is being sent again, so do not say it is gone for good
            if (waiting > 0) return { forgotten: [...chosen.values()].map(describe), count: went, saving: 'waiting', note: `It is forgotten in this chat, with the lines it came from, but the saved copy could not be cleared just now. It is tried again soon.${missed} Tell them in one short sentence that it is forgotten here and that clearing the saved copy is still going, and do not repeat what it was.` };
            return { forgotten: [...chosen.values()].map(describe), count: went, note: `It is forgotten, with the lines of this chat it came from.${missed} Tell them in one short sentence, and do not repeat what it was.` };
        } catch (error) {
            console.warn('[MemoryTools] Could not forget:', error instanceof Error ? error.message : error);
            return { error: 'It could not be forgotten just now. Say so in one plain sentence and offer to try again.' };
        }
    }
    return { error: 'Unknown tool.' };
}
