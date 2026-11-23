/**
 * A Brick's computer in its owner's chat (game #2000), on the bot server.
 *
 * `use_computer` starts a job on the Brick's own computer. It is the LAST way: an app that can do the job is used instead and wakes
 * nothing, and reading a page is `read_web_page`, never a computer. The tool is only offered when Orbit says the computer is on for
 * this person, so choosing it never wakes anything by itself: waking happens when Orbit starts the job, and only for the owner.
 * What the model is told for each way a start can go is one plain line to say, in the person's language, in the words of the mock
 * (Part 12): a second job waits its turn, a resting computer wakes, a broken one says so, a restored one says which day.
 * No count, no price, no provider or machine name ever reaches the model, so none reaches the chat.
 */
import { createHash, randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/node';
import type { StartKeyStore, StoredStartKey, StoredStartPayload } from '../server/ComputerStartKeys';
import { jobLine, type JobNote } from './JobStatusLine';
import type { AdminApiService, CannotContinue } from '../server/AdminApiService';
import { CANNOT_CONTINUE_NOTE, cannotContinue, cannotContinueSaid } from './ComputerTryAgainWords';
import { computerControlNote, isComputerControlTool } from './ComputerControlTools';

export const COMPUTER_TOOL = 'use_computer';

/** A tool of the Brick's own computer: starting a job, or one of its controls (`ComputerControlTools`). They are offered, gated and kept from anyone but the owner together. */
export function isComputerTool(name: string): boolean {
    return name === COMPUTER_TOOL || isComputerControlTool(name);
}

const TITLE_MAX = 120;
const DETAILS_MAX = 4000;

export function computerToolDefinitions(): { type: 'function'; function: { name: string; description: string; parameters: object } }[] {
    return [
        {
            type: 'function',
            function: {
                name: COMPUTER_TOOL,
                description:
                    'Start a job on your own computer, a real screen with a browser that stays yours between jobs. Use it ONLY for a job nothing else can do: filling in a form on a site that has no app, ' +
                    'booking on a page you must click through, working in a website or a file that lives on the computer. Never when an app you have can do it, never to just read or search a page (use the page and search tools), ' +
                    'and never to be safe. Do not ask them first: start it, then say in one short sentence what you started. The person can Watch, Stop or take over from the bar above this chat. ' +
                    'Paying, submitting and the person\'s own details are never yours alone: the computer asks them first.',
                parameters: {
                    type: 'object',
                    properties: {
                        job: { type: 'string', description: 'What the job is, in a few plain words, as the bar will show it: "Visa form", "Shop website", "Taxi booking".' },
                        details: { type: 'string', description: 'Everything the computer needs to do it, in the person\'s words: the site, what they asked for, the choices they made. Leave out passwords, card numbers and ID numbers: the computer asks the person for those when it needs them.' },
                        app: { type: 'string', description: 'Only when one of your apps could seem to fit this job: its name, as it is connected. Leave out otherwise.' },
                        app_steps: { type: 'integer', description: 'With app: about how many steps (your own turns) that app would take to do the whole job. Your best guess, a whole number.' },
                        app_cannot: { type: 'string', description: 'Only when one of your apps could seem to fit this job: in a few words, why that app cannot do it (it has no such action, or the job lives on a website screen). Leave out otherwise.' },
                        reads_only: { type: 'boolean', description: 'True when the job only looks and writes nothing anywhere (it may run beside another job). Leave out otherwise.' },
                        try_again: { type: 'boolean', description: 'True only when your instructions name a job under "Try again" and the person asks you to try that job again or carry on with it: it carries on from where it stopped. Leave out otherwise.' },
                    },
                    required: ['job'],
                },
            },
        },
    ];
}

/** What a Brick with a computer is told with its instructions: the order of choosing, and what it never does. */
export function computerToolsNote(): string {
    return [
        'Your computer: you have your own computer. Choose in this order: answer yourself, then an app you have, and only then the computer (use_computer), for a job nothing else can do.',
        'It does one writing job at a time: a second job waits its turn, and you say so in one line. Never say how much of their month is left, and never name a price, a size or a machine.',
        'Paying and sending the person\'s own details are theirs: you stop and ask them, you never do them alone.',
        computerControlNote(),
    ].join('\n');
}

/**
 * The confirmations of one reply's starts. A confirmation is this game's own word that it holds the answer for a job and has told the person (`start-ack`): it goes only once the reply
 * that says it has been handed to the person's chat without error (`deliver`, called by whoever sent the reply). A reply that fails, is replaced by a newer message, or whose send
 * fails sends nothing (`drop`), and the open-start record of each key stays in the store, so the next ask looks the job up again, tells the person of it, and queues it again.
 * Whatever is only in this queue's memory is lost with the process: Orbit's guard then answers `earlier` once, which is true.
 */
export class ConfirmationQueue {
    private items = new Map<string, { send: () => Promise<void>; note?: JobNote; told?: true }>();
    /** Delivered: the one event that could confirm anything has been taken. */
    private closed = false;
    /** A newer turn (or the same reply asked again) replaced this queue: nothing new is added to it, and what was never put into a reply is gone. What WAS (the lines the reply being sent carries) stays until that event is taken. */
    private dropped = false;

    /**
     * A job was named to the person in this reply: its confirmation waits for the reply to be delivered. One per key. `note` says which job and what became of it (see `jobLine`): the reply carries
     * a fixed sentence built from it when the answer has no words of its own, so what is confirmed is always something the person was told.
     */
    add(key: string, send: () => Promise<void>, note?: JobNote): void {
        if (this.closed || this.dropped) return;
        // A job the reply being sent already names (`tell` put its line in the words) keeps its entry: the same key added again must not take away what that event will confirm
        if (this.items.get(key)?.told) return;
        this.items.set(key, { send, ...(note ? { note } : {}) });
    }

    private starts = 0;

    /** The ordinal of the next computer start of this reply (0, 1, 2 ...): with the inbound event it is a start's identity (see `startKeyFor`). A new queue (a retried reply) counts again from 0. */
    nextStart(): number {
        return this.starts++;
    }

    /** How many confirmations wait. */
    get size(): number {
        return this.items.size;
    }

    /** The jobs waiting to be confirmed, as the reply names them (none once it was delivered or dropped: both empty it). */
    notes(): JobNote[] {
        return [...this.items.values()].flatMap((item) => (item.note ? [item.note] : []));
    }

    /**
     * The reply's text now carries the fixed line of every job waiting here (see `jobLine`), in the one event that is about to be sent: only those jobs can be confirmed by that event.
     * Returns the lines, in order and without repeats.
     */
    tell(): string[] {
        const lines: string[] = [];
        for (const item of this.items.values()) {
            if (!item.note) continue;
            item.told = true;
            const line = jobLine(item.note);
            if (!lines.includes(line)) lines.push(line);
        }
        // Then Brick's fixed lines about the controls of this reply (pause, carry on, cancel...: `ComputerControlTools`), in the order they were said
        for (const said of this.said) {
            said.told = true;
            if (!lines.includes(said.line)) lines.push(said.line);
        }
        return lines;
    }

    private said: Array<{ line: string; onTold?: () => void; told?: true }> = [];

    /**
     * A fixed line of Brick's about a control of its computer jobs (see `ComputerControlWords`): it goes under the reply in the same event as the job lines (`tell`), and `onTold` runs
     * once Matrix took that event (a question that was never delivered was never asked). Nothing is confirmed to Orbit by it. The same line twice in one reply is said once.
     */
    say(line: string, onTold?: () => void): void {
        if (this.closed || this.dropped || !line) return;
        const same = this.said.find((said) => said.line === line);
        if (same) {
            if (onTold) {
                const before = same.onTold;
                same.onTold = () => {
                    before?.();
                    onTold();
                };
            }
            return;
        }
        this.said.push({ line, ...(onTold ? { onTold } : {}) });
    }

    /** Whether this reply carries a fixed control line. */
    get saying(): boolean {
        return this.said.length > 0;
    }

    /**
     * Matrix took the event that carries the lines (`tell`) and gave its id: each job named in it is confirmed once, best effort and in order, and none is sent again. Without an id (a send that
     * was suppressed, or whose answer had none) nothing is confirmed: no event is known to have told the person. A job that was never told in that event is not confirmed by it. Never throws.
     */
    async deliver(eventId?: string): Promise<void> {
        if (this.closed || typeof eventId !== 'string' || eventId === '') return;
        this.closed = true;
        // A control line's question counts as asked only once the event that carries it was taken
        for (const said of this.said.splice(0)) {
            if (!said.told) continue;
            try {
                said.onTold?.();
            } catch {
                /* never in the way of a reply */
            }
        }
        // The entries of THIS event are taken first: a newer answer can drop the queue while a send is awaited, and every job this accepted event named is still confirmed once
        for (const { send, told } of [...this.items.values()]) {
            if (!told) continue;
            try {
                await send();
            } catch {
                /* a confirmation is never in the way of a reply */
            }
        }
        this.items.clear();
    }

    /**
     * The reply was not delivered, or a newer message replaced it: what was never put into a reply is gone, and nothing new is added. The jobs and the questions of a reply that was ALREADY
     * handed over to be sent (`tell` was called for it) stay: a newer turn can begin while that send is awaited, and the event Matrix then accepts did tell the person of them, so it
     * still confirms those jobs and asks those questions (`deliver`). A reply that never gets delivered leaves them in a queue nothing refers to any more.
     */
    drop(): void {
        this.dropped = true;
        for (const [key, item] of [...this.items]) if (!item.told) this.items.delete(key);
        this.said = this.said.filter((said) => said.told);
    }
}

export { jobLine } from './JobStatusLine';
export type { JobNote } from './JobStatusLine';

/**
 * The key of a computer start, made from where the ask came from: the Brick, the chat, the inbound event and which start of the reply it is. The same inbound event delivered again (Matrix
 * may send a transaction again; a bot server restarts and finds the event again) makes the SAME key, so Orbit answers the job the first one made, and never a second reservation, with
 * Redis empty or not. A new message is a new event, so it is a new key. The shape is Orbit's (`[A-Za-z0-9_-]{8,64}`): `mx_` and 32 letters and digits.
 */
export function startKeyFor(botId: string, roomId: string, eventId: string, ordinal: number | string): string {
    return `mx_${createHash('sha256').update(`${botId}|${roomId}|${eventId}|${ordinal}`).digest('hex').slice(0, 32)}`;
}

export interface ComputerToolContext {
    admin: Pick<AdminApiService, 'startComputerJob'> & Partial<Pick<AdminApiService, 'lookUpComputerStart' | 'ackComputerStart'>>;
    /** The apps this person has connected to this Brick in this reply (their names), so a job an app can do is not started on the computer. */
    apps?: string[];
    botId: string;
    userId: string;
    /** Whether the speaker signed in as a guest, as the chat knows it: sent with the id, so Orbit never has to guess what kind of id it is (an id with an "@" is looked up as an email). */
    isGuest?: boolean;
    /** The direct chat this reply is in: the job is started from it, and its result goes back to it and nowhere else. */
    origin?: { kind: 'dm'; ref: string };
    /** The inbound Matrix event this reply answers: a start made for it has a key made from it (`startKeyFor`), so the same event delivered again makes no second job. Without it a start has a random key. */
    inbound?: { roomId: string; eventId: string };
    /** The apps a review in this reply said the computer could do better: a call that names one with how many steps are left is for Orbit to weigh, not sent back to the app. */
    reviewed?: ReadonlySet<string>;
    /** Called once a job is running, so a development server can pretend to do it. */
    onStarted?: (jobId: string) => void;
    /**
     * "Try again" (piece 8): the ended job Orbit named for this turn, only when the person's words ask to try again or this is their first message since Brick told them how it ended
     * (`ComputerTryAgain`). A `use_computer` with `try_again: true` carries THAT job on, under its title; without it (or without `try_again`) a start is an ordinary fresh job.
     */
    retry?: { id: string; title: string };
    /**
     * The start keys of this person's asks to this Brick (kept by the chat's memory). ONE start is open at a time, whatever its title: while its outcome is not known (`unknown`) or
     * its job was found live (`starting`), every ask (a reply written again, a tool call retried, a reworded title, the person asking again, an hour or a day later) is that start:
     * its key is looked up first, and nothing new is sent until it is resolved. A start that is settled (a job that was started, ended or finished) keeps its key for this turn and
     * this title only, and a new message from the person starts that clean (`forgetSettledStarts`): a deliberate second job after that has a key of its own. Without it every ask has
     * a key of its own.
     */
    startKeys?: Map<string, StartKeyEntry>;
    /**
     * Where the key of the open start is also kept (no title in it), so a restart of this server between a start and its answer still finds it, and another bot server handling an ask
     * of the same person and Brick uses the same key (see `ComputerStartKeys`): claimed in one step BEFORE the start is sent, kept until the outcome is final (with a safety life, no
     * short one). Without it (or when it fails) the process's own memory is all there is.
     */
    startKeyStore?: StartKeyStore;
    /**
     * Where the confirmations of the starts this reply names go until the reply is delivered. Without it the tool confirms nothing (the record of each key stays in the store, so it is
     * looked up again at the next ask).
     */
    confirmations?: ConfirmationQueue;
    /**
     * Offers the person a "Start a new job" button under this reply, for the job of that title (GPT's sixth answer, finding 6): called when Orbit refuses to carry a job on and a new
     * job is a sensible next step. Nothing is started by it; the tap is an ordinary new start, with its own key. Without it the refusal is said and no button goes out.
     */
    offerNewJob?: (title: string) => void;
}

/** The start of an ask: its key, when it was first sent, and whether its outcome is still open (`unknown`, `starting`). */
export interface StartKeyEntry {
    key: string;
    at: number;
    open: boolean;
    /** A start with this key may already have gone out (this process sent it, or the store held the key of one): it is looked up by its key before anything is sent. */
    sent?: true;
    /** The call of this entry that is going on: the next ask waits for it and then sees how it ended, so two asks never go out beside each other. */
    inflight?: Promise<Record<string, unknown>>;
    /** Reported to Sentry as unresolved for an hour (once). */
    reported?: true;
    /** Made by this call and not yet confirmed by the shared store: this process knew no key of an open start (a restart, or the first ask here). Gone once the store answered or the start was let go on. */
    unchecked?: true;
    /**
     * What this start said, exactly as it was sent (the words of the ask that first sent this key). A start that is sent AGAIN under its key (its look-up found no job yet) sends THIS, never
     * the words of whatever the person asks now: the key is that start's identity at Orbit. An entry without it (a key a store held with no words, or damaged ones) is only looked up, never sent.
     */
    payload?: StoredStartPayload;
    /** Set when Orbit answered `earlier` for this ask: the state of the job it named (`starting`, `done`, `ended`, `unknown`). The ask made nothing; the same ask in this turn is answered the same, with nothing sent. */
    found?: string;
    /** With `found`: the job was MADE by the resend of this start (not found live by a look-up), so once it is confirmed its record goes. */
    made?: true;
    /** With `found`: the title of the ask that job was made for, when it is known (the words of a retained start). */
    title?: string;
    /** With `found` and `made`: the job the resend made is queued (it has not started), and Orbit's reason (`allowance`, `turn`, `busy`, `pool`). A job that is only FOUND again is never told as queued: Orbit does not say whether it runs or waits. */
    queued?: true;
    queuedFor?: string | null;
}

/**
 * How long the start of an ask whose outcome is still open is kept: no time limit of its own, only a safety life so a record nobody can resolve does not stay for ever. A start is
 * open until an answer or a look-up by its key says what became of it, however long that takes; Orbit makes one job of one key, so the same key is always safe to send.
 */
export const OPEN_START_KEEP_MS = 24 * 60 * 60_000;
/** After this long an open start is reported (it is still looked up on every ask): a start nobody could resolve for an hour wants a person's eyes. */
export const OPEN_START_REPORT_MS = 60 * 60_000;
/** Where the one open start of a person and Brick is kept in the chat's map (the settled ones of this turn are kept by title). */
export const OPEN_START_SLOT = '\u0000open';
/**
 * Where a job found for an EARLIER ask (a look-up of an earlier send that found it live, done or ended, or Orbit's `earlier`) is kept for the rest of the turn, whatever the title of the next
 * use_computer call: every call in the turn is answered with it and nothing is sent (a reworded call would otherwise send a new key, and Orbit, which now has the earlier job confirmed, would make a second job).
 * The person's next message clears it (it is not an open start).
 */
export const FOUND_EARLIER_SLOT = '\u0000found';
const COULD_NOT_CHECK_NOTE = 'It is not known whether this job started. Say in one short sentence, in the person\'s language and in these words: "I couldn\'t check whether this job has started. I\'ll use the same request when you check again." They can also look at the bar above this chat. Do not say it failed or that it started.';

/** What was asked, as one string: the same title in the same chat is the same ask (the details a model words differently when it asks again do not make a second job). */
const askedOf = (job: string, origin: { kind: 'dm'; ref: string } | undefined): string => JSON.stringify([origin?.kind ?? null, origin?.ref ?? null, job.toLowerCase()]);

/** At a new message from the person: the keys of asks that are settled are forgotten; the open start stays until its outcome is known (or its safety life is over). */
export function forgetSettledStarts(starts: Map<string, StartKeyEntry> | undefined, now = Date.now()): void {
    if (!starts) return;
    for (const [asked, entry] of starts) if (!entry.open || now - entry.at >= OPEN_START_KEEP_MS) starts.delete(asked);
}

/** The reasons a start was refused before any job was made: the ask went nowhere, so the next ask in the turn is a new one with a key of its own. */
const UNCERTAIN_REASONS = ['starting', 'unknown', 'ended', 'done'];
/** Of those, the ones whose outcome is still open: the key stays for the next ask of the same title, whichever turn it is in. */
const OPEN_REASONS = ['starting', 'unknown'];

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const day = (iso: string): string => {
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

const plain = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The fixed order is answer, then an app, then the computer. The first is Brick's own judgement; this is the second, checked where the
 * job is started: when the job names one of the person's connected apps, it goes there first, unless Brick says in its own words why
 * that app cannot do it. Never silent and never a price: the model is told in one plain line.
 */
export function appThatFits(job: string, details: string, apps: string[] | undefined): string | null {
    const haystack = ` ${plain(`${job} ${details}`)} `;
    for (const app of apps ?? []) {
        const name = plain(app);
        if (name.length >= 3 && haystack.includes(` ${name} `)) return app;
    }
    return null;
}

/** Every this many steps an app has taken in one answer, the Brick looks again at whether the computer would be the better way for the rest. */
export const APP_STEP_CHECKPOINT = 20;

/** Whether going from `before` to `after` steps passed a checkpoint (20, 40, 60...). */
export function checkpointCrossed(before: number, after: number): boolean {
    return after > before && Math.floor(after / APP_STEP_CHECKPOINT) > Math.floor(before / APP_STEP_CHECKPOINT);
}

/** Every checkpoint passed in going from `before` to `after` steps, in order (a round that adds many steps can pass more than one). */
export function checkpointsCrossed(before: number, after: number): number[] {
    const passed: number[] = [];
    for (let at = (Math.floor(before / APP_STEP_CHECKPOINT) + 1) * APP_STEP_CHECKPOINT; at <= after; at += APP_STEP_CHECKPOINT) passed.push(at);
    return passed;
}

/** One line for the model at a checkpoint: no price, and nothing for the person unless the Brick moves the work. */
export function appStepsNote(app: string, steps: number): string {
    return `You have taken ${steps} steps in ${app} on this job. If a lot of the job is still left, your computer may be the better way to finish it: call use_computer for the rest, with app "${app}" and app_steps about how many steps the rest would take in ${app} (no app_cannot is needed). If it is nearly done, just finish it in ${app}. Say nothing about this to the person unless you move the work.`;
}

/** A step that did not run, or did not finish: it is not a step the App took. */
const notTaken = (result: unknown): boolean => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
    const given = result as Record<string, unknown>;
    return given.error !== undefined || given.success === false || given.isError === true || given.status === 'waiting_for_ok';
};

/** What the model reads of an App result at a checkpoint: the line first, so that cutting a long result for room never cuts it. The person's own view of the step is made from the result and is not this. */
export function withReviewNote(text: string, note: string | undefined): string {
    return note ? `${note}\n\n${text}` : text;
}

export interface AppStepReview {
    /** The line for the model, by the id of the App result it goes with (the model's copy only: what the person sees is left as it was). */
    notes: Map<string, string>;
    /** The Apps whose steps a review said the computer could do better: a use_computer that names one of them and says how many steps are left goes to Orbit to weigh. */
    accepted: Set<string>;
}

/**
 * Counts the steps the apps took in one round of tool calls (`counts` is kept for the whole answer, per app) and, for every checkpoint an
 * app's count passes, asks whether to look again at the computer (`ask`, which is Orbit's call). When one of those says yes, the line is
 * given for that app's last result of the round, to be put first in the model's copy of it. A step that failed or is waiting for an OK is not
 * counted. Nothing is changed in the results. Advice only, and never throws: a question that cannot be answered adds nothing.
 */
export async function reviewAppSteps(
    results: Array<{ id: string; name: string; result: unknown }>,
    appOf: (toolName: string) => string | undefined,
    counts: Map<string, number>,
    ask: (app: string, steps: number) => Promise<boolean>,
    cancelled: () => boolean = () => false
): Promise<AppStepReview> {
    const review: AppStepReview = { notes: new Map(), accepted: new Set() };
    const lastOf = new Map<string, string>();
    const taken = new Map<string, number>();
    for (const entry of results) {
        const app = appOf(entry.name);
        if (!app || notTaken(entry.result)) continue;
        taken.set(app, (taken.get(app) ?? 0) + 1);
        lastOf.set(app, entry.id);
    }
    for (const [app, more] of taken) {
        const before = counts.get(app) ?? 0;
        const after = before + more;
        counts.set(app, after);
        for (const at of checkpointsCrossed(before, after)) {
            if (cancelled()) return review;
            try {
                if (await ask(app, at)) {
                    review.accepted.add(app);
                    const id = lastOf.get(app);
                    if (id !== undefined) review.notes.set(id, appStepsNote(app, after));
                    break;
                }
            } catch (error) {
                console.warn('[ComputerTools] Could not weigh the steps of an app:', error instanceof Error ? error.message : error);
            }
        }
    }
    return review;
}

/** Runs use_computer. Never throws: the model is told in plain words what happened. */
export async function runComputerTool(args: Record<string, unknown>, context: ComputerToolContext): Promise<Record<string, unknown>> {
    // "Try again" of the job Orbit named for this turn: that job, under its own title (the bar shows the same job), carried on from where it stopped. Orbit decides again
    const carryOn = args.try_again === true && context.retry ? context.retry : undefined;
    const job = carryOn ? text(carryOn.title, TITLE_MAX) : text(args.job, TITLE_MAX);
    if (!job) return { error: 'Say in a few words what the job is.' };
    const brief = typeof args.details === 'string' ? args.details.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, DETAILS_MAX) : '';
    // A job that carries on was already on the computer: the order of choosing was made when it began
    const fits = carryOn ? null : appThatFits(job, brief, context.apps);
    const appCannot = text(args.app_cannot, 300);
    const stepsGiven = typeof args.app_steps === 'number' && Number.isInteger(args.app_steps) && args.app_steps >= 1;
    const afterReview = !!fits && stepsGiven && !!context.reviewed && [...context.reviewed].some((app) => plain(app) === plain(fits));
    if (fits && appCannot.length < 8 && !afterReview) {
        return { started: false, success: false, note: `You have ${fits} connected, and this names it: do the job through ${fits} first. Only if it truly cannot (it has no such action, or the job lives on a website screen), call use_computer again and say why in app_cannot. Say nothing about this to the person unless the app cannot do it either.` };
    }
    // The way Brick weighed: Orbit works out which way costs least and says so (no price comes back, and none goes to the model)
    // (at most 120 letters, as the name the model gave is: a connected app's name is held to the same, so what is stored with the key is always what the reader of the store takes back)
    const planned = text(args.app, 120) || text(fits, 120);
    const steps = typeof args.app_steps === 'number' && Number.isInteger(args.app_steps) && args.app_steps >= 1 ? Math.min(args.app_steps, 10000) : undefined;
    const plan = planned ? { app: planned, ...(steps !== undefined ? { steps } : {}), ...(appCannot ? { appCannot } : {}) } : undefined;
    // ONE open start per Brick and person (not per title): while a start is open (sent and its outcome not known, or its job found live) every ask of this person to this Brick is that
    // start (see `startKeys`), whatever its title, and is looked up by its key before anything new is sent. A start that is settled keeps its key for this turn and this title only.
    const asked = askedOf(job, context.origin);
    const scope = `${context.botId}|${context.userId}`;
    const now = Date.now();
    // A job named to the person in this reply is confirmed to Orbit once the reply is delivered, and the record of its key goes after the confirmation, never before
    // (a job that is still live keeps its start OPEN, as since v63, so its record stays: it goes when the job is found over)
    const confirmLater = (key: string, stillOpen: boolean, note: JobNote): void =>
        context.confirmations?.add(
            key,
            async () => {
                await context.admin.ackComputerStart?.(context.botId, context.userId, { ...(typeof context.isGuest === 'boolean' ? { isGuest: context.isGuest } : {}), attempt: key }).catch(() => false);
                if (!stillOpen) await context.startKeyStore?.delete(scope, key).catch(() => undefined);
            },
            note
        );
    // A job that is FOUND again is told as found (`recovered`), finished or ended: Orbit does not say whether a job it finds is running or waiting
    const stateOf = (reason: string): 'recovered' | 'done' | 'ended' => (reason === 'done' ? 'done' : reason === 'ended' ? 'ended' : 'recovered');
    // A job already found for an earlier ask in this turn is every call's answer, whatever it says: nothing is sent
    const foundEarlier = context.startKeys?.get(FOUND_EARLIER_SLOT);
    if (foundEarlier?.found && now - foundEarlier.at < OPEN_START_KEEP_MS) {
        confirmLater(foundEarlier.key, foundEarlier.found === 'starting' && !foundEarlier.made, { state: foundEarlier.made ? (foundEarlier.queued ? 'queued' : 'started') : stateOf(foundEarlier.found), earlier: !foundEarlier.made, ...(foundEarlier.made && foundEarlier.queued ? { queuedFor: foundEarlier.queuedFor ?? null } : {}), ...(foundEarlier.title ? { title: foundEarlier.title } : {}) });
        return answerOf({ ok: false, reason: foundEarlier.found } as StartAnswer, context, true);
    }
    const open = context.startKeys?.get(OPEN_START_SLOT);
    const settled = context.startKeys?.get(asked);
    const earlier = open && now - open.at < OPEN_START_KEEP_MS ? open : settled && !settled.open ? settled : undefined;
    // An ask that is in flight is finished first: the next one then sees how it ended (a start that worked, a start whose outcome is open) and never goes out beside it
    if (earlier?.inflight) {
        await earlier.inflight.catch(() => undefined);
        return runComputerTool(args, context);
    }
    // Open until the answer says otherwise: a start in flight that a new message of the person cleared would be sent again under another key (a second job)
    const current: StoredStartPayload = { title: job, ...(brief ? { brief } : {}), ...(args.reads_only === true ? { writes: false } : {}), ...(plan ? { plan } : {}), ...(context.origin ? { origin: context.origin } : {}), ...(carryOn ? { continues: carryOn.id } : {}) };
    // A new start of THIS inbound event has the key its event, chat and ordinal make (the same event again, the same key); a start the chat did not come from has a random one
    const newKey = (): string => {
        if (!context.inbound || !context.confirmations) return randomUUID();
        // A reply written again has a new queue that counts from 0, but the starts the first one made are kept (their entries stay for the turn): a new start never takes the key of a kept one
        const kept = new Set<string>();
        for (const one of context.startKeys?.values() ?? []) if (one.key) kept.add(one.key);
        let key = startKeyFor(context.botId, context.inbound.roomId, context.inbound.eventId, context.confirmations.nextStart());
        while (kept.has(key)) key = startKeyFor(context.botId, context.inbound.roomId, context.inbound.eventId, context.confirmations.nextStart());
        return key;
    };
    const entry: StartKeyEntry = earlier ?? { key: newKey(), at: now, open: true, unchecked: true, payload: current };
    // The entry is put where the next call finds it BEFORE anything is awaited
    if (entry.open) context.startKeys?.set(OPEN_START_SLOT, entry);
    else context.startKeys?.set(asked, entry);
    const go = async (): Promise<Record<string, unknown>> => {
        // An ask that Orbit answered with an earlier job of the person's is answered the same when it comes again in this turn: nothing is sent (a second job would be paid for behind the first)
        if (!entry.open && entry.found) {
            confirmLater(entry.key, entry.found === 'starting', { state: stateOf(entry.found), earlier: true, ...(entry.title ? { title: entry.title } : {}) });
            return answerOf({ ok: false, reason: entry.found } as StartAnswer, context, true);
        }
        // Open when this call began: a key that went out before (here, at another server, or in an earlier turn) and whose outcome was not known. The words it said are the ones that go again.
        const wasOpen = entry.open;
        /** Whether the record of the key now in use is this call's own (stored by it): only then may a definite failure delete it. */
        let ownsRecord = true;
        // The FIRST key of the open start wins, across bot servers and restarts: one step in the shared store keeps ours BEFORE the start is sent unless it already holds a key
        // of an open start of this person and Brick, and answers the one it holds (no title in it, no expiry short of the safety life). A restart that forgot the process's
        // memory, a second server, and an ask racing a stored one all go on with THAT key, and look it up first.
        if (context.startKeyStore && entry.open) {
            const store = context.startKeyStore;
            const held = await store.claim(scope, { key: entry.key, at: entry.at, ...(entry.payload ? { payload: entry.payload } : {}) }, OPEN_START_KEEP_MS - (now - entry.at), OPEN_START_KEEP_MS).catch(() => undefined);
            // A record that was already there, even for the same key, is not this call's to delete
            if (held && held.mine === false) ownsRecord = false;
            // A record this call did not store is another attempt's, whatever key it holds (the very key proposed too): that attempt may well have gone out, so its key is looked up first and
            // only its own words are ever sent, never the words of this call. Only a key this call stored itself is sent straight away
            if (held && (held.key !== entry.key || held.mine === false)) {
                // Another attempt holds the key: this is that start, which may well have gone out, and its outcome is open until the answer says otherwise
                entry.key = held.key;
                entry.at = held.at;
                entry.open = true;
                entry.sent = true;
                // The words that key said are the store's (none when it holds none: that key is only looked up)
                if (held.payload) entry.payload = held.payload;
                else delete entry.payload;
            }
            // When this process knows no start (a restart, or the first ask here) and the store, which may hold the key of one a restart forgot, did not answer, a new key could make a
            // second job beside it: nothing is sent, and the ask is told as one that could not be checked. A key this process already knows goes on as before
            if (!held && entry.unchecked && (store.expected?.() ?? true)) {
                if (context.startKeys?.get(OPEN_START_SLOT) === entry) context.startKeys.delete(OPEN_START_SLOT);
                return { started: false, unconfirmed: true, note: COULD_NOT_CHECK_NOTE };
            }
        }
        delete entry.unchecked;
        let startKey = entry.key;
        // Where this start is kept once it is settled: under the ask that SENT it (the words it holds), not under whatever is asked now, so the same ask in this turn finds it
        const keptAsked = entry.payload ? askedOf(entry.payload.title, entry.payload.origin) : asked;
        // A start with this key may have gone out BEFORE this call (an earlier ask of this person, here or at another server): whatever this call's own answer is, it says nothing of that one
        let priorSend = entry.sent === true;
        const leave = () => {
            if (context.startKeys?.get(OPEN_START_SLOT) === entry) context.startKeys.delete(OPEN_START_SLOT);
            if (context.startKeys?.get(asked) === entry) context.startKeys.delete(asked);
            if (context.startKeys?.get(keptAsked) === entry) context.startKeys.delete(keptAsked);
        };
        // An ask that went nowhere (Orbit said no before it made anything, or the request itself failed with an answer that is final) is not kept: asking again is a new ask
        // The record goes (only the record of THIS key: a record of another is never deleted) while the entry still stands where the next call finds it, so an overlapping call waits for
        // this one and sees how it ended; the entry leaves its place after
        const dropKey = async () => {
            // Only a record this call stored (the one another server stored for the same key is that server's: its send may be open), and then only while no other server has been given it since:
            // one that was may be sending the same key right now, and the record is what lets the next ask find that start
            if (ownsRecord) await context.startKeyStore?.delete(scope, startKey, { unlessRead: true }).catch(() => undefined);
            leave();
        };
        let looked: StartAnswer | undefined;
        // A start that may already have gone out is looked up by its key BEFORE anything is sent. Orbit says what the job of that key is (live, done, ended), or that it cannot say (nothing
        // is sent: asking again is the same request), or that no job has the key yet (then the SAME key is sent: Orbit makes one job of one key, whatever the title now is)
        if (entry.sent && entry.open && now - entry.at >= OPEN_START_REPORT_MS && !entry.reported) {
            // A start nobody could resolve for an hour: still looked up on every ask, and reported once so a person looks at it (no title, no words of anyone's)
            entry.reported = true;
            try {
                Sentry.captureMessage('A computer start is still unresolved after an hour', { level: 'warning', tags: { area: 'computer-start' } });
            } catch {
                /* a report is never in the way of an ask */
            }
        }
        if (entry.sent && entry.open && context.admin.lookUpComputerStart) {
            const seen = await context.admin.lookUpComputerStart(context.botId, context.userId, { ...(typeof context.isGuest === 'boolean' ? { isGuest: context.isGuest } : {}), startKey });
            if (seen !== 'none') {
                looked = seen as unknown as StartAnswer;
            }
        }
        let sent: StartAnswer | undefined;
        if (!looked) {
            // A key whose words nobody holds (a record that had none) cannot be sent: whatever the person asks now is not what that key stands for. It stays open and is looked up on every ask.
            const firstWords = entry.payload;
            if (!firstWords) return { started: false, unknown: true, note: COULD_NOT_CHECK_NOTE };
            entry.sent = true;
            try {
                // The words of the ask that FIRST sent this key, never the words of this call (when they differ the answer is told as that earlier ask's). They are a parameter, so what is
                // sent is always words that were checked, never a variable that may change or be empty by the time it is read
                const sendWith = async (words: StoredStartPayload, key: string): Promise<StartAnswer> =>
                    (await context.admin.startComputerJob(context.botId, context.userId, { title: words.title, startKey: key, ...(typeof context.isGuest === 'boolean' ? { isGuest: context.isGuest } : {}), ...(words.brief ? { brief: words.brief } : {}), writes: words.writes, ...(words.plan ? { plan: words.plan } : {}), ...(words.origin ? { origin: words.origin } : {}), ...(words.continues ? { continuesJobId: words.continues } : {}) })) as unknown as StartAnswer;
                let said: StoredStartPayload = firstWords;
                sent = await sendWith(said, startKey);
                // Orbit says THIS start's own attempt stopped beating or was let go (`expired`): nothing was made by it, and it may not be revived. The ask starts afresh under a NEW key (the old
                // one is never sent again), at most twice; the key a retried message makes is the same new key, so a replay of the same event still makes one job
                for (let afresh = 1; sent && !sent.ok && sent.reason === 'expired' && afresh <= 2; afresh++) {
                    const old = startKey;
                    startKey = context.inbound && context.confirmations ? startKeyFor(context.botId, context.inbound.roomId, context.inbound.eventId, `${old}.${afresh}`) : randomUUID();
                    entry.key = startKey;
                    entry.at = Date.now();
                    await context.startKeyStore?.delete(scope, old).catch(() => undefined);
                    const store = context.startKeyStore;
                    const held: StoredStartKey | undefined = await store?.claim(scope, { key: startKey, at: entry.at, payload: said }, OPEN_START_KEEP_MS, OPEN_START_KEEP_MS).catch(() => undefined);
                    // A key this call made itself, with no start sent under it yet: its record is this call's to delete when the send fails (the key before it may have gone out, this one has not) ...
                    priorSend = false;
                    // ... unless the store already held that record (another server worked out the same key for the same event and claimed it first)
                    ownsRecord = !(held && held.mine === false);
                    // The shared store is expected and did not confirm the new key: another server may hold a key of this ask that this one cannot see, so nothing is sent (as for the first key).
                    // The new key is checked again on the next ask
                    if (store && !held && (store.expected?.() ?? true)) {
                        entry.unchecked = true;
                        return { started: false, unconfirmed: true, note: COULD_NOT_CHECK_NOTE };
                    }
                    // Another server already holds a key of this ask: that is the one to send (the store's contract), so it is looked up first, and what it said is what goes with it. Two keys must never reach Orbit.
                    // The same goes for a record this call did not store when it holds the very key worked out here (two servers derive the same replacement key for one event): it is that server's start
                    if (held && (held.key !== startKey || held.mine === false)) {
                        // The key (and its record in the shared store) is ANOTHER server's: it may have gone out, and this call never deletes a record it did not make
                        priorSend = true;
                        startKey = held.key;
                        entry.key = held.key;
                        entry.at = held.at;
                        // The words that key said are the store's, set (or cleared) NOW, before anything is looked up: the words of the attempt that expired are not the words of the key adopted
                        if (held.payload) entry.payload = held.payload;
                        else delete entry.payload;
                        const seen = context.admin.lookUpComputerStart ? await context.admin.lookUpComputerStart(context.botId, context.userId, { ...(typeof context.isGuest === 'boolean' ? { isGuest: context.isGuest } : {}), startKey }) : 'none';
                        if (seen !== 'none') {
                            looked = seen as unknown as StartAnswer;
                            sent = undefined;
                            break;
                        }
                        // A key that holds no words cannot be sent: it is only looked up, on every ask
                        if (!held.payload) return { started: false, unknown: true, note: COULD_NOT_CHECK_NOTE };
                        said = held.payload;
                    }
                    sent = await sendWith(said, startKey);
                }
            } catch (error) {
                // Thrown only when the start is known to have made nothing (Orbit's own no, or nothing was sent): this ask is over, and the key goes with it unless a start with it
                // may have gone out before (that one is still open)
                if (!priorSend) await dropKey();
                console.warn('[ComputerTools] Could not start a job:', error instanceof Error ? error.message : error);
                return { started: false, success: false, note: "The computer could not be reached just now. Say so in one plain sentence; you can still chat and use their apps." };
            }
        }
        // Orbit has a job of an earlier start of this person on this Brick that this game never confirmed it saw (a reply lost, then the record of its key gone): nothing was made for this ask.
        // THAT job is what the person is told of, its key is the one kept from now on (no words: it is only looked up), and Orbit is told it was seen, so the next ask is free to start.
        // An older start of the person on this Brick is still going and has made no job yet: nothing is told of a job (there is none), its key is the one kept from now on (no words: it is only looked
        // up on every ask until it has made its job), and nothing is confirmed (there is nothing to confirm)
        if (sent?.earlier && sent.earlier.id === null) {
            const adopted = sent.earlier.attempt;
            if (context.startKeys?.get(keptAsked) === entry) context.startKeys.delete(keptAsked);
            await context.startKeyStore?.delete(scope, startKey).catch(() => undefined);
            entry.key = adopted;
            entry.at = now;
            entry.sent = true;
            entry.open = true;
            delete entry.payload;
            context.startKeys?.set(OPEN_START_SLOT, entry);
            await context.startKeyStore?.claim(scope, { key: adopted, at: now }, OPEN_START_KEEP_MS, OPEN_START_KEEP_MS).catch(() => undefined);
            return { started: false, found: true, earlier: true, note: 'An earlier job of theirs is still being set up, so nothing new was started. Say in one short sentence that the job they asked for earlier is still being set up, and that its state shows in the bar above this chat once it is going. Do not say it has started or is running. If they are asking for something different now, say it was not started and that they can ask for it again once that job is going.' };
        }
        if (sent?.earlier) {
            const found = sent.earlier as { id: string; status: string; attempt: string };
            // What Orbit said is put where every other call of this turn finds it BEFORE anything is awaited: an overlapping call never goes out beside this one
            if (context.startKeys?.get(OPEN_START_SLOT) === entry) context.startKeys.delete(OPEN_START_SLOT);
            if (context.startKeys?.get(keptAsked) === entry) context.startKeys.delete(keptAsked);
            entry.key = found.attempt;
            entry.at = now;
            entry.sent = true;
            entry.open = false;
            entry.found = sent.reason;
            delete entry.payload;
            context.startKeys?.set(asked, entry);
            context.startKeys?.set(FOUND_EARLIER_SLOT, { key: found.attempt, at: now, open: false, found: sent.reason });
            confirmLater(found.attempt, sent.reason === 'starting', { state: stateOf(sent.reason), earlier: true });
            // The record of the key that made nothing goes (that key only, and only if the store still holds it)
            await context.startKeyStore?.delete(scope, startKey).catch(() => undefined);
            return answerOf({ ok: false, reason: sent.reason } as StartAnswer, context, true);
        }
        // A look-up of an earlier send found its job: that is the answer of every call in this turn
        if (looked && ['starting', 'done', 'ended'].includes((looked as unknown as StartAnswer).reason)) {
            context.startKeys?.set(FOUND_EARLIER_SLOT, { key: startKey, at: now, open: false, found: (looked as unknown as StartAnswer).reason, ...(entry.payload?.title ? { title: entry.payload.title } : {}) });
        }
        const started = (looked ?? sent) as StartAnswer;
        // The words that went out are an EARLIER ask's (the resend of a start the game could not settle, while the person asks something else now), and they made a job: that job is what every call
        // of this turn is told, as it is when a look-up finds an earlier job, and nothing else is sent (a second job would be paid for behind it)
        const resentEarlier = looked === undefined && wasOpen && !samePayload(entry.payload, current);
        if (resentEarlier && (started.ok || ['starting', 'done', 'ended'].includes(started.reason))) {
            context.startKeys?.set(FOUND_EARLIER_SLOT, { key: startKey, at: now, open: false, found: started.ok ? 'starting' : started.reason, ...(started.ok ? { made: true as const } : {}), ...(started.ok && started.job.status === 'queued' ? { queued: true as const, queuedFor: started.job.queuedFor } : {}), ...(entry.payload?.title ? { title: entry.payload.title } : {}) });
        }
        const refused = !started.ok && !UNCERTAIN_REASONS.includes(started.reason);
        // A no from Orbit to THIS send (nothing was made by it) ends the key only when no start with it went out before: a start that may have gone out earlier is not answered by it
        if (refused && !priorSend) await dropKey();
        // Only an outcome that is not known, or a job found live, keeps the start open (across turns, with no end short of the safety life, and across a restart: the stored key is deleted
        // when the outcome is settled). An entry that an answer has settled stays settled: a later start of the same ask whose answer is not known does not open it again
        entry.open = entry.open && !started.ok && (OPEN_REASONS.includes(started.reason) || (refused && priorSend));
        if (!entry.open && !refused) {
            // Settled: its key serves this turn's asks of this title, and no other ask
            if (context.startKeys?.get(OPEN_START_SLOT) === entry) {
                context.startKeys.delete(OPEN_START_SLOT);
                context.startKeys.set(keptAsked, entry);
            }
            // The record of its key is NOT deleted here: it stays in the store until the confirmation is sent (below), so a reply that never reaches the person leaves it for the next ask to find
        }
        // Orbit will not carry that job on and MADE NOTHING (GPT's sixth answer, finding 6): the person reads why in Fable's approved words, and nothing is started in its place.
        // Where a new job is a sensible next step, the reply carries a separate "Start a new job" button; its tap is an ordinary new start with a key of its own
        if (!started.ok && started.reason === 'cannot_continue') {
            const named = entry.payload?.title ?? job;
            const said = cannotContinue(started.cannotContinue?.why ?? 'not_continuable', named, started.cannotContinue ?? {});
            if (said.startNewJob && named) context.offerNewJob?.(named);
            const answer = { started: false, success: false, reason: 'cannot_continue' as const };
            if (!context.confirmations) return { ...answer, note: cannotContinueSaid(said.line) };
            context.confirmations.say(said.line);
            return { ...answer, note: CANNOT_CONTINUE_NOTE };
        }
        // Orbit names the job (in the answer to the start, to the look-up inside it, or to this game's own look-up of an earlier send). It is NOT confirmed now: the person has not been told
        // yet. The confirmation waits for this reply to be delivered (`ConfirmationQueue`), and the record of the key goes after it. A look-up never confirms by itself either.
        if (started.ok || ['starting', 'done', 'ended'].includes(started.reason)) {
            const askedEarlier = looked !== undefined || resentEarlier;
            confirmLater(startKey, !started.ok && started.reason === 'starting', { state: started.ok ? (started.job.status === 'queued' ? 'queued' : 'started') : stateOf(started.reason), earlier: !started.ok && askedEarlier, ...(started.ok && started.job.status === 'queued' ? { queuedFor: started.job.queuedFor } : {}), ...(started.ok && started.continued === true ? { continued: true as const } : {}), ...(entry.payload?.title ? { title: entry.payload.title } : {}) });
        }
        // The answer to a look-up of a start sent EARLIER is said as that earlier job's, never as this ask's, and so is the answer of a key that went out before with other words than these
        return answerOf(started, context, looked !== undefined || resentEarlier);
    };
    entry.inflight = go().finally(() => {
        delete entry.inflight;
    });
    return entry.inflight;
}


