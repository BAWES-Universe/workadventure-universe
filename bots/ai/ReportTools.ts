/**
 * "Send to the Universe team" (mock "Brick reports inbox"): the one way a Brick tells the people who build Universe where it hit a wall.
 *
 * Every Brick has it, on by default, in every chat. It uses it when it can't do something, when a tool or App fails, when someone corrects
 * it or is unhappy, when it has a clear idea, and whenever someone asks it to report a problem or file an issue. It replaces the old habit
 * of writing a page "as a report", which only the owner could see. The note is in general words: the tool refuses one that repeats six
 * words in a row of what the person wrote in this chat, or their name, so the Brick rewrites it in the same reply (no extra AI call), and
 * Orbit takes out emails, phone numbers, links, @names and long numbers before keeping it. The person is counted by a one-way hash only.
 * In a direct message the game shows "Sent to the Universe team" under the answer, with what was sent and Take it back for 24 hours.
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

const wordsOf = (value: string): string[] =>
    value
        .toLowerCase()
        .normalize('NFKC')
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean);

/**
 * Whether the note repeats the person: six words in a row from anything they wrote in this chat, or their name as a word of its own.
 * Words are compared in lower case without punctuation, so a quote with other commas or capitals is still a quote.
 */
export function repeatsThePerson(note: string[], said: string[], name?: string): boolean {
    const runs = new Set<string>();
    for (const line of said) {
        const words = wordsOf(line);
        for (let i = 0; i + QUOTE_WORDS <= words.length; i++) runs.add(words.slice(i, i + QUOTE_WORDS).join(' '));
    }
    const nameWords = name ? wordsOf(name).filter((word) => word.length >= 3) : [];
    for (const field of note) {
        const words = wordsOf(field);
        if (nameWords.some((word) => words.includes(word))) return true;
        for (let i = 0; i + QUOTE_WORDS <= words.length; i++) if (runs.has(words.slice(i, i + QUOTE_WORDS).join(' '))) return true;
    }
    return false;
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
    /** Where this turn's cards for the game wait until the reply goes out; null where the chat shows none (on the map). */
    notes: BrickNote[] | null;
    /** What the bot server already knows, with no words in it. */
    context?: BrickReportSend['context'];
}

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
    // The notes this reply already sent, where the chat shows them (a direct message); on the map Orbit's daily count is the only bound
    const already = (context.notes ?? []).filter((note): note is ReportSentNote => note.kind === 'report');
    if (already.some((note) => note.title.toLowerCase() === title.toLowerCase())) return { sent: true, note: 'Already sent in this reply. Do not send it again.' };
    if (already.length >= NOTES_PER_REPLY) return { sent: false, note: 'Enough notes for one reply. Do not send more now and do not mention it.' };
    if (repeatsThePerson([title, tried, stopped, idea], context.said, context.name)) {
        return {
            sent: false,
            error: 'Not sent: the note repeats the person\'s own words or name. Write it again in general words about Universe, with no quotes and no names, and send it again.',
        };
    }
    let outcome: Awaited<ReturnType<AdminApiService['sendBrickReport']>>;
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
        return { sent: false, note: 'The note could not be sent right now. Do not say it was sent; carry on helping.' };
    }
    if (outcome.sent === false) {
        if (outcome.reason === 'limit') return { sent: false, note: 'You sent enough notes today. Do not say it was sent; carry on helping.' };
        return { sent: false, error: 'Not sent: nothing was left of the title once links, emails and numbers were taken out. Write it in general words and send it again.' };
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
