/**
 * Brick's controls of its own computer jobs, from its owner's chat (computers full plan, piece 5).
 *
 * `use_computer` starts a job; these act on the jobs that are there: see them and how each is going, pause one, carry on with a paused one, do one first (pausing the running one so it
 * carries on by itself after) or next, cancel one, stop everything, and pass the person's words on to a job (a change, or the answer to its question). Every one goes through Orbit's door
 * for Brick (`POST /api/bots/:id/computer-jobs/control`), which checks the owner and the job exactly as a start does; nothing here decides money or state.
 *
 * The rules this file keeps (decisions of 23 Nov, `computers-full-plan-23-nov/decisions-pause-stop-23-nov.md`):
 *  - Pause and resume act at once (they can be undone) and name the job.
 *  - Cancel and Stop ALWAYS ask first, and offer Pause. The question goes under the reply as a fixed line; only the person's NEXT message can answer it, and only once that question was
 *    delivered to them. Calling the tool again in the same reply, or in a reply asked again, only repeats the question. Nothing ends until then.
 *  - What the person reads about a control is a fixed line (`ComputerControlWords`) built from what Orbit really answered, appended in the same event as the job status lines.
 *  - A job named by words is found among the jobs Orbit lists; two that fit are never guessed between: Brick asks which, naming them.
 *  - The same control in one turn (a reply asked again, a tool call retried) goes to Orbit once: a message is never passed on twice.
 *  - An answer that did not come back whole is never told as done or as failed, and is not sent again.
 *  - No price, no count of time, no machine reaches the model or the chat.
 */
import type { ComputerControlAnswer, ComputerControlAsk, ComputerControlJob, ComputerControlView, AdminApiService } from '../server/AdminApiService';
import type { ConfirmationQueue } from './ComputerTools';
import { CONTROL_REFUSALS, CONTROL_WORDS, lineOf, quotedTitles } from './ComputerControlWords';

export const COMPUTER_JOBS_TOOL = 'computer_jobs';
export const PAUSE_JOB_TOOL = 'pause_computer_job';
export const RESUME_JOB_TOOL = 'resume_computer_job';
export const JOB_FIRST_TOOL = 'computer_job_first';
export const CANCEL_JOB_TOOL = 'cancel_computer_job';
export const STOP_COMPUTER_TOOL = 'stop_computer';
export const TELL_JOB_TOOL = 'tell_computer_job';

export const COMPUTER_CONTROL_TOOLS = [COMPUTER_JOBS_TOOL, PAUSE_JOB_TOOL, RESUME_JOB_TOOL, JOB_FIRST_TOOL, CANCEL_JOB_TOOL, STOP_COMPUTER_TOOL, TELL_JOB_TOOL] as const;
export type ComputerControlTool = (typeof COMPUTER_CONTROL_TOOLS)[number];

export function isComputerControlTool(name: string): name is ComputerControlTool {
    return (COMPUTER_CONTROL_TOOLS as readonly string[]).includes(name);
}

/** A message for a job is cut to what Orbit keeps of one (its column). */
const NOTE_MAX = 4000;
const JOB_WORDS_MAX = 200;

const JOB_ARG = { type: 'string', description: 'Which job, in the person\'s words or as the bar shows it ("visa", "Taxi booking"), or its id from computer_jobs. Leave out when there is only one that fits.' };

