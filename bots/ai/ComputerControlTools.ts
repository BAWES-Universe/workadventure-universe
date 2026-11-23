/**
 * Brick's controls of its own computer jobs, from its owner's chat (computers full plan, piece 5).
 *
 * `use_computer` starts a job; these act on the jobs that are there: see them and how each is going, pause one, carry on with a paused one, do one first (pausing the running one so it
 * carries on by itself after) or next, cancel one, stop everything, and pass the person's words on to a job (a change, or the answer to its question). Every one goes through Orbit's door
 * for Brick (`POST /api/bots/:id/computer-jobs/control`), which checks the owner and the job exactly as a start does; nothing here decides money or state.
 *
 * The rules this file keeps (decisions of 23 Nov, `computers-full-plan-23-nov/decisions-pause-stop-23-nov.md`):
 *  - Pause and resume act at once (they can be undone) and name the job.
 *  - Cancel of a job that has started or is paused, and Stop, ALWAYS ask first, and offer Pause (a job that never started used nothing and is cancelled at once). The question goes under the reply as a fixed line; only the person's NEXT message can answer it, and only once that question was
 *    delivered to them, and only when that message is a CLEAR YES (`isClearYes`, checked in code: a no, a "keep it", a longer sentence or a change of subject ends the question and runs nothing). Calling the tool again in the same reply, or in a reply asked
 *    again, only repeats the question. A control call that began before a newer message came is abandoned (it sends nothing). Nothing ends until then.
 *  - What the person reads about a control is a fixed line (`ComputerControlWords`) built from what Orbit really answered, appended in the same event as the job status lines.
 *  - A job named by words is found among the jobs Orbit lists; two that fit are never guessed between: Brick asks which, naming them.
 *  - The same control in one turn (a reply asked again, a tool call retried) goes to Orbit once: a message is never passed on twice.
 *  - An answer that did not come back whole is never told as done or as failed, and is not sent again.
 *  - No price, no count of time, no machine reaches the model or the chat.
 */
import { randomUUID } from 'node:crypto';
import { v5 as uuidv5 } from 'uuid';
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
        tool(CANCEL_JOB_TOOL, 'Cancel one job: it ends and cannot be resumed; its files are kept, and the others carry on. A job that has started always asks them first, with a line under your reply: call it when they ask to cancel or end one job, and again when they say yes in their next message (a job that never started is cancelled at once). Never cancel to "pause"; never in the same reply as the question.', { job: JOB_ARG }),
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
    /** The titles of those jobs, as they were when it was asked: what a yes that names one of several questions is matched on. */
    titles: string[];
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
    /** The number of the person's message the chat is on (a reply asked again keeps it): a control call that began on an older one is abandoned. */
    turn: number;
    /** The words of that message. */
    said: string;
    /** The job a control named in this turn, as it was when first named: the same control again in this turn (a reply asked again) goes to the same job, and replays what it did. */
    resolved: Map<string, ComputerControlJob>;
    /**
     * The id each control of this turn goes to Orbit under, by what it asks (GPT's sixth answer, finding 4): the same ask in this turn always sends the SAME id, so a control sent
     * again (a reply written again, a request whose answer was lost) is done once. The person's next message clears them, so a second identical note is a second note.
     */
    commands: Map<string, string>;
}

export function newControlState(): ControlState {
    return { asks: new Map(), calls: new Map(), chain: Promise.resolve(), turn: 0, said: '', resolved: new Map(), commands: new Map() };
}

