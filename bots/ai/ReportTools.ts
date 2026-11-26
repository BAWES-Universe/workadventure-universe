/**
 * "Send to the Universe team" (mock "Brick reports inbox"): the one way a Brick tells the people who build Universe where it hit a wall.
 *
 * Every Brick has it, on by default, in its direct messages (the map comes back once its bubble can carry the line and Take it back). It uses it when it can't do something, when a tool or App fails, when someone corrects
 * it or is unhappy, when it has a clear idea, and whenever someone asks it to report a problem or file an issue. It replaces the old habit
 * of writing a page "as a report", which only the owner could see. The note is in general words: the tool refuses one that repeats six
 * words in a row (ten characters in languages written without spaces) of what the person wrote in this chat or what Apps and files gave
 * back in this reply, or their name, so the Brick rewrites it once in the same reply (no extra AI call), and
 * Orbit takes out emails, phone numbers, links, @names and long numbers before keeping it. The person is counted by a one-way hash only.
 * In a direct message the game shows "Sent to the Universe team" under the answer, with what was sent and Take it back for 24 hours.
 *
 * What a note says is untrusted (anyone can get a Brick to write anything): whatever reads notes later treats them as data, never as
 * instructions.
 */
import type { AdminApiService, BrickReportSend } from '../server/AdminApiService';
import type { BrickNote, ReportSentNote } from './BrickTools';

export const REPORT_TOOL = 'send_to_universe_team';

export function isReportTool(name: string): boolean {
    return name === REPORT_TOOL;
}

const KINDS = ['problem', 'cant_do', 'friction', 'idea'] as const;
const AREAS = ['apps', 'computer', 'pages', 'chat', 'voice', 'map', 'memory', 'files', 'credit', 'other'] as const;
const EFFECTS = ['stopped', 'slowed', 'idea'] as const;
const TITLE_MAX = 80;
const TEXT_MAX = 280;
/** Six words in a row of the person's own is a quote. */
const QUOTE_WORDS = 6;
/** In a language written without spaces, ten characters in a row is. */
const QUOTE_CHARS = 10;
/** What Apps and files gave back in this reply, the last part of it, for the quote check. */
const READ_MAX = 20_000;
/** Notes one reply sends: one per problem, and a reply is about one or two. */
const NOTES_PER_REPLY = 2;

type ToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: object } };

export function reportToolDefinition(): ToolDefinition {
    return {
        type: 'function',
        function: {
            name: REPORT_TOOL,
            description:
                'Send a short note to the Universe team, the people who build Universe and you, so they can fix it for every Brick. Use it on your own, without asking, when: ' +
                '(1) you cannot do something someone asked because you lack the ability; (2) a tool or App failed, signed out or gave nothing back; ' +
                '(3) someone corrected you or was unhappy with your answer; (4) you have a clear idea that would make you more useful. ' +
                'Always use it when someone asks you to report a problem, file or draft an issue, or tell the team: this is the only way a report reaches the team. ' +
                'Never make a page, document or file as a report instead. ' +
                'Write in general words about Universe and what you tried, never about the person: no names, no quotes of what anyone wrote, no links, emails, phone numbers or other numbers, nothing private. ' +
                'Once it is sent, say so in one short sentence in their language, like "Sent to the Universe team: links inside pages don\'t open." and carry on helping. Send one note per problem.',
            parameters: {
                type: 'object',
                properties: {
                    kind: {
                        type: 'string',
                        enum: [...KINDS],
                        description: 'problem: something went wrong. cant_do: an ability you do not have. friction: the person was unhappy or corrected you. idea: a clear idea.',
                    },
                    area: { type: 'string', enum: [...AREAS], description: 'Where it happened.' },
                    title: { type: 'string', description: `The problem in general words, in English, at most ${TITLE_MAX} characters: "Links inside pages don't open".` },
                    tried: { type: 'string', description: `What you tried, in general words, in English, at most ${TEXT_MAX} characters. No quotes.` },
                    stopped: { type: 'string', description: `What stopped you, in general words, in English, at most ${TEXT_MAX} characters. No quotes.` },
                    idea: { type: 'string', description: `Optional: what would fix it, in English, at most ${TEXT_MAX} characters.` },
                    effect: { type: 'string', enum: [...EFFECTS], description: 'stopped: it stopped the work. slowed: it slowed it. idea: just an idea.' },
                },
                required: ['kind', 'area', 'title', 'effect'],
            },
        },
    };
}

