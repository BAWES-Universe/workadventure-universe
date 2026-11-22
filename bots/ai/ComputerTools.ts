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
import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/node';
import type { StartKeyStore } from '../server/ComputerStartKeys';
import type { AdminApiService } from '../server/AdminApiService';

export const COMPUTER_TOOL = 'use_computer';

export function isComputerTool(name: string): boolean {
    return name === COMPUTER_TOOL;
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
    ].join('\n');
}

export interface ComputerToolContext {
    admin: Pick<AdminApiService, 'startComputerJob'> & Partial<Pick<AdminApiService, 'lookUpComputerStart'>>;
    /** The apps this person has connected to this Brick in this reply (their names), so a job an app can do is not started on the computer. */
    apps?: string[];
    botId: string;
    userId: string;
    /** Whether the speaker signed in as a guest, as the chat knows it: sent with the id, so Orbit never has to guess what kind of id it is (an id with an "@" is looked up as an email). */
    isGuest?: boolean;
    /** The direct chat this reply is in: the job is started from it, and its result goes back to it and nowhere else. */
    origin?: { kind: 'dm'; ref: string };
    /** The apps a review in this reply said the computer could do better: a call that names one with how many steps are left is for Orbit to weigh, not sent back to the app. */
    reviewed?: ReadonlySet<string>;
    /** Called once a job is running, so a development server can pretend to do it. */
    onStarted?: (jobId: string) => void;
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
    const job = text(args.job, TITLE_MAX);
    if (!job) return { error: 'Say in a few words what the job is.' };
    const brief = typeof args.details === 'string' ? args.details.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, DETAILS_MAX) : '';
    const fits = appThatFits(job, brief, context.apps);
    const appCannot = text(args.app_cannot, 300);
    const stepsGiven = typeof args.app_steps === 'number' && Number.isInteger(args.app_steps) && args.app_steps >= 1;
    const afterReview = !!fits && stepsGiven && !!context.reviewed && [...context.reviewed].some((app) => plain(app) === plain(fits));
    if (fits && appCannot.length < 8 && !afterReview) {
        return { started: false, success: false, note: `You have ${fits} connected, and this names it: do the job through ${fits} first. Only if it truly cannot (it has no such action, or the job lives on a website screen), call use_computer again and say why in app_cannot. Say nothing about this to the person unless the app cannot do it either.` };
    }
    // The way Brick weighed: Orbit works out which way costs least and says so (no price comes back, and none goes to the model)
    const planned = text(args.app, 120) || fits || '';
    const steps = typeof args.app_steps === 'number' && Number.isInteger(args.app_steps) && args.app_steps >= 1 ? Math.min(args.app_steps, 10000) : undefined;
    const plan = planned ? { app: planned, ...(steps !== undefined ? { steps } : {}), ...(appCannot ? { appCannot } : {}) } : undefined;
    // ONE open start per Brick and person (not per title): while a start is open (sent and its outcome not known, or its job found live) every ask of this person to this Brick is that
    // start (see `startKeys`), whatever its title, and is looked up by its key before anything new is sent. A start that is settled keeps its key for this turn and this title only.
    const asked = askedOf(job, context.origin);
    const scope = `${context.botId}|${context.userId}`;
    const now = Date.now();
    const open = context.startKeys?.get(OPEN_START_SLOT);
    const settled = context.startKeys?.get(asked);
    const earlier = open && now - open.at < OPEN_START_KEEP_MS ? open : settled && !settled.open ? settled : undefined;
    // An ask that is in flight is finished first: the next one then sees how it ended (a start that worked, a start whose outcome is open) and never goes out beside it
    if (earlier?.inflight) {
        await earlier.inflight.catch(() => undefined);
        return runComputerTool(args, context);
    }
    // Open until the answer says otherwise: a start in flight that a new message of the person cleared would be sent again under another key (a second job)
    const entry: StartKeyEntry = earlier ?? { key: randomUUID(), at: now, open: true, unchecked: true };
    // The entry is put where the next call finds it BEFORE anything is awaited
    if (entry.open) context.startKeys?.set(OPEN_START_SLOT, entry);
    else context.startKeys?.set(asked, entry);
    const go = async (): Promise<Record<string, unknown>> => {
        // The FIRST key of the open start wins, across bot servers and restarts: one step in the shared store keeps ours BEFORE the start is sent unless it already holds a key
        // of an open start of this person and Brick, and answers the one it holds (no title in it, no expiry short of the safety life). A restart that forgot the process's
        // memory, a second server, and an ask racing a stored one all go on with THAT key, and look it up first.
        if (context.startKeyStore && entry.open) {
            const store = context.startKeyStore;
            const held = await store.claim(scope, { key: entry.key, at: entry.at }, OPEN_START_KEEP_MS - (now - entry.at), OPEN_START_KEEP_MS).catch(() => undefined);
            if (held && held.key !== entry.key) {
                // Another attempt holds the key: this is that start, which may well have gone out, and its outcome is open until the answer says otherwise
                entry.key = held.key;
                entry.at = held.at;
                entry.open = true;
                entry.sent = true;
            }
            // When this process knows no start (a restart, or the first ask here) and the store, which may hold the key of one a restart forgot, did not answer, a new key could make a
            // second job beside it: nothing is sent, and the ask is told as one that could not be checked. A key this process already knows goes on as before
            if (!held && entry.unchecked && (store.expected?.() ?? true)) {
                if (context.startKeys?.get(OPEN_START_SLOT) === entry) context.startKeys.delete(OPEN_START_SLOT);
                return { started: false, unconfirmed: true, note: COULD_NOT_CHECK_NOTE };
            }
        }
        delete entry.unchecked;
        const startKey = entry.key;
        // A start with this key may have gone out BEFORE this call (an earlier ask of this person, here or at another server): whatever this call's own answer is, it says nothing of that one
        const priorSend = entry.sent === true;
        const leave = () => {
            if (context.startKeys?.get(OPEN_START_SLOT) === entry) context.startKeys.delete(OPEN_START_SLOT);
            if (context.startKeys?.get(asked) === entry) context.startKeys.delete(asked);
        };
        // An ask that went nowhere (Orbit said no before it made anything, or the request itself failed with an answer that is final) is not kept: asking again is a new ask
        const dropKey = async () => {
            leave();
            await context.startKeyStore?.delete(scope, startKey).catch(() => undefined);
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
            entry.sent = true;
            try {
                sent = (await context.admin.startComputerJob(context.botId, context.userId, { title: job, startKey, ...(typeof context.isGuest === 'boolean' ? { isGuest: context.isGuest } : {}), ...(brief ? { brief } : {}), writes: args.reads_only === true ? false : undefined, ...(plan ? { plan } : {}), ...(context.origin ? { origin: context.origin } : {}) })) as unknown as StartAnswer;
            } catch (error) {
                // Thrown only when the start is known to have made nothing (Orbit's own no, or nothing was sent): this ask is over, and the key goes with it unless a start with it
                // may have gone out before (that one is still open)
                if (!priorSend) await dropKey();
                console.warn('[ComputerTools] Could not start a job:', error instanceof Error ? error.message : error);
                return { started: false, success: false, note: "The computer could not be reached just now. Say so in one plain sentence; you can still chat and use their apps." };
            }
        }
        const started = (looked ?? sent) as StartAnswer;
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
                context.startKeys.set(asked, entry);
            }
            await context.startKeyStore?.delete(scope, startKey).catch(() => undefined);
        }
        // The answer to a look-up of a start sent EARLIER is said as that earlier job's, never as this ask's: the game cannot tell a reworded ask from a different one
        return answerOf(started, context, looked !== undefined);
    };
    entry.inflight = go().finally(() => {
        delete entry.inflight;
    });
    return entry.inflight;
}


