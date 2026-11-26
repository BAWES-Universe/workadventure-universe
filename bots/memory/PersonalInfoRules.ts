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
// A period ends a sentence unless it ends a title or an initial: "I love Dr. Pepper", "I like J. K. Rowling" are one sentence each; "Plan B. I hate tea" is two
const SENTENCE_END = /(?<=[.!?\n])(?<!(?:^|[^\p{L}])(?:[mM][rR]|[mM][rR][sS]|[mM][sS]|[mM][xX]|[dD][rR]|[pP][rR][oO][fF]|[sS][tT]|[jJ][rR]|[sS][rR]|[vV][sS]|[eE][tT][cC]|[iI][nN][cC]|[lL][tT][dD]|[mM][tT]|[fF][tT]|[gG][eE][nN]|[cC][oO][lL]|[cC][aA][pP][tT]|[lL][tT]|[sS][gG][tT]|[rR][eE][vV]|[hH][oO][nN]|[sS][eE][nN]|[rR][eE][pP]|[gG][oO][vV]|[fF][rR])\.)(?!(?<=(?:^|[^\p{L}])\p{Lu}\.)\s+(?:\p{Lu}\.|\p{Lu}\p{Ll}))\s+|\n+/u;

/** A question that starts with one of these asks about the whole of it ("Do I like tea or coffee?"). */
const ASKS = /^(?:am i|are you|are we|is|are|was|were|do|does|did|can|could|would|will|shall|should|may|might|has|have|what|who|whom|whose|why|how|when|where|which)(?![\p{L}\p{N}])/iu;

/**
 * The lines of a message, each with whether it is a question. In "I'm Sara, can you help me?" only the part after the last
 * comma asks: what comes before it is something said.
 */
function sentencesOf(message: string): Array<{ text: string; question: boolean }> {
    const parts = message.split(SENTENCE_END).map((part) => part.trim()).filter(Boolean);
    return parts.flatMap((text) => {
        const question = /\?\s*$/u.test(text);
        if (!question || ASKS.test(text)) return [{ text, question }];
        const cut = Math.max(text.lastIndexOf(','), text.lastIndexOf(';'));
        if (cut <= 0) return [{ text, question }];
        const before = text.slice(0, cut).trim();
        const after = text.slice(cut + 1).trim();
        return [before ? { text: before, question: false } : null, after ? { text: after, question: true } : null].filter((part): part is { text: string; question: boolean } => part !== null);
    });
}

const CLAUSE_END = /\s*(?:[,;:]|\b(?:and|but|though|although|however|because|while|yet)\b)\s*/iu;

/**
 * The parts of a message that each say one thing ("I'm not hungry, I'm tired" is two), each with whether its sentence was a
 * question. A "not" is only looked for in the part that holds the thing, so "my name is Sara and I don't like tea" keeps the name.
 */
function clausesOf(message: string): Array<{ text: string; question: boolean; takenBack: boolean }> {
    const sentences = sentencesOf(message).map((sentence) => {
        const clauses = sentence.text
            .split(CLAUSE_END)
            .map((text) => text.trim())
            .filter(Boolean);
        // A question asks in its last clause, or in all of them when it starts by asking ("Am I tired and hungry?")
        const asksAll = sentence.question && ASKS.test(sentence.text);
        return clauses.map((text, index) => ({ text, question: sentence.question && (asksAll || index === clauses.length - 1), takenBack: false }));
    });
    // A "not" on its own at the very end takes back what was said just before it: "I'm tired not", "I'm tired, not really", "I'm tired. Not.", "my birthday is May 3 lol not"
    const result: Array<{ text: string; question: boolean; takenBack: boolean }> = [];
    for (const clauses of sentences) {
        for (const clause of clauses) {
            if (BARE_NOT.test(clause.text)) {
                const before = result[result.length - 1];
                if (before) before.takenBack = true;
            } else {
                clause.takenBack = NOT_AT_THE_END.test(clause.text);
                result.push(clause);
            }
        }
    }
    return result;
}