/** Words that end an answer being a plain yes: a no, a keep, a wait, a "but" (English and Arabic, as the people of the chat write). */
const NEGATING = new Set([
    'no', 'not', 'nope', 'nah', 'dont', 'don', 'never', 'keep', 'leave', 'wait', 'hold', 'later', 'instead', 'but', 'however', 'actually', 'except', 'without', 'rather', 'undo', 'revert', 'nevermind', 'nvm',
    'لا', 'لأ', 'لاء', 'ما', 'مو', 'مش', 'بلاش', 'خله', 'خلها', 'خليه', 'خلي', 'خليها', 'استنى', 'انتظر', 'بعدين', 'لاحقا', 'بس', 'لكن', 'ابقي', 'ابقيه', 'اتركه', 'اترك',
]);
/** The first words of a plain yes (one word, or two). */
const YES_FIRST = new Set(['yes', 'yeah', 'yea', 'yep', 'yup', 'ya', 'y', 'sure', 'ok', 'okay', 'confirm', 'confirmed', 'definitely', 'absolutely', 'proceed', 'correct', 'right', 'affirmative', 'ايوه', 'ايوا', 'اي', 'نعم', 'ايه', 'تمام', 'ماشي', 'اكيد', 'موافق', 'طبعا', 'نفذ', 'اكد', 'اوكي']);
const YES_PAIRS = new Set(['go ahead', 'do it', 'cancel it', 'stop it', 'end it', 'stop them', 'cancel them', 'end them', 'stop all', 'stop everything', 'cancel that', 'stop that', 'end that', 'please do', 'yes please', 'of course', 'الغه', 'الغيه', 'الغي', 'اوقفه', 'اوقفها', 'وقفه', 'وقفها', 'كمل', 'نفذه']);
const YES_MAX_WORDS = 12;