export function computerControlToolDefinitions(): { type: 'function'; function: { name: string; description: string; parameters: object } }[] {
    const tool = (name: string, description: string, properties: Record<string, object> = {}, required: string[] = []) => ({
        type: 'function' as const,
        function: { name, description, parameters: { type: 'object', properties, ...(required.length ? { required } : {}) } },
    });
    return [
        tool(COMPUTER_JOBS_TOOL, 'See the jobs on your computer and how each is going: the one working and its step, what needs them, what is waiting in line, what is paused. Use it when they ask how a job is going or what is on your computer. Name a job to also get the steps it took so far.', { job: JOB_ARG }),
        tool(PAUSE_JOB_TOOL, 'Pause a job on your computer: it keeps its progress and sign-ins, costs nothing while it waits, and carries on from where it was when they say resume. Use it when they ask you to pause, hold or stop a job "for now". It acts at once: do not ask first.', { job: JOB_ARG }),
        tool(RESUME_JOB_TOOL, 'Carry on with a paused job, from where it stopped. It acts at once: do not ask first.', { job: JOB_ARG }),
        tool(
            JOB_FIRST_TOOL,
            'Put a waiting job first. With pause_running, do it now: the job that is working pauses, this one starts, and the paused one carries on by itself right after. Use pause_running only when they say it cannot wait ("do this first", "do it now"); a new ask never interrupts the running job on its own. For a job they have not asked for yet, start it with use_computer first, then call this.',
            { job: JOB_ARG, pause_running: { type: 'boolean', description: 'True when they want it done now, before the job that is working (that one pauses and carries on by itself after).' } },
            ['job']
        ),
        tool(CANCEL_JOB_TOOL, 'Cancel one job: it ends and cannot be resumed; its files are kept, and the others carry on. It always asks them first, with a line under your reply: call it when they ask to cancel or end one job, and again when they say yes in their next message. Never cancel to "pause"; never in the same reply as the question.', { job: JOB_ARG }),
        tool(STOP_COMPUTER_TOOL, 'Stop everything on your computer: every job ends, paused ones too, and their files are kept. It always asks them first, with a line under your reply: call it when they ask to stop everything, and again when they say yes in their next message. For one job use cancel_computer_job.'),
        tool(
            TELL_JOB_TOOL,
            "Pass the person's words on to a job: a change to a job that is working (\"use 12 March instead\", \"skip the hotel\"), or their answer when a job is waiting for their answer. It reaches the job at once and it carries on with it. Decide from their words whether it is a change to a job or a new job; if you truly cannot tell, ask one short question first. Never pass something on silently: this tool says it under your reply.",
            {
                job: JOB_ARG,
                message: { type: 'string', description: "What to tell the job, in the person's own words with what the job needs to act on it." },
            },
            ['message']
        ),
    ];
}

/** What a Brick with a computer is told about its controls (with `computerToolsNote`). */
export function computerControlNote(): string {
    return [
        'You can also run the jobs on your computer for them: computer_jobs (what is there and how it is going), pause_computer_job, resume_computer_job, computer_job_first, cancel_computer_job, stop_computer, tell_computer_job.',
        'When a job is working and they say something about it (a change, or the answer to its question), pass it on with tell_computer_job; when it is a new thing, start a new job. A new job waits behind the one working unless they say it cannot wait (then computer_job_first with pause_running).',
        'Pause and resume act at once. Cancel and stop always ask them first: the tool puts the question under your reply, and only their next message can say yes.',
        'Under your reply a fixed line says what each control did. Do not say it again in your own words.',
    ].join('\n');
}

/** The question Brick asked before ending something, kept until the person's next message (see `startControlTurn`). */
interface ControlAsk {
    kind: 'cancel' | 'stop';
    /** The job a cancel is for; for Stop, every job that would end, as they were when it was asked. */
    jobIds: string[];
    /** The question reached the person (the reply that carries it was delivered). */
    told: boolean;
    /** A message of the person's came after it was told: this turn may answer it. */
    answerable: boolean;
}

/** The controls of one person and Brick in this chat (kept in the chat's memory, runtime only). */
export interface ControlState {
    asks: Map<string, ControlAsk>;
    /** This turn's controls that went to Orbit, by what they asked, with the line they said: the same again in this turn sends nothing and says the same. */
    calls: Map<string, Promise<{ result: Record<string, unknown>; lines: string[] }>>;
    /** Controls of one chat run one after another, never beside each other. */
    chain: Promise<unknown>;
}

export function newControlState(): ControlState {
    return { asks: new Map(), calls: new Map(), chain: Promise.resolve() };
}

/**
 * A new message from the person (not a reply asked again): a question that was delivered now has its answer in this message, and only in this one; a question that was never delivered
 * was never asked and goes; this turn's controls start clean.
 */
export function startControlTurn(state: ControlState | undefined): void {
    if (!state) return;
    for (const [key, ask] of state.asks) {
        if (!ask.told || ask.answerable) state.asks.delete(key);
        else ask.answerable = true;
    }
    state.calls.clear();
}