/** A clause that is only "not" or "not really", maybe after "lol" or "jk": it takes back the clause before it. */
const BARE_NOT = /^(?:(?:lol|lmao|haha|jk)[\s,.!]*)?not(?:\s+really)?[\s.!?]*$/iu;
/** A clause that ends in "not" or "lol not": it takes itself back. */
const NOT_AT_THE_END = /\s(?:(?:lol|lmao|haha|jk)[\s,.!]*)?not(?:\s+really)?[\s.!?]*$/iu;

/** Words said just before "like" / "feel" / "am" that turn it around, or put it in another's mouth. */
const NEGATED = new RegExp(`\\b(?:not|never|no longer|hardly|barely|rarely|dont|cannot|can${APOS}?t|won${APOS}?t|isn${APOS}?t|wasn${APOS}?t|don${APOS}?t|doesn${APOS}?t|didn${APOS}?t|n${APOS}t)\\b|n${APOS}t\\b`, 'iu');

/** A "not" only turns round what comes after it: "my name is Sara so don't call me Sarah" still gives Sara, "I'm not tired" does not give tired. */
function negatedBy(text: string, match: RegExpExecArray): boolean {
    return NEGATED.test(text.slice(0, match.index + match[0].length));
}

// ---- Name -------------------------------------------------------------------------------------------------------------

