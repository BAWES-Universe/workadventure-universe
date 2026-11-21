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
    admin: Pick<AdminApiService, 'startComputerJob'>;
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
     * The start keys of the chat's asks (kept by the chat, per Brick and person), by chat and title. The same ask again (a reply written again, a tool call retried, the person
     * asking again while the first is not known to have started or is starting) sends the key of the first, so Orbit answers with the job the first made and never makes a
     * second. An ask whose outcome is not known (`unknown`) or whose job was found live (`starting`) keeps its key for ten minutes, across turns; one that is settled
     * (a start that worked, a job that ended or finished) keeps it for the turn only, and a new message from the person starts that clean (`forgetSettledStarts`). A different
     * title, or another chat, has a key of its own. Without it every ask has a key of its own.
     */
    startKeys?: Map<string, StartKeyEntry>;
}

/** A start key of an ask, when it was first sent, and whether the outcome of that ask is still open (`unknown`, `starting`). */
export interface StartKeyEntry {
    key: string;
    at: number;
    open: boolean;
}

/** How long the key of an ask whose outcome is open is sent again for the same ask: long enough for a person to ask again, short enough that a new job is a new job. */
export const START_KEY_KEEP_MS = 10 * 60_000;

/** What was asked, as one string: the same title in the same chat is the same ask (the details a model words differently when it asks again do not make a second job). */
const askedOf = (job: string, origin: { kind: 'dm'; ref: string } | undefined): string => JSON.stringify([origin?.kind ?? null, origin?.ref ?? null, job.toLowerCase()]);

/** At a new message from the person: the keys of asks that are settled, or older than their keep, are forgotten; those whose outcome is open stay for their ten minutes. */
export function forgetSettledStarts(starts: Map<string, StartKeyEntry> | undefined, now = Date.now()): void {
    if (!starts) return;
    for (const [asked, entry] of starts) if (!entry.open || now - entry.at >= START_KEY_KEEP_MS) starts.delete(asked);
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
    // The key of this ask: the one an earlier ask of the same title in this chat sent while its outcome is open (or in this turn), else a new one (see `startKeys`)
    const asked = askedOf(job, context.origin);
    const now = Date.now();
    const earlier = context.startKeys?.get(asked);
    const entry: StartKeyEntry = earlier && now - earlier.at < START_KEY_KEEP_MS ? earlier : { key: randomUUID(), at: now, open: false };
    const startKey = entry.key;
    context.startKeys?.set(asked, entry);
    // An ask that went nowhere (Orbit said no before it made anything, or the request itself failed with an answer that is final) is not kept: asking again is a new ask
    const dropKey = () => {
        if (context.startKeys?.get(asked) === entry) context.startKeys.delete(asked);
    };
    let started;
    try {
        started = await context.admin.startComputerJob(context.botId, context.userId, { title: job, startKey, ...(typeof context.isGuest === 'boolean' ? { isGuest: context.isGuest } : {}), ...(brief ? { brief } : {}), writes: args.reads_only === true ? false : undefined, ...(plan ? { plan } : {}), ...(context.origin ? { origin: context.origin } : {}) });
    } catch (error) {
        // Thrown only when the start is known to have made nothing (Orbit's own no, or nothing was sent): the ask is over
        dropKey();
        console.warn('[ComputerTools] Could not start a job:', error instanceof Error ? error.message : error);
        return { started: false, success: false, note: "The computer could not be reached just now. Say so in one plain sentence; you can still chat and use their apps." };
    }
    if (!started.ok && !UNCERTAIN_REASONS.includes(started.reason)) dropKey();
    // Only an outcome that is not known, or a job found live, keeps its key across turns
    entry.open = !started.ok && OPEN_REASONS.includes(started.reason);
    if (!started.ok) {
        switch (started.reason) {
            case 'cheaper_route':
                return { started: false, success: false, note: `${started.app ?? 'An app you have'} can do this job: do it through ${started.app ?? 'that app'}. Only if it truly cannot (it has no such action, or the job lives on a website screen), call use_computer again and say why in app_cannot. Say nothing about this to the person unless the app cannot do it either.` };
            case 'starting':
                // The answer was slow and Orbit found THIS job (one for this person, from this chat, with this title, begun since the ask went out), queued,
                // waiting or running. That says the job exists, nothing about the machine: no claim is made that it is starting or has begun, only that Orbit
                // has the job and where its state shows
                return { started: false, found: true, note: 'Orbit found this job. Say in one short sentence that the job was found and that its state shows in the bar above this chat. Do not say your computer is starting, that the job has begun, or will begin by itself. Do not say how long it will take. Do not ask them to ask again.' };
            case 'unknown':
                // The answer was slow and nobody can tell whether THIS job was made. Not a failure (it may be running): the person must not be told it failed,
                // or they ask again and a second job is paid for behind the first
                return { started: false, unknown: true, note: 'It is not known whether this job started. Say in one short sentence that you couldn\'t confirm it, and ask them to look at the bar above this chat before asking again. Do not say it failed or that it started.' };
            case 'done':
                // The job of this ask is made and has finished (a start that was asked for again, or a slow one that Orbit found over): its result and its receipt are the ones it has
                return { started: false, done: true, note: 'Orbit found this job and it has finished. Say in one short sentence that your job finished, and that its result and receipt are with this chat and in [Usage](#usage). Do not say it is running or starting, and do not start it again unless they ask you to.' };
            case 'ended':
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
    const when = restoredFrom ? day(restoredFrom) : '';
    return {
        started: true,
        note:
            when
                ? `The job is running. Your computer came back from its copy of ${when}. Say in one sentence that it is working on it and that it came back from that day's copy; anything made after that day is gone, so offer to make it again if it matters. They can Watch or Stop from the bar above.`
                : 'The job is running. Say in one short sentence what you started. They can Watch or Stop from the bar above this chat. Do not say how long it will take.',
    };
}
