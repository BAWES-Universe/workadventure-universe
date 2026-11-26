/**
 * What a bot may take from a person's words as something about them, and what it may keep of an image's description.
 *
 * Only a durable thing the person said about themselves is kept: their own name, their own birthday, what they like or do
 * not like, how they feel. Never what a line says about the bot ("I don't like how slow you are"), about someone else
 * ("my friend's name is Sam", "it's Sam's birthday"), or about a task ("connect my Google mail"). A thing said with a
 * "not" is never kept as if it were said without one.
 *
 * Plain functions with no state, so each rule is tested on its own (see PersonalInfoRules.test.ts).
 */

const APOS = `['’]`;
const SENTENCE_END = /(?<=[.!?\n])\s+|\n+/u;

/** The lines of a message, each with the mark it ended with: a question is never a statement about the person. */
function sentencesOf(message: string): Array<{ text: string; question: boolean }> {
    const parts = message.split(SENTENCE_END).map((part) => part.trim()).filter(Boolean);
    return parts.map((text) => ({ text, question: /\?\s*$/u.test(text) }));
}

const CLAUSE_END = /\s*(?:[,;:]|\b(?:and|but|though|although|however|because|while|yet)\b)\s*/iu;

/**
 * The parts of a message that each say one thing ("I'm not hungry, I'm tired" is two), each with whether its sentence was a
 * question. A "not" is only looked for in the part that holds the thing, so "my name is Sara and I don't like tea" keeps the name.
 */
function clausesOf(message: string): Array<{ text: string; question: boolean }> {
    return sentencesOf(message).flatMap((sentence) =>
        sentence.text
            .split(CLAUSE_END)
            .map((text) => text.trim())
            .filter(Boolean)
            .map((text) => ({ text, question: sentence.question })),
    );
}

/** Words said just before "like" / "feel" / "am" that turn it around, or put it in another's mouth. */
const NEGATED = new RegExp(`\\b(?:not|never|no longer|hardly|barely|rarely|dont|cannot|can${APOS}?t|won${APOS}?t|isn${APOS}?t|wasn${APOS}?t|don${APOS}?t|doesn${APOS}?t|didn${APOS}?t|n${APOS}t)\\b|n${APOS}t\\b`, 'iu');

// ---- Name -------------------------------------------------------------------------------------------------------------

/** Capitalised words that follow "I'm" or "call me" without being a name. */
const NOT_A_NAME = new Set([
    'sorry', 'fine', 'good', 'great', 'okay', 'ok', 'not', 'just', 'back', 'here', 'there', 'going', 'trying', 'looking', 'glad', 'happy',
    'sure', 'done', 'ready', 'afraid', 'curious', 'interested', 'using', 'also', 'still', 'only', 'really', 'very', 'so', 'too', 'new', 'in',
    'on', 'at', 'from', 'with', 'a', 'an', 'the', 'your', 'my', 'now', 'today', 'tomorrow', 'later', 'again', 'maybe', 'please', 'thanks',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
    'hungry', 'sad', 'tired', 'excited', 'angry', 'frustrated', 'worried', 'scared', 'nervous', 'thirsty', 'bored', 'lonely', 'confused', 'sick', 'ill',
    'busy', 'late', 'early', 'free', 'online', 'offline', 'stuck', 'lost', 'home', 'out', 'off', 'about', 'wondering', 'thinking', 'having', 'doing', 'being',
    'google', 'gmail', 'github', 'slack', 'notion', 'calendar', 'email', 'universe', 'brick',
]);

// What may follow a bare "I'm Sara" for it to be a name and not the start of a longer phrase ("I'm Google mail" is not a name):
// the end, a mark, a surname, an emoji, or a plain word of chat. After "my name is" or "call me" anything may follow.
const AFTER_NAME = new RegExp(`^(?:$|\\s*[.,!?;:)]|\\s+\\p{Lu}\\p{Ll}|\\s*\\p{Extended_Pictographic}|\\s+(?:so|from|here|btw|by the way|nice|hi|hello|lol|haha|please|pls|thanks|too|again|now|today)\\b|\\s*[-–—]\\s)`, 'u');