/** Capitalised words that follow "I'm" or "call me" without being a name, whichever way the person introduces themselves. */
const NOT_A_NAME = new Set([
    'mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'sir', 'madam', 'miss', 'called', 'named', 'sorry', 'not', 'just', 'back', 'here', 'there', 'going', 'trying', 'looking',
    'only', 'also', 'still', 'really', 'very', 'so', 'too', 'in',
    'on', 'at', 'from', 'with', 'a', 'an', 'the', 'your', 'my', 'now', 'today', 'tomorrow', 'later', 'again', 'maybe', 'please', 'thanks',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'out', 'off', 'about', 'wondering', 'thinking', 'having', 'doing', 'being', 'using',
    'google', 'gmail', 'github', 'slack', 'notion', 'calendar', 'email', 'universe', 'brick',
]);
/** Words for how someone is. After a bare "I'm" they are a feeling ("I'm Happy"); after "my name is" or "call me" they are a name ("my name is Joy"). */
const NOT_A_NAME_WHEN_BARE = new Set([
    'fine', 'good', 'great', 'okay', 'ok', 'glad', 'happy', 'sure', 'done', 'ready', 'afraid', 'curious', 'interested', 'new',
    'hungry', 'sad', 'tired', 'excited', 'angry', 'frustrated', 'worried', 'scared', 'nervous', 'thirsty', 'bored', 'lonely', 'confused', 'sick', 'ill',
    'busy', 'late', 'early', 'free', 'online', 'offline', 'stuck', 'lost', 'home',
    // Who they are and what they speak or believe, not what they are called ("I'm American", "I'm Christian and I like tea")
    'american', 'british', 'canadian', 'australian', 'mexican', 'brazilian', 'argentinian', 'colombian', 'chilean', 'peruvian', 'cuban',
    'german', 'french', 'spanish', 'italian', 'dutch', 'swedish', 'norwegian', 'danish', 'finnish', 'polish', 'russian', 'ukrainian', 'greek',
    'turkish', 'irish', 'scottish', 'welsh', 'english', 'portuguese', 'czech', 'hungarian', 'romanian', 'bulgarian', 'serbian', 'croatian',
    'egyptian', 'moroccan', 'tunisian', 'algerian', 'libyan', 'sudanese', 'kuwaiti', 'saudi', 'emirati', 'qatari', 'bahraini', 'omani', 'yemeni',
    'iraqi', 'syrian', 'lebanese', 'jordanian', 'palestinian', 'israeli', 'iranian', 'persian', 'afghan', 'pakistani', 'indian', 'bangladeshi',
    'nepali', 'chinese', 'japanese', 'korean', 'vietnamese', 'thai', 'filipino', 'indonesian', 'malaysian', 'singaporean', 'african', 'nigerian',
    'kenyan', 'ethiopian', 'ghanaian', 'european', 'asian', 'arab', 'arabic', 'hebrew', 'latin', 'swiss', 'belgian', 'austrian', 'icelandic',
    'muslim', 'christian', 'jewish', 'hindu', 'buddhist', 'sikh', 'catholic', 'orthodox', 'atheist', 'agnostic', 'vegan', 'vegetarian',
    'single', 'married', 'divorced', 'engaged', 'retired', 'unemployed', 'bilingual',
    // Beliefs, origins, politics and health: said about themselves, never a name (a name in this place is said after a greeting anyway)
    'shia', 'sunni', 'ismaili', 'druze', 'coptic', 'maronite', 'mormon', 'protestant', 'baptist', 'methodist', 'lutheran', 'anglican',
    'evangelical', 'pentecostal', 'quaker', 'jain', 'bahai', 'zoroastrian', 'pagan', 'wiccan', 'kurdish', 'somali', 'armenian', 'eritrean',
    'tamil', 'punjabi', 'bengali', 'urdu', 'hindi', 'farsi', 'pashto', 'swahili', 'berber', 'amazigh', 'hispanic', 'latino', 'latina', 'black',
    'white', 'venezuelan', 'jamaican', 'haitian', 'albanian', 'bosnian', 'taiwanese', 'burmese', 'kazakh', 'uzbek', 'mongolian', 'tibetan',
    'senegalese', 'congolese', 'ugandan', 'slovak', 'lithuanian', 'maltese', 'cypriot', 'republican', 'democrat', 'conservative', 'liberal',
    'socialist', 'communist', 'gay', 'lesbian', 'bisexual', 'trans', 'transgender', 'queer', 'deaf', 'blind', 'autistic', 'diabetic', 'pregnant',
    'disabled', 'straight', 'asexual', 'nonbinary',
    'bidoon', 'bedoon', 'shiite', 'alawite', 'alawi', 'salafi', 'sufi', 'ibadi', 'yazidi', 'assyrian', 'chaldean', 'bedouin', 'ajam', 'hadhar',
    'mizrahi', 'sephardic', 'ashkenazi', 'rohingya', 'uyghur', 'muslima', 'pansexual', 'bi', 'intersex', 'biracial', 'mixed',
]);
/** Words that end like a belief, a nationality or a language: not a name after a bare "I'm", whatever the word. */
const LOOKS_LIKE_WHO_THEY_ARE = /(?:ish|ese|ist)$/iu;
/** First names that end like one ("Trish", "Reese"): they are names after a greeting. The lists above are checked first, so "Danish" is still not one. */
const NAMES_THAT_END_LIKE_IT = new Set(['trish', 'anish', 'manish', 'harish', 'hamish', 'satish', 'girish', 'tanish', 'reese', 'therese']);
/** A greeting, alone or with one word after it ("Hello", "Hi there", "Hello Brick"): what comes right after it is an introduction. */
const GREETING = /^\s*(?:hi|hello|hey|hiya|howdy|greetings)(?:\s+\p{L}+)?\W*$/iu;
/** Months are names too ("April", "May"), unless a day follows ("call me May 3rd", "I'm April 5"). */
const MONTH_NAMES = new Set(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);

// What may follow a bare "I'm Sara" for it to be a name and not the start of a longer phrase ("I'm Google mail" is not a name):
// the end, a mark, a surname, an emoji, or a plain word of chat. After "my name is" or "call me" anything may follow.
const AFTER_NAME = new RegExp(`^(?:$|\\s*[.,!?;:)]|\\s+\\p{Lu}\\p{Ll}|\\s*\\p{Extended_Pictographic}|\\s+(?:so|from|here|btw|by the way|nice|hi|hello|lol|haha|please|pls|thanks|too|again|now|today)\\b|\\s*[-–—]\\s)`, 'u');