/** The words of a message as plain tokens: lower case, no accents or Arabic marks, one letter for each Arabic alef, apostrophes dropped ("don't" is "dont"). */
function tokensOf(text: string): string[] {
    return text
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f\u0640\u064b-\u065f]/g, '')
        .replace(/[\u0623\u0625\u0622]/g, '\u0627')
        .replace(/['\u2019\u2018`]/g, '')
        .split(/[^\p{L}\p{N}_]+/u)
        .filter(Boolean);
}

/**
 * Whether a message of the person's is a CLEAR YES to the question Brick asked (cancel this job, stop everything): a short message that starts with a yes (or "go ahead", "do it", "cancel
 * it") and has no word of refusing, keeping, waiting or changing its mind anywhere in it. Anything else (a no, "keep it running", a longer sentence, another subject) is not a yes, and
 * the question ends. It is decided here, in code: the model's own reading of the message never ends a job.
 */
export function isClearYes(message: string | undefined): boolean {
    if (typeof message !== 'string') return false;
    const tokens = tokensOf(message);
    if (tokens.length === 0 || tokens.length > YES_MAX_WORDS) return false;
    if (tokens.some((word) => NEGATING.has(word))) return false;
    const [first, second] = tokens[0] === 'please' || tokens[0] === 'pls' ? tokens.slice(1) : tokens;
    if (first === undefined) return false;
    return YES_FIRST.has(first) || (second !== undefined && YES_PAIRS.has(`${first} ${second}`)) || YES_PAIRS.has(first);
}

/** Words that name ANOTHER thing to do with a job than ending it: a yes that says "yes, pause it" is not a yes to a question about cancelling. */
const OTHER_ACTION = new Set(['pause', 'paused', 'pausing', 'resume', 'resumed', 'resuming', 'redirect', 'redirected']);

const ENDING_VERB = new Set(['cancel', 'cancels', 'cancelled', 'canceled', 'cancelling', 'canceling', 'end', 'ends', 'ending', 'stop', 'stops', 'stopping', 'delete', 'kill', 'abort', 'remove', 'drop', 'terminate', 'finish']);
/** Words that may stand between the ending verb and the title ("cancel the pause job"). */
const BETWEEN = new Set(['the', 'my', 'that', 'this', 'job', 'task', 'one', 'called', 'named']);

function endsJobBefore(tokens: string[], at: number): boolean {
    let back = at - 1;
    while (back >= 0 && BETWEEN.has(tokens[back])) back--;
    return back >= 0 && ENDING_VERB.has(tokens[back]);
}

/**
 * Whether a message asks for ANOTHER action than ending (pause, resume, redirect). Words that are part of a job's own title as it was asked about do not count ("Yes, cancel Pause menu audit"
 * confirms the cancel of that job): a run of the message that is a run of two or more words of a title is the title's, and is read out first; a whole one-word title is the title's only right after a verb that ends a job ("yes, cancel Pause"), so a job called "Pause" never turns "Yes, pause it" into a confirmation. "Yes, pause it" has no such run.
 */
function namesAnotherAction(message: string, asks: Array<Pick<ControlAsk, 'titles'>>): boolean {
    const tokens = tokensOf(message);
    const titles = asks.flatMap((ask) => ask.titles.map((title) => tokensOf(title))).filter((words) => words.length > 0);
    const own = new Array<boolean>(tokens.length).fill(false);
    for (const title of titles) {
        for (let at = 0; at < tokens.length; at++) {
            // the longest run of the message starting here that is a run of this title
            for (let start = 0; start < title.length; start++) {
                let length = 0;
                while (at + length < tokens.length && start + length < title.length && tokens[at + length] === title[start + length]) length++;
                // A title that is a single word is the same word as an action when the job is called "Pause": it is the title only when the person is naming the job to end ("yes, cancel Pause"), never
                // when it is the action ("yes, pause it"), so it counts as the title only right after an ending verb (with "the", "job"... between)
                const named = length === 1 && title.length === 1 && endsJobBefore(tokens, at);
                if (length >= 2 || named) for (let i = 0; i < length; i++) own[at + i] = true;
            }
        }
    }
    return tokens.some((word, index) => !own[index] && OTHER_ACTION.has(word));
}

/** How far a message names the question: the whole-word overlap with the titles of the jobs a cancel is about, and for Stop the words that mean everything. 0 names it not at all. */
export function askNamedBy(message: string, ask: Pick<ControlAsk, 'kind' | 'titles'>): number {
    const tokens = new Set(tokensOf(message));
    if (ask.kind === 'stop') return ['all', 'everything', 'both', 'everyone', 'jobs'].some((word) => tokens.has(word)) ? 1 : 0;
    let best = 0;
    for (const title of ask.titles) {
        // The title is read with the SAME tokenizer as the reply (accents, case, apostrophes), so "Café" in a title and "cafe" in a reply are one word. Each distinct word counts once, however often the title repeats it
        const words = [...new Set(tokensOf(title).filter((word) => word.length >= 3 && !COMMON.has(word)))];
        const shared = words.filter((word) => tokens.has(word) || tokens.has(word.replace(/s$/, '')) || tokens.has(`${word}s`)).length;
        best = Math.max(best, shared);
    }
    return best;
}

/**
 * A new message from the person (not a reply asked again): a question that was delivered now has its answer in this message, and only in this one, and only when this message is a clear
 * yes; any other message ends it. A question that was never delivered was never asked and goes; this turn's controls start clean, and a control that began on an older message is abandoned.
 */
export function startControlTurn(state: ControlState | undefined, message?: string): void {
    if (!state) return;
    state.turn += 1;
    state.said = typeof message === 'string' ? message : '';
    const answered = new Set<string>();
    // A yes that names another action ("yes, pause it") is no answer to a question about ending a job (a job whose own title says "pause" is not an action: see `namesAnotherAction`)
    const told = [...state.asks].filter(([, ask]) => ask.told && !ask.answerable);
    if (isClearYes(message) && !namesAnotherAction(message as string, told.map(([, ask]) => ask))) {
        // One question was asked: a yes answers it. Several were asked in one reply (cancel this job, cancel that one): a yes answers ONE of them, and only when it names that one alone; a
        // bare yes, or one that names more than one, answers none, and every question ends (they are asked again, so the person says which)
        if (told.length === 1) answered.add(told[0][0]);
        else if (told.length > 1) {
            const named = told.filter(([, ask]) => askNamedBy(message as string, ask) > 0);
            if (named.length === 1) answered.add(named[0][0]);
        }
    }
    for (const [key, ask] of state.asks) {
        if (answered.has(key)) ask.answerable = true;
        else state.asks.delete(key);
    }
    state.calls.clear();
    state.resolved.clear();
    // A new message is a new set of controls: an identical one (the same note again, say) is a second control with an id of its own, and is done again
    state.commands.clear();
}

export interface ComputerControlContext {
    admin: Pick<AdminApiService, 'controlComputerJobs'>;
    botId: string;
    userId: string;
    isGuest?: boolean;
    state: ControlState;
    /** Where this reply's fixed lines go (the DM). Without it the model is given the line to say. */
    confirmations?: ConfirmationQueue;
    /**
     * The message of the person this control was asked in: every control of it goes to Orbit under an id made from that message, so the same control sent again (the reply written
     * again, an answer that was lost, the whole event delivered again) is done once. Without it a control has a random id, as before: it is done once per request only.
     */
    inbound?: { eventId: string };
}

/** The name the ids of controls are made under: a fixed name of our own, so the same message and control always make the same id, here and after a restart. */
export const COMPUTER_COMMAND_NAMESPACE = '6f1d2a7e-3b64-4a10-9c8e-5d2f4b7a1c90';

/**
 * The id one control goes to Orbit under (GPT's sixth answer, finding 4): made from the person's message, the kind of control, the job and how many controls of that kind and job
 * asks (the words of a note, say), so it is the SAME every time this control is sent and a different one for a control that asks something else. Random (and so done once per
 * request only) when the control was not asked in a message of a chat.
 */
export function commandIdOf(state: ControlState, eventId: string | undefined, kind: string, jobId: string, extra = ''): string {
    const slot = `${kind}|${jobId}|${extra}`;
    const held = state.commands.get(slot);
    if (held) return held;
    if (!eventId) {
        // No message to make it from: a fresh id, kept for this turn so the same control in it still goes under one id
        const once = randomUUID();
        state.commands.set(slot, once);
        return once;
    }
    // What the control asks (the words of a note, the jobs of a stop) is part of its identity, never the order the controls of the turn happened to come in: replayed in another order
    // they make the same ids, and Orbit never sees one id with other words
    const id = uuidv5(`${eventId}:${kind}:${jobId}:${extra}`, COMPUTER_COMMAND_NAMESPACE);
    state.commands.set(slot, id);
    return id;
}

const clean = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** A message keeps its lines (an address, a list): only control characters go. */
const cleanMessage = (value: unknown): string => (typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, NOTE_MAX) : '');
const plain = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const isPaused = (job: ComputerControlJob): boolean => job.status === 'queued' && job.queuedFor === 'paused';
/**
 * A job that has had the computer at some point: cancelling it ends work that ran (a queued job that was never started used nothing). Read from what the job did, never from its place in
 * line alone: a job that ran and was put back in line ("do this first" paused it, "do this next" moved it) is `queued` too, and has been paused before or has steps behind it.
 */
