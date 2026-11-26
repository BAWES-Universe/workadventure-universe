/**
 * "Send to the Universe team" (mock "Brick reports inbox"): the one way a Brick tells the people who build Universe where it hit a wall.
 *
 * Every Brick has it, on by default, in its direct messages (the map comes back once its bubble can carry the line and Take it back). It uses
 * it when it can't do something, when a tool or App fails, when someone corrects it or is unhappy, when it has a clear idea, and whenever
 * someone asks it to report a problem or file an issue. It replaces the old habit of writing a page "as a report", which only the owner
 * could see.
 *
 * A note it sends on its own is product-only: the model picks only the kind, the area, how much it mattered and which step of this reply it
 * is about; what ran (one of the Brick's own tools by name, an App only as "an App" with the connection it ran on so Orbit can name a catalog
 * App, or nothing), how it failed and whether it was tried again are filled here from what this reply actually ran. No words from the chat,
 * from the model or from what Apps gave back go with it, so nothing private can. A person's own words go only when they asked to tell the
 * team something: the Brick drafts them, Orbit answers the exact cleaned words, and the chat shows them with a Send button; nothing of them
 * is kept until the person presses it.
 *
 * Each note has a reference made from the chat's message and what the note is about: sent again (a lost answer, a retried reply), Orbit
 * answers the same receipt and keeps nothing new. When Orbit cannot be reached it is asked once more with the same reference; if it still
 * does not answer, the Brick says only that it could not confirm the note went, never that it was sent.
 *
 * The receipt (id, take-back key) is the bot server's, never the model's: it rides on the reply's words event, or on the fixed line
 * "Sent to the Universe team: ..." when the model said nothing. Once Matrix takes that event, Orbit is told once (DmReply.reportsDelivered).
 * A note whose receipt never got out (the send failed or was suppressed) is withdrawn by Orbit after 15 minutes, exactly like Take it back.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AdminApiService, BrickReportSend } from '../server/AdminApiService';
import type { BrickNote, ReportSentNote } from './BrickTools';
import { isInstantTool } from './InstantTools';

export const REPORT_TOOL = 'send_to_universe_team';

export function isReportTool(name: string): boolean {
    return name === REPORT_TOOL;
}

const KINDS = ['problem', 'cant_do', 'friction', 'idea'] as const;
type Kind = (typeof KINDS)[number];
const AREAS = ['apps', 'computer', 'pages', 'chat', 'voice', 'map', 'memory', 'files', 'credit', 'other'] as const;
const EFFECTS = ['stopped', 'slowed', 'idea'] as const;
export const REPORT_FAILURES = ['failed', 'signed_out', 'timed_out', 'not_allowed', 'no_result', 'missing_ability', 'corrected', 'idea'] as const;
export type ReportFailure = (typeof REPORT_FAILURES)[number];
/** The person's own words, as the Brick drafts them for the person to check (Orbit cleans them and cuts them to 280). */
const WORDS_MAX = 1200;
/** Notes one reply sends: one per problem, and a reply is about one or two. */
const NOTES_PER_REPLY = 2;
/** One of the Brick's own tools, as Orbit accepts it. */
const OWN_TOOL = /^[a-z][a-z0-9_]{1,59}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: object } };

export function reportToolDefinition(): ToolDefinition {
    return {
        type: 'function',
        function: {
            name: REPORT_TOOL,
            description:
                'Send a note to the Universe team, the people who build Universe and you, so they can fix it for every Brick. Use it on your own, without asking, when: ' +
                '(1) you cannot do something someone asked because you lack the ability; (2) a tool or App failed, signed out or gave nothing back; ' +
                '(3) someone corrected you or was unhappy with your answer; (4) you have a clear idea that would make you more useful. ' +
                'Always use it when someone asks you to report a problem, file or draft an issue, or tell the team: this is the only way a report reaches the team. ' +
                'Never make a page, document or file as a report instead. ' +
                'The note holds no words: only the kind, the area and which step of this reply it is about; what ran and how it failed are filled in for you. ' +
                'Only when the person asked to tell the team something, put what they want to say in `words`: they see the exact words and send them themselves. ' +
                'Once it is sent, say so in one short sentence in their language and carry on helping. Send one note per problem.',
            parameters: {
                type: 'object',
                properties: {
                    kind: {
                        type: 'string',
                        enum: [...KINDS],
                        description: 'problem: something went wrong. cant_do: an ability you do not have. friction: the person was unhappy or corrected you. idea: a clear idea.',
                    },
                    area: { type: 'string', enum: [...AREAS], description: 'Where it happened.' },
                    effect: { type: 'string', enum: [...EFFECTS], description: 'stopped: it stopped the work. slowed: it slowed it. idea: just an idea.' },
                    step: { type: 'string', description: 'Optional: the name of the tool you called in this reply that the note is about, exactly as you called it.' },
                    words: {
                        type: 'string',
                        description: 'Only when the person asked you to tell the team something: what they want to say, in their words, short. Leave it out otherwise.',
                    },
                },
                required: ['kind', 'area', 'effect'],
            },
        },
    };
}