// One capital then lowercase, and again for "McDonald", "DeShawn", "JoAnn"
const NAME_WORD = '\\p{Lu}\\p{Ll}{1,19}(?:\\p{Lu}\\p{Ll}{1,10})*';

const NAME_FORMS: Array<{ form: RegExp; bare: boolean }> = [
    { form: new RegExp(`\\b[Mm]y name(?:${APOS}s| is)\\s+(${NAME_WORD})`, 'u'), bare: false },
    { form: new RegExp(`\\b[Cc]all me\\s+(${NAME_WORD})`, 'u'), bare: false },
    { form: new RegExp(`\\b[Ii](?:${APOS}m| am)\\s+(?:[Cc]alled|[Nn]amed)\\s+(${NAME_WORD})`, 'u'), bare: false },
    { form: new RegExp(`(?:^|\\b(?:[Hh]i|[Hh]ello|[Hh]ey)\\W+)[Ii](?:${APOS}m| am)\\s+(${NAME_WORD})`, 'u'), bare: true },
];

// Text a person quotes is not theirs: "translate "my name is Sara" into French". Neither is what they ask to have written.
const QUOTED = /"[^"\n]*"|“[^”\n]*”|«[^»\n]*»|`[^`\n]*`/gu;
const TASK_WORD = /(?<![\p{L}\p{N}])(?:translate|translation|write|rewrite|say|type|repeat|spell|pronounce|correct|fix|quote|echo|caption|label|sentence|phrase|text|example|reads?|says?|tell (?:me|him|her|them))(?![\p{L}\p{N}])/iu;