export interface ComputerControlContext {
    admin: Pick<AdminApiService, 'controlComputerJobs'>;
    botId: string;
    userId: string;
    isGuest?: boolean;
    state: ControlState;
    /** Where this reply's fixed lines go (the DM). Without it the model is given the line to say. */
    confirmations?: ConfirmationQueue;
}

const clean = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** A message keeps its lines (an address, a list): only control characters go. */
const cleanMessage = (value: unknown): string => (typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, NOTE_MAX) : '');
const plain = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const isPaused = (job: ComputerControlJob): boolean => job.status === 'queued' && job.queuedFor === 'paused';
/** A job that has had the computer at some point: cancelling it ends work that ran (a queued job that was never started used nothing). */
const hasStarted = (job: ComputerControlJob): boolean => job.status !== 'queued' || isPaused(job);

/** Every job on the computer: the one that has it, then the line in its order. */
const jobsOf = (view: ComputerControlView): ComputerControlJob[] => [...(view.job ? [view.job] : []), ...view.queued.filter((job) => job.id !== view.job?.id)];

type Found = { job: ComputerControlJob } | { none: true } | { which: ComputerControlJob[] };

/**
 * The job the person named, among `jobs`: its id, the same title, a title their words are in (or that is in their words), or the most words in common. None or several that fit
 * equally is said as such, never guessed. With no words, the only job of `fallback` (or of `jobs`) is the one.
 */
export function findJob(words: string, jobs: ComputerControlJob[], fallback: ComputerControlJob[] = jobs): Found {
    if (!words) {
        if (fallback.length === 1) return { job: fallback[0] };
        return fallback.length ? { which: fallback } : jobs.length === 1 ? { job: jobs[0] } : jobs.length ? { which: jobs } : { none: true };
    }
    const byId = jobs.find((job) => job.id === words);
    if (byId) return { job: byId };
    const asked = plain(words);
    const pick = (fits: ComputerControlJob[]): Found | null => (fits.length === 1 ? { job: fits[0] } : fits.length > 1 ? { which: fits } : null);
    const same = pick(jobs.filter((job) => plain(job.title) === asked));
    if (same) return same;
    const within = pick(jobs.filter((job) => plain(job.title) && (plain(job.title).includes(asked) || asked.includes(plain(job.title)))));
    if (within) return within;
    // Words in common (whole words of three letters or more; "job" and the like say nothing)
    const askedWords = new Set(asked.split(' ').filter((word) => word.length >= 3 && !COMMON.has(word)));
    let best = 0;
    let fits: ComputerControlJob[] = [];
    for (const job of jobs) {
        const shared = new Set(plain(job.title).split(' ').filter((word) => askedWords.has(word) || askedWords.has(word.replace(/s$/, '')) || askedWords.has(`${word}s`))).size;
        if (shared > best) {
            best = shared;
            fits = [job];
        } else if (shared === best && shared > 0) fits.push(job);
    }
    return pick(fits) ?? { none: true };
}
const COMMON = new Set(['the', 'job', 'jobs', 'one', 'that', 'this', 'for', 'and', 'with', 'computer', 'task', 'please', 'form', 'website']);

/** How a job stands, in plain words for the model to put in its own (never a price, a count of time or a machine). */
function standingOf(job: ComputerControlJob, view: ComputerControlView): string {
    if (job.status === 'running') return job.control === 'person' ? 'they have its screen' : 'working';
    if (job.status === 'waiting') return job.control === 'person' ? 'they have its screen' : `waiting for them${job.waitingFor ? ` (${WAITING_WORDS[job.waitingFor] ?? 'their step'})` : ''}`;
    if (isPaused(job)) return job.pausedWhy === 'allowance' ? "paused: this month's computer time is used up" : job.pausedWhy === 'rule' ? 'paused: it reached the spending limit they set' : 'paused by them';
    const first = view.queued.find((other) => !isPaused(other));
    if (job.queuedFor === 'allowance') return "waiting: this month's computer time is used up";
    if (job.queuedFor === 'busy' || job.queuedFor === 'pool') return 'waiting for a free computer';
    return first?.id === job.id ? 'next in line' : 'in line';
}
const WAITING_WORDS: Record<string, string> = { details: 'their details', signin: 'a sign-in', upload: 'a file', pay: 'paying', submit: 'sending it off', answer: 'their answer to its question' };