const NAME_FORMS: Array<{ form: RegExp; bare: boolean }> = [
    { form: new RegExp(`\\b[Mm]y name(?:${APOS}s| is)\\s+(\\p{Lu}\\p{Ll}{1,19})`, 'u'), bare: false },
    { form: new RegExp(`\\b[Cc]all me\\s+(\\p{Lu}\\p{Ll}{1,19})`, 'u'), bare: false },
    { form: new RegExp(`\\b[Ii](?:${APOS}m| am)\\s+(?:called|named)\\s+(\\p{Lu}\\p{Ll}{1,19})`, 'u'), bare: false },
    { form: new RegExp(`(?:^|\\b(?:[Hh]i|[Hh]ello|[Hh]ey)\\W+)[Ii](?:${APOS}m| am)\\s+(\\p{Lu}\\p{Ll}{1,19})`, 'u'), bare: true },
];

/** The person's own name, only when they say it is: "my name is Sara", "call me Sara", "I'm Sara". */
export function nameIn(message: string): string | null {
    for (const sentence of clausesOf(message)) {
        if (sentence.question || NEGATED.test(sentence.text)) continue;
        for (const { form, bare } of NAME_FORMS) {
            const match = form.exec(sentence.text);
            if (!match?.[1]) continue;
            const name = match[1];
            if (NOT_A_NAME.has(name.toLowerCase())) continue;
            const rest = sentence.text.slice((match.index ?? 0) + match[0].length);
            if (bare && !AFTER_NAME.test(rest)) continue;
            return name;
        }
    }
    return null;
}

// ---- Likes and dislikes -----------------------------------------------------------------------------------------------

const LIKE_VERBS = 'like|love|enjoy|adore|prefer';
const DISLIKE_VERBS = 'hate|dislike|despise|detest|loathe';