/** An answer to a start, as one shape (`reason` and `app` when it is a no, `job` and `restoredFrom` when it is a yes). */
type StartAnswer = { ok: boolean; reason: string; queued?: true; app?: string; job: { id: string; status: string; queuedFor: string | null }; restoredFrom: string | null; earlier?: { id: string | null; status: string | null; attempt: string }; /** Orbit carried it on in the old job's conversation ("try again", piece 8). */ continued?: true; /** Orbit will not carry that job on (finding 6): why, and who or what ended it. Nothing was made. */ cannotContinue?: CannotContinue };

/** Whether two starts said the same (title, details, writes, the way Brick weighed, the chat). */
function samePayload(a: StoredStartPayload | undefined, b: StoredStartPayload): boolean {
    return !!a && JSON.stringify([a.title, a.brief ?? null, a.writes ?? null, a.plan?.app ?? null, a.plan?.steps ?? null, a.plan?.appCannot ?? null, a.origin?.kind ?? null, a.origin?.ref ?? null, a.continues ?? null]) === JSON.stringify([b.title, b.brief ?? null, b.writes ?? null, b.plan?.app ?? null, b.plan?.steps ?? null, b.plan?.appCannot ?? null, b.origin?.kind ?? null, b.origin?.ref ?? null, b.continues ?? null]);
}

