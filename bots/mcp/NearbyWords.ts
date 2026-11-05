/**
 * The words around an approval card in nearby chat and voice (game #1658, mock 4 approved 4 Nov 2026). Pure.
 *
 * Nearby chat is shared, so the card goes to the person who asked and nobody else. Everyone in the bubble, the asker
 * too, reads (and, from a voice bot, hears) one plain line at four moments instead: the bot needs an OK, it changed
 * what it asks and needs an OK again, it did it, it did not. The line is written from the tool's title and the
 * person's name only, so it cannot hold anything from the card: not a name, a subject or a word of the text.
 *
 *  1. Written by one short extra AI reply that is given only the title and the name (recommended in the mock).
 *  2. The title as it is, when that reply fails or comes back with something that does not fit.
 */

export type Moment = 'ask' | 'changed' | 'sent' | 'notDone';

/** The longest line the bot says to everyone: a short sentence, never a paragraph. */
const MAX_LINE = 140;
const MAX_NAME = 40;

/** The name a line starts with: one tidy line, or null when the person has none. */
export function nameForLine(name: string | null | undefined): string | null {
    const tidy = (name ?? '').replace(/\s+/g, ' ').replace(/[,:;"“”]/g, '').trim().slice(0, MAX_NAME).trim();
    return tidy || null;
}

const lead = (name: string | null) => (name ? `${name}, ` : '');
const capital = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/** The title as it is, for when the extra AI reply fails: always exact, if a little stiff. */
export function fallbackLine(moment: Moment, name: string | null, title: string): string {
    const tidy = title.replace(/\s+/g, ' ').trim();
    switch (moment) {
        case 'ask':
            return capital(`${lead(name)}I need your OK for ${tidy}.`);
        case 'changed':
            return capital(`${lead(name)}I changed ${tidy} and need your OK again.`);
        case 'sent':
            return capital(`${lead(name)}${tidy} is done.`);
        case 'notDone':
            return capital(`${lead(name)}${tidy} was not done.`);
    }
}

const WHAT: Record<Moment, string> = {
    ask: 'you need the OK of this person before you do it',
    changed: 'you changed what you were going to do and need their OK again',
    sent: 'you did it for them',
    notDone: 'you did not do it',
};

const EXAMPLES: Record<Moment, string> = {
    ask: 'Khalid, I need your OK to send an email for you.',
    changed: 'Khalid, I changed the email and need your OK again.',
    sent: 'Khalid, I sent the email for you.',
    notDone: "Khalid, I didn't send the email.",
};

export const WORDS_SYSTEM = [
    'You write the one short line a bot says to everyone nearby about something it was asked to do.',
    'You are given only the name of the tool and the name of the person. You do not know anything else about the task, so say nothing else about it.',
    'Rules: one sentence, in the first person, plain words, at most 14 words. Start with the person\'s name and a comma. Name the action in everyday words (for "Send email": "send an email"). Never name another person, a subject, an amount, a date or any detail. No quotes, no emoji, no markdown. Write the line and nothing else.',
].join('\n');

export function wordsPrompt(moment: Moment, name: string | null, title: string): string {
    const example = name ? EXAMPLES[moment].replace(/^Khalid/, name) : EXAMPLES[moment].replace(/^Khalid, /, '');
    return [
        `Tool: ${title.replace(/\s+/g, ' ').trim().slice(0, 120)}`,
        `Person: ${name ?? '(no name)'}`,
        `Say that ${WHAT[moment]}.`,
        `Example of the shape, for another tool: ${example}`,
    ].join('\n');
}

/**
 * The extra AI reply as one line to say, or null when it does not fit: empty, more than a line, a link, a long
 * paragraph, or a line that does not start with the person's name. Anything null falls back to the title as it is.
 */
export function acceptLine(text: string | null | undefined, name: string | null, avoid: readonly string[] = [], title = ''): string | null {
    if (!text) return null;
    const line = text.trim().replace(/^["“'`]+|["”'`]+$/g, '').trim();
    if (!line || line.length > MAX_LINE || /[\r\n]/.test(line) || /https?:\/\/|www\./i.test(line) || /[<>{}[\]]/.test(line)) return null;
    if (name && !line.toLowerCase().startsWith(`${name.toLowerCase()},`)) return null;
    // One sentence: a stop in the middle means more was said than a line
    if (/[.!?]\s+\S/.test(line)) return null;
    if (repeatsCard(line, avoid, title)) return null;
    return line;
}

/** Words a line may use whatever the card says: the shape of the lines themselves. */
const LINE_WORDS = new Set(['need', 'your', 'send', 'sent', 'email', 'again', 'changed', 'change', 'didn', 'this', 'that', 'with', 'have', 'will', 'been', 'done', 'made', 'does', 'what', 'okay', 'for', 'you', 'the']);

/**
 * A line that holds a word of the card (a name, a subject, a number) is not made from the title alone, whatever wrote it:
 * it is refused, and the title as it is takes its place.
 */
function repeatsCard(line: string, avoid: readonly string[], title: string): boolean {
    const own = new Set(title.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
    const said = new Set(line.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
    if (/@|\d/.test(line)) return true;
    for (const text of avoid) {
        for (const word of text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []) {
            if (!own.has(word) && !LINE_WORDS.has(word) && said.has(word)) return true;
        }
    }
    return false;
}

/* --------------------------- a yes or a no, said while a card waits --------------------------- */

/** What the person said while their card waits: a yes that never sends, or anything else. */
export const CONFIRM_SYSTEM = [
    'A bot asked a person to tap a button on a card to approve an action. Then the person wrote or said something.',
    'Answer CONFIRM if what they said only agrees, approves or tells the bot to go ahead, in any language ("yes", "ok", "send it", "go ahead", "do it", "sure").',
    'Answer OTHER for anything else: a change, a different request, a question, a refusal, or a message to someone else.',
    'Answer with one word only: CONFIRM or OTHER.',
].join('\n');

export function isConfirm(reply: string | null | undefined): boolean {
    return /^\s*confirm\b/i.test(reply ?? '');
}

/** The reply only the person who asked sees when they say yes: a yes never sends, only the tap does. */
export function tapInstead(label: string): string {
    return `Tap ${label} on the card to go ahead. A yes in chat or out loud never does it.`;
}