/** One job as the model is told it. */
function shownJob(job: ComputerControlJob, view: ComputerControlView): Record<string, unknown> {
    return {
        id: job.id,
        title: job.title || 'untitled job',
        state: standingOf(job, view),
        ...(job.stepLabel && (job.status === 'running' || job.status === 'waiting' || isPaused(job)) ? { step: job.stepLabel } : {}),
        ...(job.stepDone !== null && job.stepTotal !== null && job.stepTotal > 0 ? { progress: `step ${Math.min(job.stepDone, job.stepTotal)} of ${job.stepTotal}` } : {}),
    };
}

/** What the model is told with a fixed line: the line is under the reply, so it does not say it again. Without a place for lines (not a DM), it says the line itself. */
const LINE_SAID = 'A fixed line under your reply already tells them this, in its own words: do not say it again. Say only what else they asked, in a word or two, or nothing.';

/**
 * Runs one of Brick's controls. Never throws: the model is told in plain words what happened, and the person reads the fixed line. Controls of one chat run one after another.
 */
export function runComputerControlTool(name: string, args: Record<string, unknown>, context: ComputerControlContext): Promise<Record<string, unknown>> {
    const run = context.state.chain.then(
        () => control(name, args, context),
        () => control(name, args, context)
    );
    context.state.chain = run.catch(() => undefined);
    return run.catch((error) => {
        console.warn('[ComputerControlTools] A control failed:', error instanceof Error ? error.message : error);
        return say(context, [CONTROL_REFUSALS.couldNot], { done: false });
    });
}

/** Puts the lines under the reply (or gives them to the model to say), and the model's note. `onTold` runs once the reply that carries them was delivered. */
function say(context: ComputerControlContext, lines: string[], result: Record<string, unknown>, onTold?: () => void): Record<string, unknown> {
    if (context.confirmations) {
        lines.forEach((line, at) => context.confirmations!.say(line, at === lines.length - 1 ? onTold : undefined));
        return { ...result, note: LINE_SAID };
    }
    onTold?.();
    return { ...result, note: `Say this to them in their language, in these words, and nothing more about it: "${lines.join(' ')}"` };
}