const hasStarted = (job: ComputerControlJob): boolean => job.status !== 'queued' || isPaused(job) || job.pausedBefore === true || (job.stepDone ?? 0) > 0;

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
    // Words that are nothing once cleaned ("???") name no job: every title would "contain" the empty string
    if (!asked) return { none: true };
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
    // The message this call began on: when a newer one has come by the time the call is about to change something, the call is abandoned
    const turn = context.state.turn;
    const run = context.state.chain.then(
        () => control(name, args, context, turn),
        () => control(name, args, context, turn)
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

/** What a control that began on an older message is told: it sends nothing and says nothing to the person. */
const STALE_CALL = { done: false, stale: true, note: 'A newer message from them came in while this was being looked at, so nothing was changed. Answer their newer message instead.' };

/** What names a job in this turn's record of who a control went to: the person's words EXACTLY (two jobs whose ids differ only in a dash are two jobs), never a cleaned-up version of them. */
const resolvedKeyOf = (name: string, words: string, args: Record<string, unknown>): string => `${name}|${JSON.stringify(words)}|${args.pause_running === true}`;

/** The key this turn already holds for the control being asked (the job it first went to, and the control it sent), when it was sent. */
function recordedControl(name: string, args: Record<string, unknown>, state: ControlState): string | null {
    if (name === STOP_COMPUTER_TOOL) return [...state.calls.keys()].find((one) => one.startsWith('stop|')) ?? null;
    const job = state.resolved.get(resolvedKeyOf(name, clean(args.job, JOB_WORDS_MAX), args));
    if (!job) return null;
    let key: string | null = null;
    if (name === PAUSE_JOB_TOOL) key = `pause|${job.id}`;
    else if (name === RESUME_JOB_TOOL) key = `resume|${job.id}`;
    else if (name === JOB_FIRST_TOOL) key = `first|${job.id}|${args.pause_running === true}`;
    else if (name === CANCEL_JOB_TOOL) key = `cancel|${job.id}`;
    else if (name === TELL_JOB_TOOL) {
        const message = cleanMessage(args.message);
        key = message ? `note|${job.id}|${message}` : null;
    }
    return key && state.calls.has(key) ? key : null;
}

async function control(name: string, args: Record<string, unknown>, context: ComputerControlContext, turn: number): Promise<Record<string, unknown>> {
    if (!isComputerControlTool(name)) return { error: 'Unknown tool.' };
    const door = (ask: Omit<ComputerControlAsk, 'isGuest'>): Promise<ComputerControlAnswer> =>
        context.admin.controlComputerJobs(context.botId, context.userId, { ...ask, ...(typeof context.isGuest === 'boolean' ? { isGuest: context.isGuest } : {}) });
    /** A control that changes something carries its own id: the same control sent again is done once (finding 4). Reading the list changes nothing and carries none. */
    const acting = (ask: Omit<ComputerControlAsk, 'isGuest' | 'commandId'>, extra = ''): Promise<ComputerControlAnswer> =>
        door({ ...ask, commandId: commandIdOf(context.state, context.inbound?.eventId, ask.action, ask.jobId ?? '', extra) });
    // A control this turn already sent (a reply written again) says what it did from the record of it, BEFORE the list is read: a list that cannot be read now must not make an accepted
    // cancel read as "nothing changed"
    const recorded = recordedControl(name, args, context.state);
    if (recorded) return once(context, recorded, () => Promise.reject(new Error('unused')));
    const listed = await door({ action: 'list' });
    if (!listed.ok || !listed.view) {
        if (name === COMPUTER_JOBS_TOOL) return { success: false, note: "Their jobs could not be read just now. Say so in one plain sentence, and that the bar above this chat shows them." };
        return say(context, [CONTROL_REFUSALS.couldNot], { done: false, success: false });
    }
    const view = listed.view;
    const jobs = jobsOf(view);
    const words = clean(args.job, JOB_WORDS_MAX);

    if (name === COMPUTER_JOBS_TOOL) return seeJobs(words, view, jobs, door);
    // The list was read while a newer message may have come: a call that began on an older message changes nothing (a cancel or a stop must not run on the strength of a message that is no longer the latest)
    if (context.state.turn !== turn) return STALE_CALL;
    if (name === STOP_COMPUTER_TOOL) return stopAll(view, jobs, context, door);
    // The same control again in this turn (a reply asked again) goes to the job it first named, and replays what it did, whatever the list shows by now
    const resolvedKey = resolvedKeyOf(name, words, args);
    const resolved = context.state.resolved.get(resolvedKey);
    if (!resolved && !jobs.length) return say(context, [CONTROL_REFUSALS.noJobs], { done: false, success: false });

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
    const found: Found = resolved ? { job: resolved } : findJob(words, jobs, fallback);
    if ('none' in found) return say(context, [CONTROL_REFUSALS.noSuchJob(quotedTitles(jobs.map((job) => job.title)))], { done: false, success: false });
    if ('which' in found) return say(context, [CONTROL_REFUSALS.whichJob(quotedTitles(found.which.map((job) => job.title)))], { done: false, asked: 'which' });
    const job = found.job;
    context.state.resolved.set(resolvedKey, job);

    switch (name) {
        case PAUSE_JOB_TOOL: {
            // A job that is already paused: their Pause still GOES to Orbit (GPT's sixth answer, finding 5), because a job the month or a limit paused carries on by itself
            // when room appears, and their asking for it to pause means it must not. Orbit takes that as their own pause; what they read is that it is paused.
            const already = isPaused(job);
            return once(context, `pause|${job.id}`, async () => {
                const answer = await acting({ action: 'pause', jobId: job.id });
                if (!answer.ok) return refused(reasonOf(answer), job, view);
                if (already) return { result: { done: true, already: true }, lines: [lineOf(CONTROL_REFUSALS.alreadyPaused, job.title)] };
                const lost = answer.signInsKept === false;
                return { result: { done: true }, lines: [lineOf(lost ? CONTROL_WORDS.pausedSignInLost : CONTROL_WORDS.paused, job.title)] };
            });
        }
        case RESUME_JOB_TOOL:
            if (!isPaused(job) && !context.state.calls.has(`resume|${job.id}`)) return say(context, [lineOf(CONTROL_REFUSALS.notPaused, job.title)], { done: false });
            return once(context, `resume|${job.id}`, async () => {
                const answer = await acting({ action: 'resume', jobId: job.id });
                if (!answer.ok) return refused(reasonOf(answer), job, view);
                return { result: { done: true }, lines: [resumedLine(job, answer.view)] };
            });
        case JOB_FIRST_TOOL: {
            const pauseRunning = args.pause_running === true;
            const firstKey = `first|${job.id}|${pauseRunning}`;
            if (view.job?.id === job.id && !context.state.calls.has(firstKey)) return say(context, [lineOf(CONTROL_REFUSALS.alreadyRunning, job.title)], { done: false });
            // The one that has the computer now: paused by "do this first", it carries on by itself after
            const running = pauseRunning ? view.job : null;
            return once(context, firstKey, async () => {
                const answer = await acting({ action: 'first', jobId: job.id, ...(running ? { pauseRunning: true } : {}) }, String(pauseRunning));
                if (!answer.ok) return refused(reasonOf(answer), running && reasonOf(answer) === 'taken_over' ? running : job, view);
                const nowHas = answer.view?.job?.id === job.id;
                // The mock's two lines: what has the computer now, then the job that was working, paused, which carries on by itself right after
                if (running) {
                    // signInsKept false: the paused job's sign-ins could not be put away (absent: nothing held the machine, say nothing)
                    const pausedLine = lineOf(CONTROL_WORDS.firstPausedOther, running.title) + (answer.signInsKept === false ? ` ${CONTROL_WORDS.signInAgain}` : '');
                    return { result: { done: true }, lines: [lineOf(nowHas || !answer.view ? CONTROL_WORDS.firstStarted : CONTROL_WORDS.firstNext, job.title), pausedLine] };
                }
                if (nowHas) return { result: { done: true }, lines: [lineOf(CONTROL_WORDS.firstStarted, job.title)] };
                // First on a paused job carries it on (Orbit's rule): said as a resume
                if (isPaused(job)) return { result: { done: true }, lines: [resumedLine(job, answer.view)] };
                return { result: { done: true }, lines: [lineOf(CONTROL_WORDS.movedNext, job.title)] };
            });
        }
        case CANCEL_JOB_TOOL: {
            const key = `cancel|${job.id}`;
            // The cancel already sent in this turn (a reply asked again) says what it did, and asks nothing
            if (context.state.calls.has(key)) return once(context, key, () => Promise.reject(new Error('unused')));
            const ask = context.state.asks.get(key);
            // A job that has started (or is paused) is always named back first; one that never started used nothing and goes at once (the approved mock, pictures 13 and 14)
            if (hasStarted(job) && (!ask || !ask.told || !ask.answerable)) return askFirst(context, key, { kind: 'cancel', jobIds: [job.id], titles: [job.title] }, [lineOf(CONTROL_WORDS.askCancel, job.title)]);
            context.state.asks.delete(key);
            return once(context, key, async () => {
                const answer = await acting({ action: 'cancel', jobId: job.id });
                if (!answer.ok) return refused(reasonOf(answer), job, view);
                return { result: { done: true }, lines: [lineOf(hasStarted(job) ? CONTROL_WORDS.cancelled : CONTROL_WORDS.cancelledQueued, job.title)] };
            });
        }
        case TELL_JOB_TOOL: {
            const message = cleanMessage(args.message);
            if (!message) return { error: 'Say what to tell the job.' };
            return once(context, `note|${job.id}|${message}`, async () => {
                const answer = await acting({ action: 'note', jobId: job.id, text: message }, message);
                if (!answer.ok) return refused(reasonOf(answer), job, view);
                return { result: { done: true }, lines: [toldLine(job, answer.delivery)] };
            });
        }
        default:
            return { error: 'Unknown tool.' };
    }
}

/** What the person is told after "carry on", from where the job is now. When Orbit gave no view (or the view leaves the job out) nothing is claimed of where it is: only that it was asked to. */
function resumedLine(job: ComputerControlJob, after: ComputerControlView | null): string {
    const now = after ? jobsOf(after).find((one) => one.id === job.id) : undefined;
    if (!after || !now) return lineOf(CONTROL_WORDS.resumeAsked, job.title);
    // Working now is said only of a job that IS working: a job the view shows as waiting for the person (a sign-in, say) has not carried on, and nothing more is claimed of it than that it was asked to
    if (after.job?.id === job.id) return lineOf(now.status === 'running' ? CONTROL_WORDS.resumedNow : CONTROL_WORDS.resumeAsked, job.title);
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
        // The door says `when_it_starts` for a job in line and for a paused one alike: which it is, is the job's own state
        case 'when_it_starts':
            return lineOf(isPaused(job) ? CONTROL_WORDS.toldWhenItCarriesOn : CONTROL_WORDS.toldWhenItStarts, job.title);
        case 'now':
            return lineOf(CONTROL_WORDS.toldRunning, job.title);
        // A way of delivering that this server does not know: Orbit took the words, and nothing is said of when the job will use them
        default:
            return lineOf(CONTROL_WORDS.toldAccepted, job.title);
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
        // Orbit would not take the control's own id (finding 4): none was sent, or the same one came with other arguments. Nothing was done, and it is a fault of ours, never
        // something the person did: they are told it could not be done, and the log says what Orbit refused so it is not silent
        case 'command_missing':
        case 'command_reused':
            console.warn(`[ComputerControlTools] Orbit would not take a control's own id: ${reason}`);
            return no(CONTROL_REFUSALS.couldNot);
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
function askFirst(context: ComputerControlContext, key: string, ask: Pick<ControlAsk, 'kind' | 'jobIds' | 'titles'>, lines: string[]): Record<string, unknown> {
    const kept = context.state.asks.get(key);
    // The same question again in this turn (or a reply asked again) is the same question: it is not answered by it
    const entry: ControlAsk = kept && !kept.answerable && sameJobs(kept.jobIds, ask.jobIds) ? kept : { ...ask, told: false, answerable: false };
    context.state.asks.set(key, entry);
    return say(
        context,
        lines,
        { done: false, asked: true, waitingForTheirAnswer: true },
        () => {
            // Only a question that is still the one on file counts as asked. One that a newer message ended while its reply was being delivered is NOT put back: the next message would answer
            // it after the reply to the in-between message (which may ask something else), and a plain yes could then end a job that was never asked about. It is asked again instead
            if (context.state.asks.get(key) === entry) entry.told = true;
        }
    );
}

/** Orbit's reason for a no (the union is not narrowed by `ok` under this project's compiler settings). */
const reasonOf = (answer: ComputerControlAnswer): string => ('reason' in answer && typeof answer.reason === 'string' ? answer.reason : 'unknown');

const sameJobs = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** Stop: asks first, naming every job that would end; once they said yes, it ends exactly those (a job that came since is asked about again). */
async function stopAll(view: ComputerControlView, jobs: ComputerControlJob[], context: ComputerControlContext, door: (ask: Omit<ComputerControlAsk, 'isGuest'>) => Promise<ComputerControlAnswer>): Promise<Record<string, unknown>> {
    // The stop already sent in this turn (a reply asked again) says what it did, whatever the list shows by now, and asks nothing
    const sent = [...context.state.calls.keys()].find((one) => one.startsWith('stop|'));
    if (sent) return once(context, sent, () => Promise.reject(new Error('unused')));
    if (!jobs.length) return say(context, [CONTROL_REFUSALS.noJobs], { done: false, success: false });
    const key = 'stop';
    const ids = jobs.map((job) => job.id);
    const ask = context.state.asks.get(key);
    if (!ask || !ask.told || !ask.answerable || !sameJobs(ask.jobIds, ids)) {
        if (ask && ask.answerable) context.state.asks.delete(key);
        return askFirst(context, key, { kind: 'stop', jobIds: ids, titles: jobs.map((job) => job.title) }, [CONTROL_WORDS.askStop(quotedTitles(jobs.map((job) => job.title)))]);
    }
    context.state.asks.delete(key);
    return once(context, `stop|${ids.join('|')}`, async () => {
        // Stop names no one job: its id is made from the jobs it was asked about, so a stop asked again over the same jobs is one stop (finding 4)
        const answer = await door({ action: 'stop', commandId: commandIdOf(context.state, context.inbound?.eventId, 'stop', '', [...ids].sort().join('|')) });
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