const text = (value: unknown, max: number): string =>
    typeof value === 'string' ? Array.from(value.replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim() : '';

const oneOf = <T extends string>(value: unknown, list: readonly T[]): T | undefined => (list as readonly string[]).includes(value as string) ? (value as T) : undefined;

/** Scripts written without spaces between words: a quote in them is found by characters, and a name of two characters is a name. */
const NOSPACE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

type WordSegmenter = { segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }> };
const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: 'word' }) => WordSegmenter }).Segmenter;
const segmenter = Segmenter ? new Segmenter('und', { granularity: 'word' }) : undefined;

/** Lower case, the same forms of each character, and no invisible characters (a zero-width space never splits a word). */
const plain = (value: string): string => value.normalize('NFKC').replace(/\p{Cf}+/gu, '').toLowerCase();

/** The words of a text as written (capitals kept), in any language: Thai, Chinese and Japanese are split into words too. */
const writtenWordsOf = (value: string): string[] => {
    const clean = value.normalize('NFKC').replace(/\p{Cf}+/gu, '');
    return segmenter
        ? Array.from(segmenter.segment(clean))
              .filter((part) => part.isWordLike)
              .map((part) => part.segment)
        : clean.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
};

/** The words of a text in lower case. */
const wordsOf = (value: string): string[] => writtenWordsOf(value).map((word) => word.toLowerCase());

/** A word written as a name is: with a capital first, or in a script without capitals. */
const writtenAsName = (word: string): boolean => {
    const first = Array.from(word)[0] ?? '';
    return first !== first.toLowerCase() || first.toLowerCase() === first.toUpperCase();
};

/** Only the letters and digits of a text, for the character check. */
const charsOf = (value: string): string[] => Array.from(plain(value).replace(/[^\p{L}\p{N}]+/gu, ''));

/**
 * Whether the note repeats the person: six words in a row from anything they wrote in this chat, ten characters in a row from a line in a
 * language written without spaces, or their name as a word of its own (two characters is enough in those languages). `read` (what Apps and
 * files gave back) is checked the same way, but for quotes only. Quotes are compared in lower case without punctuation or invisible
 * characters, so a quote with other commas or capitals is still a quote; a name counts only where it is written with a capital.
 */
export function repeatsThePerson(note: string[], said: string[], name?: string, read: string[] = []): boolean {
    const runs = new Set<string>();
    const charRuns = new Set<string>();
    for (const line of [...said, ...read]) {
        const words = wordsOf(line);
        for (let i = 0; i + QUOTE_WORDS <= words.length; i++) runs.add(words.slice(i, i + QUOTE_WORDS).join(' '));
        if (NOSPACE.test(line)) {
            const chars = charsOf(line);
            for (let i = 0; i + QUOTE_CHARS <= chars.length; i++) charRuns.add(chars.slice(i, i + QUOTE_CHARS).join(''));
        }
    }
    const nameWords = name ? wordsOf(name).filter((word) => word.length >= (NOSPACE.test(word) ? 2 : 3)) : [];
    // A name written without spaces (王伟) may be split into single characters: it is looked for whole, as it is written
    const nameRuns = name ? plain(name).split(/[^\p{L}\p{N}]+/u).filter((part) => NOSPACE.test(part) && Array.from(part).length >= 2) : [];
    for (const field of note) {
        const written = writtenWordsOf(field);
        const words = written.map((word) => word.toLowerCase());
        const flat = plain(field);
        // A name that is also a common word (Will, Mark, Grace) counts only where it is written as a name, with a capital
        const named = written.filter(writtenAsName).map((word) => word.toLowerCase());
        if (nameWords.some((word) => named.includes(word)) || nameRuns.some((run) => flat.includes(run))) return true;
        for (let i = 0; i + QUOTE_WORDS <= words.length; i++) if (runs.has(words.slice(i, i + QUOTE_WORDS).join(' '))) return true;
        if (charRuns.size > 0) {
            const chars = charsOf(field);
            for (let i = 0; i + QUOTE_CHARS <= chars.length; i++) if (charRuns.has(chars.slice(i, i + QUOTE_CHARS).join(''))) return true;
        }
    }
    return false;
}