/** Said with the answer of a job the person asked for earlier: what is asked now may be something else, and the game cannot tell. */
const EARLIER_ASK_NOTE = 'This is the job they asked for earlier. Say in the sentence that it is the job they asked for earlier. If they are asking for something different now, say it was not started and that they can ask for it again once this job is going.';

/**
 * What the model is told of the answer to a start (or to the look-up of one). In a chat where the reply carries the job's fixed status line (a reply with a confirmation queue: the DM), that
 * line IS what tells the person what became of the job, so the model is told NOT to say it too (they would read it twice). Where there is no line (the room chat, a voice call) the notes
 * below tell the model to say it, as they always did.
 */
function answerOf(started: StartAnswer, context: ComputerToolContext, earlier = false): Record<string, unknown> {
    const answer = answerWords(started, context, earlier);
    if (!context.confirmations) return answer;
    const kind = answer.queued === true ? 'queued' : answer.waiting === true ? 'waiting' : answer.found === true ? 'found' : answer.done === true ? 'done' : answer.ended === true ? 'ended' : answer.started === true ? 'started' : null;
    if (!kind) return answer;
    const before = answer.earlier === true;
    const different = before ? ' If they are asking for something different now, say it was not started and that they can ask for it again once that job is over.' : '';
    const which = before ? 'the job they asked for earlier' : 'this job';
    const when = started.ok && started.restoredFrom ? day(started.restoredFrom) : '';
    switch (kind) {
        case 'queued':
            // A job they asked for again that is paused: never a second one; the line asks whether to carry on with it (decisions 23 Nov, 3h)
            if (started.ok && started.job.queuedFor === 'paused') return { ...answer, note: `That job is paused, and nothing new was started. ${LINE_TELLS_THEM} If they say yes, call resume_computer_job.` };
            // A new ask never interrupts the job that is working (decisions 23 Nov, 3c): it waits next in line unless they say it cannot wait
            return { ...answer, note: `${before ? 'The job they asked for earlier' : 'The job'} was queued and has not started. ${LINE_TELLS_THEM}${started.ok && started.job.queuedFor === 'turn' ? ' If it sounds urgent, you may add that they can say "do it first" if it can\'t wait.' : ''}${different}` };
        case 'waiting':
            return { ...answer, note: `The job started and is already waiting for them: it needs something from them before it can go on. A fixed line under your reply says it started: do not say that again. Say in one short sentence that it needs something from them first, and that the bar above this chat shows what. Do not say it is running or will carry on by itself.${different}` };
        case 'found':
            return { ...answer, note: `Orbit found ${which}. ${LINE_TELLS_THEM}${before ? different : ' Do not ask them to ask again.'}` };
        case 'done':
            return { ...answer, note: `Orbit found ${which} and it has finished. ${LINE_TELLS_THEM}${before ? different : ' Do not start it again unless they ask you to.'}` };
        case 'ended':
            return { ...answer, note: `Orbit found ${which} and it has already ended (it failed or was stopped). ${LINE_TELLS_THEM}${before ? different : ' Do not start it again unless they ask you to.'}` };
        default: {
            const running = before ? 'The job they asked for earlier is running.' : started.ok && started.continued ? 'The job is carrying on from where it stopped, in the same conversation on your computer.' : 'The job is running.';
            return {
                ...answer,
                note: when
                    ? `${running} A fixed line under your reply tells them it started: do not say that yourself. Your computer came back from its copy of ${when}: say that in one sentence; anything made after that day is gone, so offer to make it again if it matters.${different}`
                    : `${running} A fixed line under your reply tells them it started: do not say that yourself, and do not say how long it will take.${different}`,
            };
        }
    }
}