async function control(name: string, args: Record<string, unknown>, context: ComputerControlContext): Promise<Record<string, unknown>> {
    if (!isComputerControlTool(name)) return { error: 'Unknown tool.' };
    const door = (ask: Omit<ComputerControlAsk, 'isGuest'>): Promise<ComputerControlAnswer> =>
        context.admin.controlComputerJobs(context.botId, context.userId, { ...ask, ...(typeof context.isGuest === 'boolean' ? { isGuest: context.isGuest } : {}) });
    const listed = await door({ action: 'list' });
    if (!listed.ok || !listed.view) {
        if (name === COMPUTER_JOBS_TOOL) return { success: false, note: "Their jobs could not be read just now. Say so in one plain sentence, and that the bar above this chat shows them." };
        return say(context, [CONTROL_REFUSALS.couldNot], { done: false, success: false });
    }
    const view = listed.view;
    const jobs = jobsOf(view);
    const words = clean(args.job, JOB_WORDS_MAX);

    if (name === COMPUTER_JOBS_TOOL) return seeJobs(words, view, jobs, door);
    if (name === STOP_COMPUTER_TOOL) return stopAll(view, jobs, context, door);
    if (!jobs.length) return say(context, [CONTROL_REFUSALS.noJobs], { done: false, success: false });

    // Which job: with no words, the one the control is for when only one fits (the working one for a pause or a message, the paused one to carry on, ...)
    const fallback =
        name === PAUSE_JOB_TOOL || name === TELL_JOB_TOOL
            ? view.job
                ? [view.job]
                : jobs
            : name === RESUME_JOB_TOOL
              ? jobs.filter(isPaused)
              : name === JOB_FIRST_TOOL
                ? view.queued
                : jobs;
    const found = findJob(words, jobs, fallback);
    if ('none' in found) return say(context, [CONTROL_REFUSALS.noSuchJob(quotedTitles(jobs.map((job) => job.title)))], { done: false, success: false });
    if ('which' in found) return say(context, [CONTROL_REFUSALS.whichJob(quotedTitles(found.which.map((job) => job.title)))], { done: false, asked: 'which' });
    const job = found.job;

    switch (name) {
        case PAUSE_JOB_TOOL:
            if (isPaused(job)) return say(context, [lineOf(CONTROL_REFUSALS.alreadyPaused, job.title)], { done: false });
            return once(context, `pause|${job.id}`, async () => {
                const answer = await door({ action: 'pause', jobId: job.id });
                if (!answer.ok) return refused(reasonOf(answer), job, view);
                const lost = answer.signInsKept === false;
                return { result: { done: true }, lines: [lineOf(lost ? CONTROL_WORDS.pausedSignInLost : CONTROL_WORDS.paused, job.title)] };
            });
        case RESUME_JOB_TOOL:
            if (!isPaused(job)) return say(context, [lineOf(CONTROL_REFUSALS.notPaused, job.title)], { done: false });
            return once(context, `resume|${job.id}`, async () => {
                const answer = await door({ action: 'resume', jobId: job.id });
                if (!answer.ok) return refused(reasonOf(answer), job, view);
                return { result: { done: true }, lines: [resumedLine(job, answer.view)] };
            });
        case JOB_FIRST_TOOL: {
            const pauseRunning = args.pause_running === true;
            if (view.job?.id === job.id) return say(context, [lineOf(CONTROL_REFUSALS.alreadyRunning, job.title)], { done: false });
            // The one that has the computer now: paused by "do this first", it carries on by itself after
            const running = pauseRunning ? view.job : null;
            return once(context, `first|${job.id}|${pauseRunning}`, async () => {
                const answer = await door({ action: 'first', jobId: job.id, ...(running ? { pauseRunning: true } : {}) });
                if (!answer.ok) return refused(reasonOf(answer), running && reasonOf(answer) === 'taken_over' ? running : job, view);
                const nowHas = answer.view?.job?.id === job.id;
                // The mock's two lines: what has the computer now, then the job that was working, paused, which carries on by itself right after
                if (running) return { result: { done: true }, lines: [lineOf(nowHas || !answer.view ? CONTROL_WORDS.firstStarted : CONTROL_WORDS.firstNext, job.title), lineOf(CONTROL_WORDS.firstPausedOther, running.title)] };
                if (nowHas) return { result: { done: true }, lines: [lineOf(CONTROL_WORDS.firstStarted, job.title)] };
                // First on a paused job carries it on (Orbit's rule): said as a resume
                if (isPaused(job)) return { result: { done: true }, lines: [resumedLine(job, answer.view)] };
                return { result: { done: true }, lines: [lineOf(CONTROL_WORDS.movedNext, job.title)] };
            });
        }
        case CANCEL_JOB_TOOL: {
            const key = `cancel|${job.id}`;
            const ask = context.state.asks.get(key);
            if (!ask || !ask.told || !ask.answerable) return askFirst(context, key, { kind: 'cancel', jobIds: [job.id] }, [lineOf(hasStarted(job) ? CONTROL_WORDS.askCancelStarted : CONTROL_WORDS.askCancelQueued, job.title)]);
            context.state.asks.delete(key);
            return once(context, key, async () => {
                const answer = await door({ action: 'cancel', jobId: job.id });
                if (!answer.ok) return refused(reasonOf(answer), job, view);
                return { result: { done: true }, lines: [lineOf(hasStarted(job) ? CONTROL_WORDS.cancelled : CONTROL_WORDS.cancelledQueued, job.title)] };
            });
        }
        case TELL_JOB_TOOL: {
            const message = cleanMessage(args.message);
            if (!message) return { error: 'Say what to tell the job.' };
            return once(context, `note|${job.id}|${message}`, async () => {
                const answer = await door({ action: 'note', jobId: job.id, text: message });
                if (!answer.ok) return refused(reasonOf(answer), job, view);
                return { result: { done: true }, lines: [toldLine(job, answer.delivery)] };
            });
        }
        default:
            return { error: 'Unknown tool.' };
    }
}