/** This reply's own count, shared by its rounds: a note refused once may be written again once, and no more. */
export interface ReportTurn {
    refusals: number;
    /** What Apps and files gave back in this reply's earlier rounds. */
    read: string[];
}

/** Keeps what one round's tools gave back (but this tool's own answers) for the quote check, the last READ_MAX characters of the reply. */
export function noteWhatWasRead(turn: ReportTurn, results: Array<{ name: string; result: unknown }>): void {
    for (const { name, result } of results) {
        if (isReportTool(name) || result === undefined || result === null) continue;
        let text: string;
        try {
            text = typeof result === 'string' ? result : JSON.stringify(result);
        } catch {
            continue;
        }
        if (text) turn.read.push(text.length > READ_MAX ? text.slice(-READ_MAX) : text);
    }
    let total = turn.read.reduce((sum, text) => sum + text.length, 0);
    while (total > READ_MAX && turn.read.length > 1) total -= turn.read.shift()!.length;
}

export interface ReportToolContext {
    admin: Pick<AdminApiService, 'sendBrickReport'>;
    botId: string;
    /** Who was in the chat (person:<id>, guest:<id>), counted by Orbit as a one-way hash only. */
    personKey?: string;
    /** What the person wrote in this chat, newest included, for the quote check. Never sent anywhere. */
    said: string[];
    /** The person's name as the chat knows it: a note never carries it. */
    name?: string;
    /** This reply's count of refused notes and what its Apps and files gave back. */
    turn?: ReportTurn;
    /** Where this turn's cards for the game wait until the reply goes out; null where the chat shows none (on the map). */
    notes: BrickNote[] | null;
    /** What the bot server already knows, with no words in it. */
    context?: BrickReportSend['context'];
}

/** Per reply (its list of notes), the notes being sent this moment, by title, each with whether it went once Orbit answers. */
const sending = new WeakMap<BrickNote[], Map<string, Promise<boolean>>>();