const oneOf = <T extends string>(value: unknown, list: readonly T[]): T | undefined => (list as readonly string[]).includes(value as string) ? (value as T) : undefined;

/** One step this reply ran: what it was, in the words a note may carry, and how it ended (null when it worked). */
export interface ReportStep {
    name: string;
    /** One of the Brick's own tools by name, or `app` for any App (an App's tool names are its maker's words, never sent). */
    operation: string;
    /** For an App: the connection it ran on, so Orbit can name the catalog App it came from. */
    appConnectionId?: string;
    failure: ReportFailure | null;
}

/** This reply's own record for its notes, shared by its rounds. */
export interface ReportTurn {
    /** Every step this reply ran so far, in order. */
    steps: ReportStep[];
    /** What makes this reply's notes its own: the chat's message it answers, or a random id when there is none. */
    replyRef: string;
}

export function newReportTurn(eventId?: string): ReportTurn {
    return { steps: [], replyRef: eventId ? `event:${eventId}` : `reply:${randomUUID()}` };
}

/** Where a tool came from: an App (with its connection), or one the Brick was offered of its own. */
export interface StepSources {
    apps: ReadonlyMap<string, { connectionId?: string }>;
    offered: ReadonlySet<string>;
}

/** The words a tool's answer gives for why it did not work, if it did not; never its content. */
function failureWords(result: unknown): string | null {
    if (typeof result === 'string') return /^\s*(error|failed)\b/i.test(result) ? result.slice(0, 400) : null;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    const r = result as Record<string, unknown>;
    const failed = r.error !== undefined && r.error !== null && r.error !== false ? true : r.success === false || r.ok === false || r.isError === true;
    if (!failed) return null;
    const why = [r.error, r.message, r.note, r.code, r.status].filter((part) => typeof part === 'string' || typeof part === 'number').join(' ');
    return why || 'failed';
}

/** How a step ended, from its answer: null when it worked. Only the kind of failure is kept, never what it said. */
export function failureOf(result: unknown): ReportFailure | null {
    if (result === undefined || result === null || result === '') return 'no_result';
    if (Array.isArray(result) && result.length === 0) return 'no_result';
    const why = failureWords(result);
    if (why === null) return null;
    if (/time[sd]?[\s_-]?out|timeout|took too long|did not answer in time/i.test(why)) return 'timed_out';
    if (/sign(ed)?[\s_-]?(in|out)|unauthori[sz]ed|\b401\b|reconnect|expired|log(ged)?[\s_-]?in/i.test(why)) return 'signed_out';
    if (/not allowed|forbidden|\b403\b|permission|denied|refused/i.test(why)) return 'not_allowed';
    return 'failed';
}

/** Keeps what one round's tools were and how they ended (never what they gave back), for notes later in this reply. */
export function noteWhatRan(turn: ReportTurn, results: Array<{ name: string; result: unknown }>, sources: StepSources): void {
    for (const { name, result } of results) {
        if (!name || isReportTool(name)) continue;
        const app = sources.apps.get(name);
        let operation: string;
        let appConnectionId: string | undefined;
        // An Instant App is an App too: its tool name carries its maker's name and an id, never a note's words
        if (isInstantTool(name)) operation = 'app';
        else if (app) {
            operation = 'app';
            if (app.connectionId && UUID.test(app.connectionId)) appConnectionId = app.connectionId;
        } else if (sources.offered.has(name) && OWN_TOOL.test(name)) operation = name;
        // A tool the reply was not offered (a name the model made up) is not a step a note can be about
        else continue;
        turn.steps.push({ name, operation, ...(appConnectionId ? { appConnectionId } : {}), failure: failureOf(result) });
    }
}

const FAILURE_OF_KIND: Record<Kind, ReportFailure> = { problem: 'failed', cant_do: 'missing_ability', friction: 'corrected', idea: 'idea' };