/** What the person is told after "carry on", from where the job is now. */
function resumedLine(job: ComputerControlJob, after: ComputerControlView | null): string {
    const now = after ? jobsOf(after).find((one) => one.id === job.id) : undefined;
    if (!after || after.job?.id === job.id || !now) return lineOf(CONTROL_WORDS.resumedNow, job.title);
    if (isPaused(now) && now.pausedWhy === 'allowance') return lineOf(CONTROL_WORDS.stillPausedAllowance, job.title);
    if (isPaused(now) && now.pausedWhy === 'rule') return lineOf(CONTROL_WORDS.stillPausedRule, job.title);
    if (now.queuedFor === 'allowance') return lineOf(CONTROL_WORDS.stillPausedAllowance, job.title);
    if (now.queuedFor === 'busy' || now.queuedFor === 'pool') return lineOf(CONTROL_WORDS.resumedWaiting, job.title);
    return lineOf(CONTROL_WORDS.resumedNext, job.title);
}

/**
 * What the person is told after their words went to a job: by how Orbit says it delivered them (`now`, `answer`, `after_hand_back`, `when_it_starts`), and from where the job was when Orbit
 * did not say.
 */
function toldLine(job: ComputerControlJob, delivery: string | undefined): string {
    const how = delivery ?? (job.control === 'person' ? 'after_hand_back' : job.status === 'waiting' && job.waitingFor === 'answer' ? 'answer' : job.status === 'running' || job.status === 'waiting' ? 'now' : 'when_it_starts');
    switch (how) {
        case 'answer':
            return lineOf(CONTROL_WORDS.toldAnswer, job.title);
        case 'after_hand_back':
            return lineOf(CONTROL_WORDS.toldAfterHandBack, job.title);
        case 'when_it_starts':
            return lineOf(CONTROL_WORDS.toldWhenItStarts, job.title);
        default:
            return lineOf(CONTROL_WORDS.toldRunning, job.title);
    }
}

/** Orbit said no: what Brick says, by its reason. Nothing changed. `unknown` (no whole answer) is never said as done or as failed. */
function refused(reason: string, job: ComputerControlJob, view: ComputerControlView): { result: Record<string, unknown>; lines: string[] } {
    const no = (line: string, extra: Record<string, unknown> = {}) => ({ result: { done: false, success: false, reason, ...extra }, lines: [line] });
    switch (reason) {
        case 'taken_over':
            return no(CONTROL_REFUSALS.takenOver);
        case 'ending':
            return no(lineOf(CONTROL_REFUSALS.ending, job.title));
        case 'over':
            return no(lineOf(CONTROL_REFUSALS.over, job.title));
        case 'not_paused':
            return no(lineOf(CONTROL_REFUSALS.notPaused, job.title));
        // Resume while the month's time is used up, or over a limit they set: it stays paused, and says why (decisions 23 Nov, 1)
        case 'allowance':
            return no(lineOf(CONTROL_WORDS.stillPausedAllowance, job.title));
        case 'rule':
            return no(lineOf(CONTROL_WORDS.stillPausedRule, job.title));
        case 'not_queued':
            return no(view.job?.id === job.id ? lineOf(CONTROL_REFUSALS.alreadyRunning, job.title) : lineOf(CONTROL_REFUSALS.over, job.title));
        case 'not_found':
            return no(CONTROL_REFUSALS.noSuchJob(quotedTitles(jobsOf(view).filter((one) => one.id !== job.id).map((one) => one.title))));
        case 'unknown':
            // Not a failure: it may have happened. Not success either
            return { result: { done: false, unknown: true }, lines: [CONTROL_REFUSALS.unknown] };
        default:
            return no(CONTROL_REFUSALS.couldNot);
    }
}

/**
 * One control in this turn: the same again (a reply asked again, a call retried) sends nothing and says the same. A control whose answer did not come back whole is kept too: it is
 * never sent a second time in the turn.
 */