/** What a job's fixed status line already says to the person, and so what the model leaves out of its own words. */
const LINE_TELLS_THEM = 'A fixed line under your reply already tells them what became of it, in its own words: do not say that yourself (not that it started, is waiting, was found, finished or ended, nor how it is going or how long it will take), they would read it twice. Say only what else they asked, in a word or two.';

function answerWords(started: StartAnswer, context: ComputerToolContext, earlier = false): Record<string, unknown> {
    if (!started.ok) {
        switch (started.reason) {
            case 'cheaper_route':
                return { started: false, success: false, note: `${started.app ?? 'An app you have'} can do this job: do it through ${started.app ?? 'that app'}. Only if it truly cannot (it has no such action, or the job lives on a website screen), call use_computer again and say why in app_cannot. Say nothing about this to the person unless the app cannot do it either.` };
            case 'starting':
                if (earlier) return { started: false, found: true, earlier: true, note: 'Orbit found the job you asked for earlier, and its state shows in the bar above this chat. Say in one short sentence that the job you asked for earlier was found and its state shows in the bar above this chat. Do not say your computer is starting, that the job has begun, or will begin by itself. Do not say how long it will take. If they are asking for something different now, say it was not started and that they can ask for it again once the earlier job is over.' };
                // The answer was slow and Orbit found THIS job (one for this person, from this chat, with this title, begun since the ask went out), queued,
                // waiting or running. That says the job exists, nothing about the machine: no claim is made that it is starting or has begun, only that Orbit
                // has the job and where its state shows
                return { started: false, found: true, note: 'Orbit found this job. Say in one short sentence that the job was found and that its state shows in the bar above this chat. Do not say your computer is starting, that the job has begun, or will begin by itself. Do not say how long it will take. Do not ask them to ask again.' };
            case 'unknown':
                // Nobody can tell whether THIS job was made (the answer was slow, or the start of an earlier ask was looked up and Orbit could not say). Not a failure (it may be running):
                // the person must not be told it failed, or they ask again and a second job is paid for behind the first. Nothing new is sent while it is open: the same request is used
                return { started: false, unknown: true, note: COULD_NOT_CHECK_NOTE };
            case 'done':
                if (earlier) return { started: false, done: true, earlier: true, note: 'Orbit found the job you asked for earlier and it has finished. Say in one short sentence that the job you asked for earlier finished, and that its result and receipt are with this chat and in [Usage](#usage). Do not say it is running or starting, and do not say this new request finished. If they are asking for something different now, say it was not started and that they can ask for it again in their next message.' };
                // The job of this ask is made and has finished (a start that was asked for again, or a slow one that Orbit found over): its result and its receipt are the ones it has
                return { started: false, done: true, note: 'Orbit found this job and it has finished. Say in one short sentence that your job finished, and that its result and receipt are with this chat and in [Usage](#usage). Do not say it is running or starting, and do not start it again unless they ask you to.' };
            case 'ended':
                if (earlier) return { started: false, ended: true, earlier: true, note: 'Orbit found the job you asked for earlier and it has already ended (it failed or was stopped). Say in one short sentence that the job you asked for earlier has already ended, and that the bar above this chat shows how. Do not say your computer could not be reached or that it is running. If they are asking for something different now, say it was not started and that they can ask for it again in their next message.' };
                // The answer was slow, and Orbit shows that the job THIS start made has already failed or been stopped: it was made, so it is no connection failure
                return { started: false, ended: true, note: 'Orbit found this job and it has already ended (it failed or was stopped). Say in one short sentence that the job was found but has already ended, and that the bar above this chat shows how. Do not say your computer could not be reached or that it is running. Do not start it again unless they ask you to.' };
            case 'off':
                return { started: false, success: false, note: "Your computer is off. Say so in one sentence and that they can give you one from this Brick's page, under Computer. Do not start anything else in its place." };
            case 'broken_start':
                return { started: false, success: false, note: "Your computer isn't starting right now, so this job did not start. Say so in plain words: you can still chat and use their apps, and they can ask again later. Do not promise to tell them when it is back. Do not offer a price or a reason." };
            case 'paused':
                // The team paused computers: nothing is lost, and they can ask again once computers are back (no message is sent for them)
                return { started: false, success: false, note: "Computers are paused for a while, so this job did not start. Say so in one plain sentence: nothing is lost, you can still chat and use their apps, and they can ask again later. Do not promise to tell them when computers are back. Do not offer a price or a reason." };
            case 'not_owner':
            case 'not_open':
            case 'not_set':
                return { started: false, success: false, note: "That can't be done on a computer here right now. Say so in one plain sentence." };
            default:
                return { started: false, success: false, note: 'The job did not start. Say so in one plain sentence.' };
        }
    }
    const { job: made, restoredFrom } = started;
    // A job asked for earlier that this answer made (its start had not gone out, or its look-up found none yet): told as that job, whatever is asked now
    const laterNote = earlier ? ` ${EARLIER_ASK_NOTE}` : '';
    if (made.status === 'queued') {
        if (made.queuedFor === 'paused') {
            return { started: false, queued: true, paused: true, ...(earlier ? { earlier: true } : {}), note: `That job is paused, and nothing new was started. Say in one short sentence that it is paused and ask whether to resume it; if they say yes, call resume_computer_job.${laterNote}` };
        }
        if (made.queuedFor === 'allowance') {
            return { started: false, queued: true, ...(earlier ? { earlier: true } : {}), note: `It is waiting: their computer time for this month is used up. Say so in one sentence, that the work is kept and goes on by itself when more is available, and that they can tap Ask for more in Usage. Never give a number or a price.${laterNote}` };
        }
        if (made.queuedFor === 'turn') {
            return { started: false, queued: true, ...(earlier ? { earlier: true } : {}), note: `It is next in line: your computer does one job at a time. Say so in one line, e.g. "Will do, right after the current job. My computer does one job at a time, so this is next in line."${laterNote}` };
        }
        return { started: false, queued: true, ...(earlier ? { earlier: true } : {}), note: `It waits in line: every computer is busy just now and nothing needs asking for. Say so in one line, and that it starts by itself.${laterNote}` };
    }
    context.onStarted?.(made.id);
    // A job that is already waiting for the person (it needs them before it can go on) is not "running": the person is told it needs them
    if (made.status === 'waiting') {
        return { started: true, waiting: true, ...(earlier ? { earlier: true } : {}), note: `The job started and is already waiting for them: it needs something from them before it can go on. Say in one short sentence that the job needs them, and that the bar above this chat shows what. Do not say it is running or will carry on by itself.${laterNote}` };
    }
    const when = restoredFrom ? day(restoredFrom) : '';
    return {
        started: true,
        ...(earlier ? { earlier: true } : {}),
        note:
            (when
                ? `The job is running. Your computer came back from its copy of ${when}. Say in one sentence that it is working on it and that it came back from that day's copy; anything made after that day is gone, so offer to make it again if it matters. They can Watch or Stop from the bar above.`
                : started.continued
                  ? 'The job is carrying on from where it stopped, in the same conversation on your computer. Say so in one short sentence. They can Watch or Stop from the bar above this chat. Do not say how long it will take.'
                  : 'The job is running. Say in one short sentence what you started. They can Watch or Stop from the bar above this chat. Do not say how long it will take.') + laterNote,
    };
}