/** The step a note is about: the one it names, or for a problem the last step that failed; none for anything else. */
function stepOf(turn: ReportTurn | undefined, kind: Kind, named: unknown): ReportStep | undefined {
    const steps = turn?.steps ?? [];
    if (typeof named === 'string' && named) {
        for (let i = steps.length - 1; i >= 0; i--) if (steps[i].name === named) return steps[i];
    }
    if (kind !== 'problem') return undefined;
    // A step that failed comes before one that only gave nothing back (an empty list can be a right answer)
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].failure && steps[i].failure !== 'no_result') return steps[i];
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].failure) return steps[i];
    return undefined;
}

export interface ReportToolContext {
    admin: Pick<AdminApiService, 'sendBrickReport'>;
    botId: string;
    /** Who was in the chat (person:<id>, guest:<id>), counted by Orbit as a one-way hash only. */
    personKey?: string;
    /** This reply's steps and reference. */
    turn?: ReportTurn;
    /** Where this turn's cards for the game wait until the reply goes out; null where the chat shows none (on the map). */
    notes: BrickNote[] | null;
    /** What the bot server already knows, with no words in it. */
    context?: BrickReportSend['context'];
}

/** Per reply (its list of notes), the notes being sent this moment, by reference, each with what the Brick is told once Orbit answers. */
const sending = new WeakMap<BrickNote[], Map<string, Promise<Record<string, unknown>>>>();

const NOT_CONFIRMED =
    'Could not confirm the note reached the Universe team. Do not send it again in this reply and never say it was sent; if the person asked you to report it, say in one short sentence that you could not confirm it went.';

/** Runs send_to_universe_team. Never throws: the Brick is told in plain words what happened. */
export async function runReportTool(args: Record<string, unknown>, context: ReportToolContext): Promise<Record<string, unknown>> {
    const kind = oneOf(args.kind, KINDS);
    if (!kind) return { sent: false, error: 'Say what kind of note it is: problem, cant_do, friction or idea.' };
    const area = oneOf(args.area, AREAS) ?? 'other';
    const effect = oneOf(args.effect, EFFECTS) ?? (kind === 'idea' ? 'idea' : 'slowed');
    const step = stepOf(context.turn, kind, args.step);
    const operation = step?.operation ?? 'none';
    const failure = step?.failure ?? FAILURE_OF_KIND[kind];
    // Tried again: the same tool failed earlier in this reply (the same tool run twice on different things is not trying again)
    const steps = context.turn?.steps ?? [];
    const retried = !!step && steps.slice(0, steps.indexOf(step)).some((other) => other.name === step.name && other.failure !== null);
    const draftWords = typeof args.words === 'string' && args.words.trim() ? args.words.trim().slice(0, WORDS_MAX) : undefined;
    const replyRef = context.turn?.replyRef ?? `reply:${randomUUID()}`;
    // Every App is "app" to Orbit, so which App it was (its connection, or its tool for one with none) keeps two Apps' notes apart
    const which = operation === 'app' ? (step?.appConnectionId ?? step?.name ?? '') : '';
    const ref = createHash('sha256').update([replyRef, context.botId, kind, area, operation, failure, which].join('|')).digest('hex');

    const report: BrickReportSend = {
        botId: context.botId,
        ...(context.personKey ? { personKey: context.personKey } : {}),
        ref,
        kind,
        area,
        operation,
        ...(step?.appConnectionId ? { appConnectionId: step.appConnectionId } : {}),
        failure,
        retried,
        effect,
        ...(draftWords ? { draftWords } : {}),
        ...(context.context ? { context: context.context } : {}),
    };

    // The notes this reply already sent, and the ones being sent right now (tool calls of one round run side by side)
    const sentAlready = () => (context.notes ?? []).filter((note): note is ReportSentNote => note.kind === 'report');
    const flying = context.notes ? (sending.get(context.notes) ?? new Map<string, Promise<Record<string, unknown>>>()) : new Map<string, Promise<Record<string, unknown>>>();
    const same = sentAlready().find((note) => note.ref === ref);
    if (same) return draftWords && !same.wordsDraft ? addDraftWords(same, report, context) : ALREADY_SENT;
    // The same note is being sent beside this call: say what that one says (taken back, refused, not confirmed), never "sent" before it is
    const twin = flying.get(ref);
    if (twin) {
        const firstAnswer = await twin;
        if (firstAnswer.sent !== true) return firstAnswer;
        const first = sentAlready().find((note) => note.ref === ref);
        return first && draftWords && !first.wordsDraft ? addDraftWords(first, report, context) : ALREADY_SENT;
    }
    if (sentAlready().length + flying.size >= NOTES_PER_REPLY) return { sent: false, note: 'Enough notes for one reply. Do not send more now and do not mention it.' };

    // Held before Orbit is asked, so a call beside this one sees it and waits for what it is told; let go once the answer is in
    const answer = sendNew(report, context);
    flying.set(ref, answer);
    if (context.notes) sending.set(context.notes, flying);
    try {
        return await answer;
    } finally {
        flying.delete(ref);
    }
}