/** Runs send_to_universe_team. Never throws: the Brick is told in plain words what happened. */
export async function runReportTool(args: Record<string, unknown>, context: ReportToolContext): Promise<Record<string, unknown>> {
    const kind = oneOf(args.kind, KINDS);
    const area = oneOf(args.area, AREAS) ?? 'other';
    const effect = oneOf(args.effect, EFFECTS) ?? (kind === 'idea' ? 'idea' : 'slowed');
    const title = text(args.title, TITLE_MAX);
    const tried = text(args.tried, TEXT_MAX);
    const stopped = text(args.stopped, TEXT_MAX);
    const idea = text(args.idea, TEXT_MAX);
    if (!kind || !title) return { sent: false, error: 'Say what kind of note it is and give it a short title in general words.' };
    // The notes this reply already sent, and the ones being sent right now (tool calls of one round run side by side)
    const already = (context.notes ?? []).filter((note): note is ReportSentNote => note.kind === 'report');
    const flying = context.notes ? (sending.get(context.notes) ?? new Map<string, Promise<boolean>>()) : new Map<string, Promise<boolean>>();
    const same = title.toLowerCase();
    if (already.some((note) => note.title.toLowerCase() === same)) return { sent: true, note: 'Already sent in this reply. Do not send it again.' };
    // The same note is being sent beside this call: say what that one says, never "sent" before it is
    const twin = flying.get(same);
    if (twin) {
        return (await twin)
            ? { sent: true, note: 'Already sent in this reply. Do not send it again.' }
            : { sent: false, note: 'The same note did not go just now. Do not send it again in this reply and do not say it was sent.' };
    }
    if (already.length + flying.size >= NOTES_PER_REPLY) return { sent: false, note: 'Enough notes for one reply. Do not send more now and do not mention it.' };
    // One rewrite after a refusal, then no more in this reply: each try costs a round
    const refused = (error: string): Record<string, unknown> => {
        const turn = context.turn;
        if (turn && turn.refusals++ >= 1) return { sent: false, note: 'Not sent. Do not try again in this reply. Never say it was sent; if the person asked you to report it, say in one short sentence that it could not be sent this time.' };
        return { sent: false, error };
    };
    if (repeatsThePerson([title, tried, stopped, idea], context.said, context.name, context.turn?.read)) {
        return refused('Not sent: the note repeats the person\'s own words or name, or words from what Apps or files gave back. Write it again in general words about Universe, with no quotes and no names, and send it again.');
    }
    let outcome: Awaited<ReturnType<AdminApiService['sendBrickReport']>> | undefined;
    // Held before Orbit is asked, so a call beside this one sees it (and waits for whether it went); let go once the answer is in
    let went: (sent: boolean) => void = () => undefined;
    flying.set(same, new Promise<boolean>((resolve) => (went = resolve)));
    if (context.notes) sending.set(context.notes, flying);
    try {
        outcome = await context.admin.sendBrickReport({
            botId: context.botId,
            ...(context.personKey ? { personKey: context.personKey } : {}),
            kind,
            area,
            title,
            tried,
            stopped,
            idea,
            effect,
            ...(context.context ? { context: context.context } : {}),
        });
    } catch (error) {
        console.warn('[ReportTools] Could not send a note to the Universe team:', error instanceof Error ? error.message : error);
        // Orbit may have kept it (an answer lost on the way): never sent again in this reply
        return { sent: false, note: 'The note could not be sent right now. Do not send it again in this reply. Do not say it was sent; carry on helping.' };
    } finally {
        flying.delete(same);
        went(outcome?.sent === true);
    }
    if (outcome.sent === false) {
        if (outcome.reason === 'limit') return { sent: false, note: 'You sent enough notes today. Do not say it was sent; carry on helping.' };
        if (outcome.reason === 'empty') return refused('Not sent: nothing was left of the title once links, emails and numbers were taken out. Write it in general words and send it again.');
        return { sent: false, note: 'This chat cannot send notes to the Universe team. Do not say it was sent; carry on helping.' };
    }
    const kept: ReportSentNote = {
        kind: 'report',
        id: outcome.id,
        key: outcome.takeBackKey,
        noteKind: outcome.note.kind,
        area: outcome.note.area,
        title: outcome.note.title,
        tried: outcome.note.tried,
        stopped: outcome.note.stopped,
        idea: outcome.note.idea,
        sentAt: Date.now(),
    };
    context.notes?.push(kept);
    return {
        sent: true,
        title: kept.title,
        note: 'Sent. Say in one short sentence, in their language, that you sent it to the Universe team and what it was about, then carry on helping. Do not promise when it will be fixed.',
    };
}

/** The fixed line a reply with no words of its own says for the notes it sent. */
export function reportSentText(notes: ReportSentNote[]): string {
    return notes.length === 1 ? `Sent to the Universe team: ${notes[0].title}.` : `Sent to the Universe team: ${notes.map((note) => note.title).join('; ')}.`;
}