/** The person's own name, only when they say it is: "my name is Sara", "call me Sara", "I'm Sara". */
export function nameIn(message: string): string | null {
    let greetedBefore = false;
    for (const sentence of sentencesOf(message.replace(QUOTED, ' '))) {
        // "Hello! I'm Sara": the sentence before was only a greeting
        const greetedByLine = greetedBefore;
        greetedBefore = GREETING.test(sentence.text);
        let cursor = 0;
        for (const clause of clausesOf(sentence.text + (sentence.question ? '?' : ''))) {
            // What came before this part in its sentence: "Repeat after me: I am Sara" asks for words, it does not give a name
            const at = sentence.text.indexOf(clause.text, cursor);
            const before = at === -1 ? '' : sentence.text.slice(0, at);
            if (at !== -1) cursor = at + clause.text.length;
            if (clause.question || clause.takenBack) continue;
            for (const { form, bare } of NAME_FORMS) {
                const match = form.exec(clause.text);
                if (!match?.[1] || negatedBy(clause.text, match)) continue;
                if (TASK_WORD.test(before + clause.text.slice(0, match.index))) continue;
                const name = match[1];
                const lower = name.toLowerCase();
                const rest = clause.text.slice((match.index ?? 0) + match[0].length);
                if (NOT_A_NAME.has(lower) || (bare && (NOT_A_NAME_WHEN_BARE.has(lower) || (LOOKS_LIKE_WHO_THEY_ARE.test(lower) && !NAMES_THAT_END_LIKE_IT.has(lower))))) continue;
                if (MONTH_NAMES.has(lower) && /^\s*(?:the\s+)?\d/i.test(rest)) continue;
                if (bare) {
                    // A plain "I'm Shia" says who they are. It is a name only in an introduction: right after a greeting
                    const greeted = /^(?:hi|hello|hey)/i.test(match[0]) || GREETING.test(before) || (at === 0 && greetedByLine);
                    if (!greeted || !AFTER_NAME.test(rest)) continue;
                }
                return name;
            }
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
const NOT_A_THING = /^(?:how|that|when|the way|it when|it that|if|whether|what(?:ever)?|who|why|being|you|your|my|our|his|her|their|him|them|me|myself|us|this|these|those|not|never|no|it|its|there|something|anything|everything|nothing|one|so|too)(?![\p{L}\p{N}])/iu;
/** A phrase that speaks to the bot ("to bother you") is a remark, not a taste. */
const ABOUT_THE_BOT = /(?<![\p{L}\p{N}])(?:you|your|yours|you['’]re|you['’]ve|you['’]ll|yourself)(?![\p{L}\p{N}])/iu;
const CONTACT = /@|https?:\/\/|www\.|\d{5,}/u;

/** The thing itself out of what follows "like": cut where another clause starts, and without the words that only add to it. */
/**
 * Two words or more, each with a capital ("No Doubt", "One Piece", "It Follows", "This Is Us"): a name of something, even when it
 * starts with a word that alone is no thing. Only for the small words that cannot be about a person or a feeling (never "My Husband John", "Her Sister Mona", "Being Alone"),
 * and never when a later word is about a person or a feeling ("This Guy Ahmed", "One Of My Friends", "This Feeling").
 */
const TITLE_STARTERS = '(?:No|One|It|This|Nothing|Something)(?![\\p{L}\\p{N}])';
const ATITLE = new RegExp(`^(?=${TITLE_STARTERS})\\p{Lu}[\\p{L}\\p{N}'’-]*(?:\\s+\\p{Lu}[\\p{L}\\p{N}'’-]*)+$`, 'u');
const ABOUT_SOMEONE = new Set([
    'one', 'my', 'your', 'our', 'his', 'her', 'their', 'him', 'them', 'myself', 'yourself', 'himself', 'herself', 'themselves', 'someone', 'anyone', 'everyone', 'everybody', 'nobody',
    'guy', 'guys', 'girl', 'girls', 'man', 'men', 'woman', 'women', 'boy', 'boys', 'person', 'people', 'lady', 'dude', 'bro', 'mate', 'kid', 'kids', 'child', 'children',
    'friend', 'friends', 'family', 'wife', 'husband', 'partner', 'boyfriend', 'girlfriend', 'mom', 'mum', 'mother', 'dad', 'father', 'brother', 'sister', 'son', 'daughter',
    'boss', 'teacher', 'colleague', 'neighbour', 'neighbor', 'roommate', 'ex', 'me',
    'feeling', 'feelings', 'alone', 'lonely', 'sad', 'tired', 'sick', 'ill', 'angry', 'anxious', 'depressed', 'scared', 'afraid', 'stressed', 'worried', 'hungry',
    'cancer', 'illness', 'disease', 'depression', 'anxiety', 'diabetes', 'pregnancy',
]);
// "Us" ends real titles ("It Ends With Us"), so it only counts before the last word
const ABOUT_SOMEONE_UNLESS_LAST = new Set(['us']);

function isATitle(phrase: string): boolean {
    if (!ATITLE.test(phrase)) return false;
    const words = phrase.split(/\s+/u).map((word) => word.toLowerCase().replace(/['’-].*$/u, ''));
    return !words.slice(1).some((word, at, rest) => ABOUT_SOMEONE.has(word) || (ABOUT_SOMEONE_UNLESS_LAST.has(word) && at < rest.length - 1));
}

function thingOf(rest: string): string | null {
    let phrase = rest
        .split(/\s*(?:[;:()]|,\s*(?:not|thanks|thank you|thx|please|pls|lol|haha|honestly|though|ok|okay|really|btw)\b|\s[-–—]\s|\b(?:but|because|since|so|though|although|except|unless|when|whenever|if|which|that|and then)\b)/iu)[0]
        .replace(/\s+(?:too|a lot|a bit|very much|so much|as well|also|though|however|anymore|now|again|right now|lol|lmao|haha|btw|please|pls|thanks|thank you|honestly|tbh)$/iu, '')
        .trim()
        .replace(/[\s,.!?…"'`“”]+$/u, '');
    if (!phrase || phrase.length > MAX_PHRASE_CHARS || phrase.split(/\s+/u).length > MAX_PHRASE_WORDS) return null;
    if ((NOT_A_THING.test(phrase) && !isATitle(phrase)) || ABOUT_THE_BOT.test(phrase) || CONTACT.test(phrase)) return null;
    // A word or two with a letter in it
    if (!/\p{L}/u.test(phrase)) return null;
    return phrase;
}

/** Words that may stand between "I" and what they say they do ("I really don't like", "I honestly can't stand"). Never a word that turns it round. */
const ADVERBS = '(?:really|absolutely|totally|just|also|still|actually|truly|definitely|always|honestly|personally|seriously|genuinely|simply|completely|literally|generally|usually|mostly|probably|quite|kind of|sort of|do)';
const LIKE = new RegExp(`(?:^|[\\s,;:(])[Ii]\\s+((?:${ADVERBS}\\s+)*)(${LIKE_VERBS}|${DISLIKE_VERBS})\\s+(.+)$`, 'iu');
const NEG_LIKE = new RegExp(`(?:^|[\\s,;:(])[Ii]\\s+(?:${ADVERBS}\\s+)*(?:don${APOS}?t|do not|never|no longer|can${APOS}?t stand|cannot stand|can${APOS}?t bear|hardly|barely|dont)\\s+(?:(?:really|actually|truly|much|particularly|even|ever|quite)\\s+)*(${LIKE_VERBS}|care for|enjoy)\\s+(.+)$`, 'iu');
const CANT_STAND = new RegExp(`(?:^|[\\s,;:(])[Ii]\\s+(?:${ADVERBS}\\s+)*(?:can${APOS}?t|cannot)\\s+(?:really\\s+)?(?:stand|bear|stomach)\\s+(.+)$`, 'iu');
const FAVORITE = new RegExp(`\\bmy\\s+(?:all[- ]time\\s+)?favou?rite\\s+((?:\\p{L}+\\s+){0,2}?)(?:is|are)\\s+(.+)$`, 'iu');

/** A sentence with two things said by the person ("I like tea and I hate coffee") as one line for each; "and my sister hates it" is cut off, as it is not theirs. */
const SAYING_STARTS = `(?=(?:[Ii]|[Mm]y)(?![\\p{L}\\p{N}]|['’]s))`;
const NEXT_SAYING = new RegExp(`\\s*(?:,\\s*)?\\b(?:and|but|while|though|although|then|yet)\\s+${SAYING_STARTS}|\\s*[,;]\\s*${SAYING_STARTS}`, 'u');
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
    const normal = thing.trim().toLowerCase();
    const slug = normal.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 30);
    // "C++" and "C#" are both "c" in words: the whole value, hashed, keeps them apart. Same value in other capitals is the same dislike.
    let hash = 0x811c9dc5;
    for (const unit of normal) for (let index = 0; index < unit.length; index++) hash = Math.imul(hash ^ unit.charCodeAt(index), 0x01000193) >>> 0;
    return `${DISLIKE_LABEL}${slug || 'thing'}_${hash.toString(36)}`;
}

/** A like kept as "pizza (favorite food)" is "pizza" when it is set against what they do not like. */
export function plainThing(value: string): string {
    return value.replace(/\s*\((?:favou?rite)[^)]*\)\s*$/iu, '').trim();
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
    // The last thing said about something stands: "I hate coffee. Actually I love coffee." is a like
    const push = (list: string[], other: string[], value: string | null) => {
        if (!value) return;
        for (let index = other.length - 1; index >= 0; index--) {
            if (plainThing(other[index]).toLowerCase() === plainThing(value).toLowerCase()) other.splice(index, 1);
        }
        if (!list.some((kept) => kept.toLowerCase() === value.toLowerCase())) list.push(value);
    };
    const sayings = sentencesOf(message).flatMap(sayingsOf);
    for (const [at, sentence] of sayings.entries()) {
        if (sentence.question) continue;
        const text = sentence.text;
        // A "not" at the very end takes it back ("I like tea, not really", "I hate tea. Not.")
        if (NOT_AT_THE_END.test(text) || (at + 1 < sayings.length && BARE_NOT.test(sayings[at + 1].text))) continue;
        const negative = NEG_LIKE.exec(text) ?? CANT_STAND.exec(text);
        if (negative) {
            if (!HEDGE.test(text.slice(0, negative.index))) push(dislikes, likes, thingOf(negative[negative.length - 1]));
            continue;
        }
        const favourite = FAVORITE.exec(text);
        if (favourite) {
            // "isn't" never reaches here: the form is "is" or "are" right after the kind of thing
            const thing = HEDGE.test(text.slice(0, favourite.index)) ? null : thingOf(favourite[2]);
            const kind = favourite[1].trim();
            push(likes, dislikes, thing && !NEGATED.test(favourite[1]) ? (kind ? `${thing} (favorite ${kind})` : `${thing} (favorite)`) : null);
            continue;
        }
        const positive = LIKE.exec(text);
        if (positive) {
            // "I don't think I like jazz", "not sure I like it": a doubt, not a taste
            if (HEDGE.test(text.slice(0, positive.index))) continue;
            const verb = positive[2].toLowerCase();
            // "I never really like" etc. were taken above; a leftover "not" before the verb is not a like
            if (NEGATED.test(positive[1] ?? '')) continue;
            (DISLIKE_VERBS.split('|').includes(verb) ? push(dislikes, likes, thingOf(positive[3])) : push(likes, dislikes, thingOf(positive[3])));
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
        if (sentence.question || sentence.takenBack) continue;
        const match = STATE.exec(sentence.text);
        if (match?.[1] && !negatedBy(sentence.text, match)) return match[1].toLowerCase();
    }
    return null;
}

// ---- Birthday ---------------------------------------------------------------------------------------------------------

// Full names and the short forms people type ("Dec 5", "Sept 3"); the date check downstream reads a short form by its first letters
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec';
const BIRTHDAY_TODAY = new RegExp(`\\b(?:it${APOS}?s|today(?: is)?|today${APOS}s)\\s+my\\s+(?:birthday|bday)\\b|\\bmy\\s+(?:birthday|bday)\\s+(?:is\\s+)?today\\b`, 'iu');
const BIRTHDAY_ON = [
    new RegExp(`\\bmy\\s+(?:birthday|bday)(?:${APOS}s)?\\s+(?:(?:is|was)\\s+)?(?:on\\s+)?((?:${MONTHS})\\s+\\d{1,2})(?:st|nd|rd|th)?\\b`, 'iu'),
    /\bmy\s+(?:birthday|bday)(?:['’]s)?\s+(?:(?:is|was)\s+)?(?:on\s+)?(\d{1,2}[/-]\d{1,2})\b/iu,
];

/** True when the person says it is their own birthday today (not a friend's, and not "it's not my birthday"). */
export function birthdayIsToday(message: string): boolean {
    return clausesOf(message).some((sentence) => {
        const match = sentence.question || sentence.takenBack ? null : BIRTHDAY_TODAY.exec(sentence.text);
        return match !== null && !negatedBy(sentence.text, match);
    });
}

/** The day the person says their own birthday is, as they wrote it ("March 3", "3/3"). */
export function birthdayDateIn(message: string): string | null {
    for (const sentence of clausesOf(message)) {
        if (sentence.question || sentence.takenBack) continue;
        for (const form of BIRTHDAY_ON) {
            const match = form.exec(sentence.text);
            if (match?.[1] && !negatedBy(sentence.text, match)) return match[1];
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