/** Sends a note this reply has not sent yet, and keeps it for the line under the answer when it went. Never throws. */
async function sendNew(report: BrickReportSend, context: ReportToolContext): Promise<Record<string, unknown>> {
    let outcome: Awaited<ReturnType<AdminApiService['sendBrickReport']>> | undefined;
    // Asked once more with the same reference when the answer is lost: Orbit keeps one note per reference and answers the same receipt
    for (let attempt = 0; attempt < 2 && !outcome; attempt++) {
        try {
            outcome = await context.admin.sendBrickReport(report);
        } catch (error) {
            console.warn('[ReportTools] Could not send a note to the Universe team:', error instanceof Error ? error.message : error);
        }
    }
    if (!outcome) return { sent: false, uncertain: true, note: NOT_CONFIRMED };
    if (outcome.sent === false) {
        if (outcome.reason === 'limit') return { sent: false, note: 'You sent enough notes today. Do not say it was sent; carry on helping.' };
        if (outcome.reason === 'refused') return { sent: false, note: 'The note could not be sent. Do not send it again in this reply and do not say it was sent; carry on helping.' };
        return { sent: false, note: 'This chat cannot send notes to the Universe team. Do not say it was sent; carry on helping.' };
    }
    if (outcome.takenBack) return { sent: false, note: 'Someone in this chat took this note back. Do not send it again and do not say it was sent.' };
    const kept: ReportSentNote = {
        kind: 'report',
        id: outcome.id,
        key: outcome.takeBackKey,
        ref: report.ref,
        noteKind: outcome.note.kind,
        area: outcome.note.area,
        title: outcome.note.title,
        failure: outcome.note.failure,
        retried: outcome.note.retried,
        ...(outcome.wordsPreview ? { wordsDraft: outcome.wordsPreview } : {}),
        sentAt: Date.now(),
    };
    context.notes?.push(kept);
    return {
        sent: true,
        title: kept.title,
        note: outcome.wordsPreview ? WORDS_TO_SEND : 'Sent. Say in one short sentence, in their language, that you sent it to the Universe team, then carry on helping. Do not promise when it will be fixed.',
    };
}

const ALREADY_SENT = { sent: true, note: 'Already sent in this reply. Do not send it again.' };

const WORDS_TO_SEND =
    'Sent, without their words. The chat shows them the exact words to send with a Send button: say in one short sentence, in their language, that the note went to the Universe team and they can check their words and press Send. Do not promise when it will be fixed.';

/**
 * The same note again in this reply, now with words the person asked to say: asked again with the same reference, Orbit answers the same
 * receipt with the words cleaned and keeps nothing new, so the note in the chat gets the words to show with its Send button.
 */
async function addDraftWords(note: ReportSentNote, report: BrickReportSend, context: ReportToolContext): Promise<Record<string, unknown>> {
    let outcome: Awaited<ReturnType<AdminApiService['sendBrickReport']>> | undefined;
    for (let attempt = 0; attempt < 2 && !outcome; attempt++) {
        try {
            outcome = await context.admin.sendBrickReport(report);
        } catch (error) {
            console.warn('[ReportTools] Could not add words to a note:', error instanceof Error ? error.message : error);
        }
    }
    if (outcome?.sent === true && !outcome.takenBack && outcome.id === note.id && outcome.wordsPreview) {
        note.wordsDraft = outcome.wordsPreview;
        return { sent: true, title: note.title, note: WORDS_TO_SEND };
    }
    return { sent: true, note: 'Already sent in this reply, but their words could not be added to it. Do not send it again.' };
}

/** The fixed line a reply with no words of its own says for the notes it sent. */
export function reportSentText(notes: ReportSentNote[]): string {
    return notes.length === 1 ? `Sent to the Universe team: ${notes[0].title}.` : `Sent to the Universe team: ${notes.map((note) => note.title).join('; ')}.`;
}