/** An answer to a start, as one shape (`reason` and `app` when it is a no, `job` and `restoredFrom` when it is a yes). */
type StartAnswer = { ok: boolean; reason: string; app?: string; job: { id: string; status: string; queuedFor: string | null }; restoredFrom: string | null };

/** What the model is told of the answer to a start (or to the look-up of one). */
function answerOf(started: StartAnswer, context: ComputerToolContext, earlier = false): Record<string, unknown> {
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
    if (made.status === 'queued') {
        if (made.queuedFor === 'allowance') {
            return { started: false, queued: true, note: "It is waiting: their computer time for this month is used up. Say so in one sentence, that the work is kept and goes on by itself when more is available, and that they can tap Ask for more in Usage. Never give a number or a price." };
        }
        if (made.queuedFor === 'turn') {
            return { started: false, queued: true, note: 'It is next in line: your computer does one job at a time. Say so in one line, e.g. "Will do, right after the current job. My computer does one job at a time, so this is next in line."' };
        }
        return { started: false, queued: true, note: 'It waits in line: every computer is busy just now and nothing needs asking for. Say so in one line, and that it starts by itself.' };
    }
    context.onStarted?.(made.id);
    // A job that is already waiting for the person (it needs them before it can go on) is not "running": the person is told it needs them
    if (made.status === 'waiting') {
        return { started: true, waiting: true, note: 'The job started and is already waiting for them: it needs something from them before it can go on. Say in one short sentence that the job needs them, and that the bar above this chat shows what. Do not say it is running or will carry on by itself.' };
    }
    const when = restoredFrom ? day(restoredFrom) : '';
    return {
        started: true,
        note:
            when
                ? `The job is running. Your computer came back from its copy of ${when}. Say in one sentence that it is working on it and that it came back from that day's copy; anything made after that day is gone, so offer to make it again if it matters. They can Watch or Stop from the bar above.`
                : 'The job is running. Say in one short sentence what you started. They can Watch or Stop from the bar above this chat. Do not say how long it will take.',
    };
}