async function once(context: ComputerControlContext, key: string, act: () => Promise<{ result: Record<string, unknown>; lines: string[] }>): Promise<Record<string, unknown>> {
    let call = context.state.calls.get(key);
    if (!call) {
        call = act();
        context.state.calls.set(key, call);
        // A request that broke before it was sent made no change: it may be tried again
        call.catch(() => context.state.calls.delete(key));
    }
    const { result, lines } = await call;
    return say(context, lines, result);
}

/** Cancel and Stop ask first: the question goes under the reply, and counts as asked only once that reply was delivered. */
function askFirst(context: ComputerControlContext, key: string, ask: Pick<ControlAsk, 'kind' | 'jobIds'>, lines: string[]): Record<string, unknown> {
    const kept = context.state.asks.get(key);
    // The same question again in this turn (or a reply asked again) is the same question: it is not answered by it
    const entry: ControlAsk = kept && !kept.answerable && sameJobs(kept.jobIds, ask.jobIds) ? kept : { ...ask, told: false, answerable: false };
    context.state.asks.set(key, entry);
    return say(
        context,
        lines,
        { done: false, asked: true, waitingForTheirAnswer: true },
        () => {
            if (context.state.asks.get(key) === entry) entry.told = true;
        }
    );
}

/** Orbit's reason for a no (the union is not narrowed by `ok` under this project's compiler settings). */
const reasonOf = (answer: ComputerControlAnswer): string => ('reason' in answer && typeof answer.reason === 'string' ? answer.reason : 'unknown');

const sameJobs = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** Stop: asks first, naming every job that would end; once they said yes, it ends exactly those (a job that came since is asked about again). */
async function stopAll(view: ComputerControlView, jobs: ComputerControlJob[], context: ComputerControlContext, door: (ask: Omit<ComputerControlAsk, 'isGuest'>) => Promise<ComputerControlAnswer>): Promise<Record<string, unknown>> {
    if (!jobs.length) return say(context, [CONTROL_REFUSALS.noJobs], { done: false, success: false });
    const key = 'stop';
    const ids = jobs.map((job) => job.id);
    const ask = context.state.asks.get(key);
    if (!ask || !ask.told || !ask.answerable || !sameJobs(ask.jobIds, ids)) {
        if (ask && ask.answerable) context.state.asks.delete(key);
        return askFirst(context, key, { kind: 'stop', jobIds: ids }, [CONTROL_WORDS.askStop(quotedTitles(jobs.map((job) => job.title)))]);
    }
    context.state.asks.delete(key);
    return once(context, `stop|${ids.join('|')}`, async () => {
        const answer = await door({ action: 'stop' });
        if (!answer.ok) return refused(reasonOf(answer), jobs[0], view);
        const only = jobs.length === 1 ? jobs[0] : null;
        return { result: { done: true }, lines: [only ? lineOf(hasStarted(only) ? CONTROL_WORDS.cancelled : CONTROL_WORDS.cancelledQueued, only.title) : CONTROL_WORDS.stoppedAll(jobs.length)] };
    });
}

/** "How is it going?": the jobs as Orbit has them, in words for the model (no fixed line: it changes nothing), and the steps a named job took so far when Orbit keeps them. */
async function seeJobs(words: string, view: ComputerControlView, jobs: ComputerControlJob[], door: (ask: Omit<ComputerControlAsk, 'isGuest'>) => Promise<ComputerControlAnswer>): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {
        jobs: jobs.map((job) => shownJob(job, view)),
        note: jobs.length
            ? 'Tell them in a sentence or two how it is going, in plain words, from these states and steps only. Say what needs them, if anything. Never a price, how much time is left or how long it will take.'
            : 'There are no jobs on your computer right now. Say so in one plain sentence.',
    };
    if (!words || !jobs.length) return result;
    const found = findJob(words, jobs);
    if (!('job' in found)) return { ...result, ...('which' in found ? { which: found.which.map((job) => job.title) } : { notFound: true }) };
    const activity = await door({ action: 'activity', jobId: found.job.id });
    if (activity.ok && activity.steps?.length) return { ...result, job: found.job.id, stepsSoFar: activity.steps.map((step) => step.label) };
    return { ...result, job: found.job.id };
}