/** A thing the person likes or does not: its words are short, and not about the bot or about another person. */
const MAX_PHRASE_WORDS = 6;
const MAX_PHRASE_CHARS = 60;
/** What a phrase starts with when it is a remark about the moment, the bot, or someone else, and not a thing the person likes. */
const NOT_A_THING = /^(?:how|that|when|the way|it when|it that|if|whether|what|who|why|being|you\b|your\b|my\b|our\b|his\b|her\b|their\b|him\b|them\b|me\b|myself\b|us\b|this\b|these\b|those\b|it\b|its\b|there\b|her\b|something\b|anything\b|everything\b|nothing\b|one\b|so\b|too\b)/iu;
/** A phrase that speaks to the bot ("to bother you") is a remark, not a taste. */
const ABOUT_THE_BOT = /(?<![\p{L}\p{N}])(?:you|your|yours|you['’]re|you['’]ve|you['’]ll|yourself)(?![\p{L}\p{N}])/iu;
const CONTACT = /@|https?:\/\/|www\.|\d{5,}/u;

/** The thing itself out of what follows "like": cut where another clause starts, and without the words that only add to it. */
function thingOf(rest: string): string | null {
    let phrase = rest
        .split(/\s*(?:[;:()]|,\s*(?:thanks|thank you|thx|please|pls|lol|haha|honestly|though|ok|okay|really|btw)\b|\s[-–—]\s|\b(?:but|because|since|so|though|although|except|unless|when|whenever|if|which|that|and then)\b)/iu)[0]
        .replace(/\s+(?:too|a lot|a bit|very much|so much|as well|also|though|however|anymore|now|again|right now|lol|lmao|haha|btw|please|pls|thanks|thank you|honestly|tbh)$/iu, '')
        .trim()
        .replace(/[\s,.!?…"'`“”]+$/u, '');
    if (!phrase || phrase.length > MAX_PHRASE_CHARS || phrase.split(/\s+/u).length > MAX_PHRASE_WORDS) return null;
    if (NOT_A_THING.test(phrase) || ABOUT_THE_BOT.test(phrase) || CONTACT.test(phrase)) return null;
    // A word or two with a letter in it
    if (!/\p{L}/u.test(phrase)) return null;
    return phrase;
}

const LIKE = new RegExp(`(?:^|[\\s,;:(])[Ii]\\s+((?:(?:really|absolutely|totally|just|also|still|actually|truly|definitely|always|kind of|sort of|do)\\s+)*)(${LIKE_VERBS}|${DISLIKE_VERBS})\\s+(.+)$`, 'u');
const NEG_LIKE = new RegExp(`(?:^|[\\s,;:(])[Ii]\\s+(?:(?:really|absolutely|totally|just|also|actually|truly|definitely|do)\\s+)*(?:don${APOS}?t|do not|never|no longer|can${APOS}?t stand|cannot stand|can${APOS}?t bear|hardly|barely|dont)\\s+(?:(?:really|actually|truly|much|particularly|even)\\s+)*(${LIKE_VERBS}|care for|enjoy)\\s+(.+)$`, 'iu');
const CANT_STAND = new RegExp(`(?:^|[\\s,;:(])[Ii]\\s+(?:can${APOS}?t|cannot)\\s+(?:stand|bear|stomach)\\s+(.+)$`, 'iu');
const FAVORITE = new RegExp(`\\bmy\\s+(?:all[- ]time\\s+)?favou?rite\\s+((?:\\p{L}+\\s+){0,2}?)(?:is|are)\\s+(.+)$`, 'iu');

/** A sentence with two things said by the person ("I like tea and I hate coffee") as one line for each; "and my sister hates it" is cut off, as it is not theirs. */
const NEXT_SAYING = /\s*(?:,\s*)?\b(?:and|but|while|though|although|then|yet)\s+(?=(?:[Ii]|[Mm]y|[Mm]y)(?![\p{L}\p{N}]|['’]s))/u;
function sayingsOf(sentence: { text: string; question: boolean }): Array<{ text: string; question: boolean }> {
    return sentence.text
        .split(NEXT_SAYING)
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text) => ({ text, question: sentence.question }));
}

/** Words before "I like ..." that make it a doubt or a question and not something they say: "I don't think I like jazz", "I'm not sure I like it", "if I like it". */
const HEDGE = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:not|never|doubt|wonder|wondering|unsure|if|whether|maybe|perhaps|might|guess|suppose|dunno|idk)(?![\\p{L}\\p{N}])|n${APOS}t(?![\\p{L}\\p{N}])`, 'iu');

/** What a dislike is called among what the bot remembers: one thing each, so each keeps where it was said and can be forgotten alone. */
export const DISLIKE_LABEL = 'dislike_';
export function dislikeLabel(thing: string): string {
    const slug = thing.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    return `${DISLIKE_LABEL}${slug || 'thing'}`;
}

export interface Tastes {
    likes: string[];
    dislikes: string[];
}

/**
 * What the person says they like and do not like, about themselves. "I like pizza" is a like; "I don't like coffee" and "I
 * hate coffee" are dislikes; "I don't like how slow you are" (a remark about the bot) and "do you like pizza?" are neither.
 */
export function tastesIn(message: string): Tastes {
    const likes: string[] = [];
    const dislikes: string[] = [];
    const push = (list: string[], value: string | null) => {
        if (value && !list.some((kept) => kept.toLowerCase() === value.toLowerCase())) list.push(value);
    };
    for (const sentence of sentencesOf(message).flatMap(sayingsOf)) {
        if (sentence.question) continue;
        const text = sentence.text;
        const negative = NEG_LIKE.exec(text) ?? CANT_STAND.exec(text);
        if (negative) {
            if (!HEDGE.test(text.slice(0, negative.index))) push(dislikes, thingOf(negative[negative.length - 1]));
            continue;
        }
        const favourite = FAVORITE.exec(text);
        if (favourite) {
            // "isn't" never reaches here: the form is "is" or "are" right after the kind of thing
            const thing = thingOf(favourite[2]);
            const kind = favourite[1].trim();
            push(likes, thing && !NEGATED.test(favourite[1]) ? (kind ? `${thing} (favorite ${kind})` : `${thing} (favorite)`) : null);
            continue;
        }
        const positive = LIKE.exec(text);
        if (positive) {
            // "I don't think I like jazz", "not sure I like it": a doubt, not a taste
            if (HEDGE.test(text.slice(0, positive.index))) continue;
            const verb = positive[2].toLowerCase();
            // "I never really like" etc. were taken above; a leftover "not" before the verb is not a like
            if (NEGATED.test(positive[1] ?? '')) continue;
            push(DISLIKE_VERBS.split('|').includes(verb) ? dislikes : likes, thingOf(positive[3]));
        }
    }
    return { likes, dislikes };
}

// ---- How they feel ----------------------------------------------------------------------------------------------------

const STATES = 'hungry|sad|happy|tired|excited|angry|frustrated|worried|scared|nervous|thirsty|bored|lonely|confused|sick|ill|fine|okay|ok';
const STATE = new RegExp(`\\bi(?:${APOS}m| am| feel)\\s+(${STATES})\\b(?!\\s+(?:of|with|about)\\b)`, 'iu');

/** How the person says they feel now ("I'm tired"), and not what they say they do not ("I'm not tired", "am I tired?"). */
export function stateIn(message: string): string | null {
    for (const sentence of clausesOf(message)) {
        if (sentence.question || NEGATED.test(sentence.text)) continue;
        const match = STATE.exec(sentence.text);
        if (match?.[1]) return match[1].toLowerCase();
    }
    return null;
}

// ---- Birthday ---------------------------------------------------------------------------------------------------------

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';
const BIRTHDAY_TODAY = new RegExp(`\\b(?:it${APOS}?s|today(?: is)?|today${APOS}s)\\s+my\\s+(?:birthday|bday)\\b|\\bmy\\s+(?:birthday|bday)\\s+(?:is\\s+)?today\\b`, 'iu');
const BIRTHDAY_ON = [
    new RegExp(`\\bmy\\s+(?:birthday|bday)(?:${APOS}s)?\\s+(?:(?:is|was)\\s+)?(?:on\\s+)?((?:${MONTHS})\\s+\\d{1,2})(?:st|nd|rd|th)?\\b`, 'iu'),
    /\bmy\s+(?:birthday|bday)(?:['’]s)?\s+(?:(?:is|was)\s+)?(?:on\s+)?(\d{1,2}[/-]\d{1,2})\b/iu,
];

/** True when the person says it is their own birthday today (not a friend's, and not "it's not my birthday"). */
export function birthdayIsToday(message: string): boolean {
    return clausesOf(message).some((sentence) => !sentence.question && !NEGATED.test(sentence.text) && BIRTHDAY_TODAY.test(sentence.text));
}

/** The day the person says their own birthday is, as they wrote it ("March 3", "3/3"). */
export function birthdayDateIn(message: string): string | null {
    for (const sentence of clausesOf(message)) {
        if (sentence.question || NEGATED.test(sentence.text)) continue;
        for (const form of BIRTHDAY_ON) {
            const match = form.exec(sentence.text);
            if (match?.[1]) return match[1];
        }
    }
    return null;
}

// ---- Images -----------------------------------------------------------------------------------------------------------

/** How much of an image's description the chat's history keeps: enough to answer "what was in that picture?", not its contents. */
export const VISION_NOTE_CHARS = 300;

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
// A phone number or any long run of digits (an id, a card): seven digits or more, with the usual separators between
const NUMBER_RUN = /(?:\+?\d[\d\s().-]{5,}\d)/gu;

/** Takes out e-mail addresses and phone or id numbers, which belong to people who never wrote to the bot. */
export function withoutContactDetails(text: string): string {
    return text
        .replace(EMAIL, '[email address]')
        .replace(NUMBER_RUN, (run) => (run.replace(/\D/g, '').length >= 7 ? '[number]' : run));
}

/** What the chat's history keeps of an image's description: no contact details, and a short summary, never the whole of it. */
export function visionNoteOf(description: string): string {
    const plain = withoutContactDetails(description).replace(/\s+/gu, ' ').trim();
    if (plain.length <= VISION_NOTE_CHARS) return plain;
    const cut = plain.slice(0, VISION_NOTE_CHARS);
    // Back to the last whole word, so it never ends half of one (or half an emoji)
    const word = cut.replace(/\s+\S*$/u, '');
    return `${(word.length > VISION_NOTE_CHARS / 2 ? word : cut).replace(/[\uD800-\uDBFF]$/u, '')}…`;
}
