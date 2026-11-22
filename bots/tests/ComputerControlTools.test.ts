/**
 * Brick's controls of its computer jobs (computers full plan, piece 5): see them and how they go, pause, carry on, do first or next, cancel one, stop everything, pass words on.
 * Orbit's door is stubbed here with the contract of pieces 1 and 2 (`computers-build/orbit-1-controls/interfaces.md`, piece 2's note of 23 Nov). The words are read from
 * `ComputerControlWords` (the approved steering mock), never written out.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), request: vi.fn(), isAxiosError: () => false }, isAxiosError: () => false }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import axios from 'axios';
import { AdminApiService, controlAnswerOf, type ComputerControlAsk } from '../server/AdminApiService';
import { AIService } from '../ai/AIService';
import {
    CANCEL_JOB_TOOL,
    COMPUTER_CONTROL_TOOLS,
    COMPUTER_JOBS_TOOL,
    JOB_FIRST_TOOL,
    PAUSE_JOB_TOOL,
    RESUME_JOB_TOOL,
    STOP_COMPUTER_TOOL,
    TELL_JOB_TOOL,
    computerControlToolDefinitions,
    findJob,
    newControlState,
    runComputerControlTool,
    startControlTurn,
    type ControlState,
} from '../ai/ComputerControlTools';
import { CONTROL_REFUSALS, CONTROL_WORDS, lineOf, quotedTitles } from '../ai/ComputerControlWords';
import { COMPUTER_TOOL, ConfirmationQueue, computerToolsNote, isComputerTool, runComputerTool } from '../ai/ComputerTools';
import { JOB_STATUS_WORDS, jobLine, quotedTitle, withJobLines } from '../ai/JobStatusLine';
import { describeStep, showsAsStep } from '../ai/ToolSteps';

const BRICK = '0b7c1d2e-1111-4222-8333-944455556666';
const request = axios.request as unknown as ReturnType<typeof vi.fn>;

type Job = Record<string, unknown>;
const working = (over: Job = {}): Job => ({ id: 'job-visa', title: 'Visa form', status: 'running', queuedFor: null, pausedAt: null, pausedWhy: null, stepLabel: 'Filling in page 2', stepDone: 2, stepTotal: 5, waitingFor: null, control: 'brick', ...over });
const inLine = (id: string, title: string, over: Job = {}): Job => ({ id, title, status: 'queued', queuedFor: 'turn', pausedAt: null, pausedWhy: null, stepLabel: null, stepDone: 0, stepTotal: null, waitingFor: null, control: 'brick', ...over });
const paused = (id: string, title: string, over: Job = {}): Job => inLine(id, title, { queuedFor: 'paused', pausedAt: '2026-11-23T01:00:00.000Z', pausedWhy: 'person', stepLabel: 'Page 3', ...over });
const viewOf = (job: Job | null, queued: Job[] = []) => ({ ok: true, view: { job, queued, on: true } });

/** A door that answers `list` with `view` and each other action as `answers` says (by action), recording every ask. */
function door(view: ReturnType<typeof viewOf>, answers: Partial<Record<ComputerControlAsk['action'], unknown>> = {}) {
    const asks: ComputerControlAsk[] = [];
    const controlComputerJobs = vi.fn(async (_bot: string, _user: string, ask: ComputerControlAsk) => {
        asks.push(ask);
        if (ask.action === 'list') return controlAnswerOf(view);
        const answer = answers[ask.action];
        if (answer instanceof Error) throw answer;
        return controlAnswerOf(answer ?? view);
    });
    return { admin: { controlComputerJobs }, asks, acted: () => asks.filter((ask) => ask.action !== 'list') };
}

function chat(admin: ReturnType<typeof door>['admin'], state: ControlState = newControlState()) {
    let queue = new ConfirmationQueue();
    return {
        state,
        get queue() {
            return queue;
        },
        run: (name: string, args: Record<string, unknown> = {}) => runComputerControlTool(name, args, { admin, botId: BRICK, userId: 'uuid-alice', state, confirmations: queue }),
        /** The reply reached the person: its lines are in the event Matrix took. Returns the lines it carried. */
        deliver: async (): Promise<string[]> => {
            const lines = queue.tell();
            await queue.deliver('$event:test');
            return lines;
        },
        /** The reply never reached them (it failed, or a newer message replaced it). */
        drop: () => queue.drop(),
        /** The person writes again: a new reply, with its own queue. */
        nextMessage: () => {
            queue = new ConfirmationQueue();
            startControlTurn(state);
        },
        /** The same reply asked again (a retry): a new queue, and nothing about the turn changes. */
        retry: () => {
            queue.drop();
            queue = new ConfirmationQueue();
        },
    };
}

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('Brick\'s computer controls: the tools', () => {
    it('are seven, offered and gated with use_computer, and one counts as a step on the line (reading); the others say what they did in a fixed line', () => {
        const tools = computerControlToolDefinitions();
        expect(tools.map((tool) => tool.function.name)).toEqual([...COMPUTER_CONTROL_TOOLS]);
        for (const name of COMPUTER_CONTROL_TOOLS) expect(isComputerTool(name)).toBe(true);
        expect(isComputerTool(COMPUTER_TOOL)).toBe(true);
        expect(isComputerTool('make_brick')).toBe(false);
        expect(computerToolsNote()).toMatch(/Cancel and stop always ask them first/);
        expect(computerToolsNote()).toMatch(/never|unless they say it cannot wait/);
        expect(showsAsStep(COMPUTER_JOBS_TOOL, false)).toBe(true);
        expect(describeStep({ id: 'c1', name: COMPUTER_JOBS_TOOL })).toMatchObject({ kind: 'read' });
        for (const name of [PAUSE_JOB_TOOL, CANCEL_JOB_TOOL, STOP_COMPUTER_TOOL]) expect(showsAsStep(name, false)).toBe(false);
        // No switch, no number of jobs, no price in what the model is told
        expect(JSON.stringify(tools)).not.toMatch(/\$|price|credit|\d+ ?%|machine|provider/i);
    });
});

describe('pause and carry on (they act at once, and name the job)', () => {
    it('pauses the job that is working when none is named, and says the approved line under the reply', async () => {
        const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]));
        const c = chat(orbit.admin);
        const result = await c.run(PAUSE_JOB_TOOL);
        expect(orbit.acted()).toEqual([{ action: 'pause', jobId: 'job-visa' }]);
        expect(result).toMatchObject({ done: true });
        expect(String(result.note)).toMatch(/do not say it again/);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.paused, 'Visa form')]);
    });

    it('says the person signs in again when Orbit could not keep the job\'s sign-ins', async () => {
        const orbit = door(viewOf(working()), { pause: { ...viewOf(null, [paused('visa', 'Visa form')]), signInsKept: false } });
        const c = chat(orbit.admin);
        await c.run(PAUSE_JOB_TOOL, { job: 'visa' });
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.pausedSignInLost, 'Visa form')]);
    });

    it('never pauses a job that is already paused: it asks whether to resume it', async () => {
        const orbit = door(viewOf(working(), [paused('job-hotel', 'Hotel booking')]));
        const c = chat(orbit.admin);
        await c.run(PAUSE_JOB_TOOL, { job: 'hotel' });
        expect(orbit.acted()).toEqual([]);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_REFUSALS.alreadyPaused, 'Hotel booking')]);
    });

    it('says "hand it back first" when the person holds the screen (Orbit refuses the pause)', async () => {
        const orbit = door(viewOf(working({ control: 'person' })), { pause: { ok: false, reason: 'taken_over' } });
        const c = chat(orbit.admin);
        const result = await c.run(PAUSE_JOB_TOOL);
        expect(result).toMatchObject({ done: false, success: false });
        expect(await c.deliver()).toEqual([CONTROL_REFUSALS.takenOver]);
    });

    it('carries on with the only paused job, and says where it is now: working, next, still paused for the month or a limit, or waiting for a computer', async () => {
        const cases: Array<[unknown, string]> = [
            [viewOf(working({ id: 'job-hotel', title: 'Hotel booking' })), lineOf(CONTROL_WORDS.resumedNow, 'Hotel booking')],
            [viewOf(working(), [inLine('job-hotel', 'Hotel booking')]), lineOf(CONTROL_WORDS.resumedNext, 'Hotel booking')],
            [viewOf(null, [inLine('job-hotel', 'Hotel booking', { queuedFor: 'busy' })]), lineOf(CONTROL_WORDS.resumedWaiting, 'Hotel booking')],
            [{ ok: false, reason: 'allowance' }, lineOf(CONTROL_WORDS.stillPausedAllowance, 'Hotel booking')],
            [{ ok: false, reason: 'rule' }, lineOf(CONTROL_WORDS.stillPausedRule, 'Hotel booking')],
            [viewOf(null, [paused('job-hotel', 'Hotel booking', { pausedWhy: 'allowance' })]), lineOf(CONTROL_WORDS.stillPausedAllowance, 'Hotel booking')],
        ];
        for (const [answer, line] of cases) {
            const orbit = door(viewOf(working(), [paused('job-hotel', 'Hotel booking')]), { resume: answer });
            const c = chat(orbit.admin);
            await c.run(RESUME_JOB_TOOL);
            expect(orbit.acted()).toEqual([{ action: 'resume', jobId: 'job-hotel' }]);
            expect(await c.deliver()).toEqual([line]);
        }
    });

    it('does not "carry on" a job that is not paused', async () => {
        const orbit = door(viewOf(working()));
        const c = chat(orbit.admin);
        await c.run(RESUME_JOB_TOOL, { job: 'visa' });
        expect(orbit.acted()).toEqual([]);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_REFUSALS.notPaused, 'Visa form')]);
    });
});

describe('do this first, and do this next', () => {
    it('"do this first": pauses the working job and starts this one in ONE call, and says the mock\'s two lines', async () => {
        const after = viewOf(working({ id: 'job-taxi', title: 'Taxi booking' }), [inLine('job-visa', 'Visa form')]);
        const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]), { first: after });
        const c = chat(orbit.admin);
        await c.run(JOB_FIRST_TOOL, { job: 'taxi', pause_running: true });
        expect(orbit.acted()).toEqual([{ action: 'first', jobId: 'job-taxi', pauseRunning: true }]);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.firstStarted, 'Taxi booking'), lineOf(CONTROL_WORDS.firstPausedOther, 'Visa form')]);
    });

    it('"do this first" when the computer could not take it this second: it is next, and the paused one still comes back after', async () => {
        const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]), { first: viewOf(null, [inLine('job-taxi', 'Taxi booking'), inLine('job-visa', 'Visa form')]) });
        const c = chat(orbit.admin);
        await c.run(JOB_FIRST_TOOL, { job: 'taxi', pause_running: true });
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.firstNext, 'Taxi booking'), lineOf(CONTROL_WORDS.firstPausedOther, 'Visa form')]);
    });

    it('"do this next" moves a waiting job to the front and never touches the working one', async () => {
        const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking'), inLine('job-hotel', 'Hotel booking')]), { first: viewOf(working(), [inLine('job-hotel', 'Hotel booking'), inLine('job-taxi', 'Taxi booking')]) });
        const c = chat(orbit.admin);
        await c.run(JOB_FIRST_TOOL, { job: 'hotel' });
        expect(orbit.acted()).toEqual([{ action: 'first', jobId: 'job-hotel' }]);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.movedNext, 'Hotel booking')]);
    });

    it('the job that is working cannot be put first', async () => {
        const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]));
        const c = chat(orbit.admin);
        await c.run(JOB_FIRST_TOOL, { job: 'visa form' });
        expect(orbit.acted()).toEqual([]);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_REFUSALS.alreadyRunning, 'Visa form')]);
    });
});

describe('cancel one job: Brick always asks first, and only the person\'s next message can say yes', () => {
    it('asks, names the job back and offers Pause; nothing is cancelled in that reply, however often it is called', async () => {
        const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]));
        const c = chat(orbit.admin);
        const first = await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        expect(first).toMatchObject({ done: false, asked: true });
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        expect(orbit.acted()).toEqual([]);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.askCancelStarted, 'Visa form')]);
        expect(lineOf(CONTROL_WORDS.askCancelStarted, 'Visa form')).toMatch(/pause it instead/);
    });

    it('cancels once they answered in their next message, and says the mock\'s line', async () => {
        const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]), { cancel: viewOf(working({ id: 'job-taxi', title: 'Taxi booking' })) });
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await c.deliver();
        c.nextMessage();
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        expect(orbit.acted()).toEqual([{ action: 'cancel', jobId: 'job-visa' }]);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.cancelled, 'Visa form')]);
        // and the yes is used up: a later call asks again
        c.nextMessage();
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        expect(orbit.acted()).toHaveLength(1);
    });

    it('a question that never reached them was never asked: the next message asks again, and cancels nothing', async () => {
        const orbit = door(viewOf(working()));
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL);
        c.drop();
        c.nextMessage();
        await c.run(CANCEL_JOB_TOOL);
        expect(orbit.acted()).toEqual([]);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.askCancelStarted, 'Visa form')]);
    });

    it('a reply asked again (a retry of the same turn) only repeats the question; and the question is answerable only in the very next message', async () => {
        const orbit = door(viewOf(working()));
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL);
        c.retry();
        await c.run(CANCEL_JOB_TOOL);
        expect(orbit.acted()).toEqual([]);
        await c.deliver();
        c.nextMessage(); // they answered something else
        c.nextMessage(); // a message later the question is gone
        await c.run(CANCEL_JOB_TOOL);
        expect(orbit.acted()).toEqual([]);
    });

    it('a job that never started: asked with its own words, and cancelled with "it used nothing"', async () => {
        const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]), { cancel: viewOf(working()) });
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'taxi' });
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.askCancelQueued, 'Taxi booking')]);
        c.nextMessage();
        await c.run(CANCEL_JOB_TOOL, { job: 'taxi' });
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.cancelledQueued, 'Taxi booking')]);
    });

    it('a yes for one job never cancels another', async () => {
        const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]));
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await c.deliver();
        c.nextMessage();
        await c.run(CANCEL_JOB_TOOL, { job: 'taxi' });
        expect(orbit.acted()).toEqual([]);
    });

    it('says it is already ending, or over, when Orbit says so, and never that it was cancelled', async () => {
        for (const [reason, line] of [
            ['ending', lineOf(CONTROL_REFUSALS.ending, 'Visa form')],
            ['over', lineOf(CONTROL_REFUSALS.over, 'Visa form')],
        ] as const) {
            const orbit = door(viewOf(working()), { cancel: { ok: false, reason } });
            const c = chat(orbit.admin);
            await c.run(CANCEL_JOB_TOOL);
            await c.deliver();
            c.nextMessage();
            const result = await c.run(CANCEL_JOB_TOOL);
            expect(result).toMatchObject({ done: false });
            expect(await c.deliver()).toEqual([line]);
        }
    });
});

describe('stop everything: always asks, naming every job, and ends exactly those', () => {
    it('asks with every job named and Pause offered; stops on the next message\'s yes', async () => {
        const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking'), paused('job-hotel', 'Hotel booking')]), { stop: viewOf(null) });
        const c = chat(orbit.admin);
        await c.run(STOP_COMPUTER_TOOL);
        expect(orbit.acted()).toEqual([]);
        expect(await c.deliver()).toEqual([CONTROL_WORDS.askStop(quotedTitles(['Visa form', 'Taxi booking', 'Hotel booking']))]);
        c.nextMessage();
        await c.run(STOP_COMPUTER_TOOL);
        expect(orbit.acted()).toEqual([{ action: 'stop' }]);
        expect(await c.deliver()).toEqual([CONTROL_WORDS.stoppedAll(3)]);
    });

    it('a job that came after the question is asked about again: the yes was not for it', async () => {
        let view = viewOf(working());
        const asks: ComputerControlAsk[] = [];
        const admin = { controlComputerJobs: vi.fn(async (_b: string, _u: string, ask: ComputerControlAsk) => (asks.push(ask), controlAnswerOf(view))) };
        const c = chat(admin);
        await c.run(STOP_COMPUTER_TOOL);
        expect(await c.deliver()).toEqual([CONTROL_WORDS.askStop(quotedTitles(['Visa form']))]);
        view = viewOf(working(), [inLine('job-taxi', 'Taxi booking')]);
        c.nextMessage();
        await c.run(STOP_COMPUTER_TOOL);
        expect(asks.filter((ask) => ask.action === 'stop')).toEqual([]);
        expect(await c.deliver()).toEqual([CONTROL_WORDS.askStop(quotedTitles(['Visa form', 'Taxi booking']))]);
    });

    it('with one job, the stop ends it and names it', async () => {
        const orbit = door(viewOf(working()), { stop: viewOf(null) });
        const c = chat(orbit.admin);
        await c.run(STOP_COMPUTER_TOOL);
        await c.deliver();
        c.nextMessage();
        await c.run(STOP_COMPUTER_TOOL);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.cancelled, 'Visa form')]);
    });

    it('nothing to stop', async () => {
        const c = chat(door(viewOf(null)).admin);
        await c.run(STOP_COMPUTER_TOOL);
        expect(await c.deliver()).toEqual([CONTROL_REFUSALS.noJobs]);
    });
});

describe('passing the person\'s words on to a job', () => {
    const note = (delivery: string) => ({ ...viewOf(working()), note: { seq: 1, delivery } });
    it('says what Orbit says happened to the words: reached it now, answered its question, after hand back, when it starts', async () => {
        for (const [delivery, line] of [
            ['now', lineOf(CONTROL_WORDS.toldRunning, 'Visa form')],
            ['answer', lineOf(CONTROL_WORDS.toldAnswer, 'Visa form')],
            ['after_hand_back', lineOf(CONTROL_WORDS.toldAfterHandBack, 'Visa form')],
            ['when_it_starts', lineOf(CONTROL_WORDS.toldWhenItStarts, 'Visa form')],
        ] as const) {
            const orbit = door(viewOf(working()), { note: note(delivery) });
            const c = chat(orbit.admin);
            await c.run(TELL_JOB_TOOL, { message: 'Use 12 March instead.' });
            expect(orbit.acted()).toEqual([{ action: 'note', jobId: 'job-visa', text: 'Use 12 March instead.' }]);
            expect(await c.deliver()).toEqual([line]);
        }
    });

    it('never passes the same words on twice in one turn, even when the reply is asked again; a new message may', async () => {
        const orbit = door(viewOf(working()), { note: note('now') });
        const c = chat(orbit.admin);
        await c.run(TELL_JOB_TOOL, { message: 'Skip the hotel' });
        await c.run(TELL_JOB_TOOL, { message: 'Skip the hotel' });
        c.retry();
        await c.run(TELL_JOB_TOOL, { message: 'Skip the hotel' });
        expect(orbit.acted()).toHaveLength(1);
        // the retried reply still carries the line
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.toldRunning, 'Visa form')]);
        c.nextMessage();
        await c.run(TELL_JOB_TOOL, { message: 'Skip the hotel' });
        expect(orbit.acted()).toHaveLength(2);
    });

    it('an answer that did not come back whole is never said as passed on or as failed, and is not sent again in the turn', async () => {
        const orbit = door(viewOf(working()), { note: { ok: false, reason: 'unknown' } });
        const c = chat(orbit.admin);
        const result = await c.run(TELL_JOB_TOOL, { message: 'Use the other date' });
        await c.run(TELL_JOB_TOOL, { message: 'Use the other date' });
        expect(result).toMatchObject({ done: false, unknown: true });
        expect(orbit.acted()).toHaveLength(1);
        expect(await c.deliver()).toEqual([CONTROL_REFUSALS.unknown]);
    });

    it('needs words', async () => {
        const orbit = door(viewOf(working()));
        expect(await chat(orbit.admin).run(TELL_JOB_TOOL, { message: '   ' })).toEqual({ error: 'Say what to tell the job.' });
        expect(orbit.acted()).toEqual([]);
    });
});

describe('which job the person means', () => {
    const jobs = [working(), inLine('job-taxi', 'Taxi booking'), inLine('job-visa2', 'Visa form for Sara')].map((job) => controlAnswerOf(viewOf(job)).ok && (controlAnswerOf(viewOf(job)) as { view: { job: never } }).view.job);
    it('finds it by its id, its title, words of its title, or words in common; two that fit are asked about, never guessed', () => {
        expect(findJob('taxi', jobs)).toMatchObject({ job: { id: 'job-taxi' } });
        expect(findJob('job-visa2', jobs)).toMatchObject({ job: { id: 'job-visa2' } });
        expect(findJob('the cab... I mean the taxi one', jobs)).toMatchObject({ job: { id: 'job-taxi' } });
        expect(findJob('Visa form', jobs)).toMatchObject({ job: { id: 'job-visa' } });
        expect(findJob('visa', jobs)).toMatchObject({ which: [{ id: 'job-visa' }, { id: 'job-visa2' }] });
        expect(findJob('Sara', jobs)).toMatchObject({ job: { id: 'job-visa2' } });
        expect(findJob('groceries', jobs)).toEqual({ none: true });
    });

    it('asks which, naming them, and does nothing', async () => {
        const orbit = door(viewOf(working(), [inLine('job-visa2', 'Visa form for Sara')]));
        const c = chat(orbit.admin);
        await c.run(PAUSE_JOB_TOOL, { job: 'visa' });
        expect(orbit.acted()).toEqual([]);
        expect(await c.deliver()).toEqual([CONTROL_REFUSALS.whichJob(quotedTitles(['Visa form', 'Visa form for Sara']))]);
    });

    it('says it cannot find it, naming the jobs there are', async () => {
        const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]));
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'groceries' });
        expect(orbit.acted()).toEqual([]);
        expect(await c.deliver()).toEqual([CONTROL_REFUSALS.noSuchJob(quotedTitles(['Visa form', 'Taxi booking']))]);
    });
});

describe('"how is it going?"', () => {
    it('reads the jobs with their states and steps (no fixed line: it changes nothing), and the steps so far of a named job', async () => {
        const orbit = door(viewOf(working({ status: 'waiting', waitingFor: 'signin' }), [inLine('job-taxi', 'Taxi booking'), paused('job-hotel', 'Hotel booking', { pausedWhy: 'allowance' })]), {
            activity: { ok: true, job: { id: 'job-visa', title: 'Visa form', status: 'running' }, steps: [{ seq: 1, label: 'Opened the site', at: null }, { seq: 2, label: 'Filled in page 1', at: null }] },
        });
        const c = chat(orbit.admin);
        const result = await c.run(COMPUTER_JOBS_TOOL, { job: 'visa' });
        expect(result.jobs).toEqual([
            { id: 'job-visa', title: 'Visa form', state: 'waiting for them (a sign-in)', step: 'Filling in page 2', progress: 'step 2 of 5' },
            { id: 'job-taxi', title: 'Taxi booking', state: 'next in line' },
            { id: 'job-hotel', title: 'Hotel booking', state: "paused: this month's computer time is used up", step: 'Page 3' },
        ]);
        expect(result.stepsSoFar).toEqual(['Opened the site', 'Filled in page 1']);
        expect(orbit.acted()).toEqual([{ action: 'activity', jobId: 'job-visa' }]);
        expect(await c.deliver()).toEqual([]);
        // what the model reads of the jobs carries no price, no amount and no machine (the note itself only says never to give one)
        expect(JSON.stringify([result.jobs, result.stepsSoFar])).not.toMatch(/\$|price|credit|machine|provider|\d+ ?%/i);
    });

    it('says it could not read them when Orbit cannot be reached, without a fixed line', async () => {
        const admin = { controlComputerJobs: vi.fn().mockResolvedValue({ ok: false, reason: 'unreachable' }) };
        const c = chat(admin);
        expect(await c.run(COMPUTER_JOBS_TOOL)).toMatchObject({ success: false });
        expect(await c.deliver()).toEqual([]);
    });
});

describe('what reaches the person', () => {
    it('the control lines come after the job status lines, in the same event, and a question counts as asked only once that event was taken', async () => {
        const orbit = door(viewOf(working()));
        const state = newControlState();
        const queue = new ConfirmationQueue();
        queue.add('key-00000001', async () => undefined, { state: 'started', title: 'Taxi booking' });
        await runComputerControlTool(CANCEL_JOB_TOOL, {}, { admin: orbit.admin, botId: BRICK, userId: 'u', state, confirmations: queue });
        const lines = queue.tell();
        expect(withJobLines('Sure.', lines)).toBe(`Sure.\n\n${jobLine({ state: 'started', title: 'Taxi booking' })}\n${lineOf(CONTROL_WORDS.askCancelStarted, 'Visa form')}`);
        expect([...state.asks.values()][0].told).toBe(false);
        await queue.deliver(undefined);
        expect([...state.asks.values()][0].told).toBe(false);
        await queue.deliver('$e');
        expect([...state.asks.values()][0].told).toBe(true);
    });

    it('a reply that was dropped (failed, or replaced by a newer message) carries no control line and asks nothing', async () => {
        const told = vi.fn();
        const queue = new ConfirmationQueue();
        queue.say('A line', told);
        queue.drop();
        expect(queue.tell()).toEqual([]);
        await queue.deliver('$e');
        expect(told).not.toHaveBeenCalled();
        // and the same line said twice in one reply is said once, both callers told once it goes
        const again = new ConfirmationQueue();
        const second = vi.fn();
        again.say('Same', told);
        again.say('Same', second);
        expect(again.tell()).toEqual(['Same']);
        await again.deliver('$e');
        expect([told.mock.calls.length, second.mock.calls.length]).toEqual([1, 1]);
    });

    it('with no place for a line (not a DM), the model is given the words to say', async () => {
        const orbit = door(viewOf(working()));
        const result = await runComputerControlTool(PAUSE_JOB_TOOL, {}, { admin: orbit.admin, botId: BRICK, userId: 'u', state: newControlState() });
        expect(result.note).toContain(lineOf(CONTROL_WORDS.paused, 'Visa form'));
    });

    it('a control that could not be done changes nothing and says so, and never throws', async () => {
        const c = chat({ controlComputerJobs: vi.fn().mockRejectedValue(new Error('boom')) });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await c.run(PAUSE_JOB_TOOL)).toMatchObject({ done: false });
        expect(await c.deliver()).toEqual([CONTROL_REFUSALS.couldNot]);
    });

    it('a paused job asked for again is never a second one: the status line asks whether to resume it', async () => {
        expect(jobLine({ state: 'queued', queuedFor: 'paused', title: 'Visa form' })).toBe(JOB_STATUS_WORDS.queued.paused.titled(quotedTitle('Visa form')));
        const queue = new ConfirmationQueue();
        const result = await runComputerTool({ job: 'Visa form' }, { admin: { startComputerJob: vi.fn().mockResolvedValue({ ok: true, job: { id: 'job-visa', status: 'queued', queuedFor: 'paused' }, restoredFrom: null }) } as never, botId: BRICK, userId: 'u', confirmations: queue });
        expect(result.note).toMatch(/paused, and nothing new was started/);
        expect(queue.tell()).toEqual([JOB_STATUS_WORDS.queued.paused.titled(quotedTitle('Visa form'))]);
    });
});

describe('Orbit\'s door for Brick (AdminApiService.controlComputerJobs)', () => {
    const service = () => {
        process.env.BOT_SERVICE_TOKEN = 'token';
        return new AdminApiService('https://orbit.example', 'admin-token');
    };
    it('sends exactly the fields the door takes, and reads the view, the note\'s delivery and the steps', async () => {
        request.mockResolvedValueOnce({ data: { ok: true, view: { job: { id: 'job-visa', title: 'Visa form', status: 'running', control: 'brick', cost: 5 }, queued: [] }, note: { seq: 3, delivery: 'now' } } });
        const answer = await service().controlComputerJobs(BRICK, 'uuid-alice', { action: 'note', jobId: 'job-visa', text: 'hello', isGuest: false });
        expect(request.mock.calls[0][0]).toMatchObject({ method: 'post', url: expect.stringMatching(/api\/bots\/.*\/computer-jobs\/control$/), data: { personId: 'uuid-alice', isGuest: false, action: 'note', jobId: 'job-visa', text: 'hello' } });
        expect(Object.keys(request.mock.calls[0][0].data).sort()).toEqual(['action', 'isGuest', 'jobId', 'personId', 'text']);
        expect(answer).toMatchObject({ ok: true, delivery: 'now', view: { job: { id: 'job-visa', control: 'brick' } } });
        expect(JSON.stringify(answer)).not.toMatch(/cost/);
    });

    it('reads Orbit\'s own no with any status; a slow or broken answer is unknown; a door that is not there yet, or nothing sent, is unreachable', async () => {
        const api = service();
        request.mockResolvedValueOnce({ data: { ok: false, reason: 'taken_over' } });
        expect(await api.controlComputerJobs(BRICK, 'u', { action: 'pause', jobId: 'j' })).toEqual({ ok: false, reason: 'taken_over' });
        request.mockRejectedValueOnce({ response: { status: 409, data: { ok: false, reason: 'ending' } } });
        expect(await api.controlComputerJobs(BRICK, 'u', { action: 'pause', jobId: 'j' })).toEqual({ ok: false, reason: 'ending' });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        request.mockRejectedValueOnce({ code: 'ECONNABORTED', isAxiosError: true });
        expect(await api.controlComputerJobs(BRICK, 'u', { action: 'pause', jobId: 'j' })).toEqual({ ok: false, reason: 'unknown' });
        request.mockRejectedValueOnce({ response: { status: 502, data: '<html>' } });
        expect(await api.controlComputerJobs(BRICK, 'u', { action: 'cancel', jobId: 'j' })).toEqual({ ok: false, reason: 'unknown' });
        request.mockRejectedValueOnce({ response: { status: 404, data: '<html>Not found</html>' } });
        expect(await api.controlComputerJobs(BRICK, 'u', { action: 'list' })).toEqual({ ok: false, reason: 'unreachable' });
        request.mockResolvedValueOnce({ data: { something: 'else' } });
        expect(await api.controlComputerJobs(BRICK, 'u', { action: 'pause', jobId: 'j' })).toEqual({ ok: false, reason: 'unknown' });
    });

    it('asks again when Orbit could not look the person up (503 retry), and then answers', async () => {
        vi.useFakeTimers();
        const api = service();
        request.mockRejectedValueOnce({ response: { status: 503, data: { retry: true } } }).mockResolvedValueOnce({ data: { ok: true, view: { job: null, queued: [] } } });
        const answer = api.controlComputerJobs(BRICK, 'u', { action: 'list' });
        await vi.advanceTimersByTimeAsync(1000);
        expect(await answer).toMatchObject({ ok: true, view: { job: null, queued: [] } });
        expect(request).toHaveBeenCalledTimes(2);
    });
});

describe('in the chat (AIService)', () => {
    type Ai = { noteBrick: AIService['noteBrick']; runComputerControlCall(name: string, args: Record<string, unknown>, where: { botId?: string; playerId?: number }): Promise<Record<string, unknown>>; generateBotResponseStream: AIService['generateBotResponseStream'] };
    function service(controlComputerJobs: ReturnType<typeof vi.fn>, memory: Record<string, unknown>) {
        const ai = Object.create(AIService.prototype) as AIService;
        Object.assign(ai, {
            helperBricks: new Set<string>(),
            ownBricks: new Set<string>(),
            knownBricks: new Set<string>(),
            brickOwners: new Map<string, string>(),
            computerOnCache: new Map(),
            botLimits: new Map(),
            adminApiService: { isConfigured: () => true, controlComputerJobs },
            conversationMemory: { getMemory: () => memory },
        });
        return ai as unknown as Ai;
    }

    it('runs only for a Brick of the person\'s own, and the question is answered by the person\'s next message, not by a reply asked again', async () => {
        const controlComputerJobs = vi.fn(async (_b: string, _u: string, ask: ComputerControlAsk) => controlAnswerOf(ask.action === 'list' ? viewOf(working()) : viewOf(null)));
        const memory: Record<string, unknown> = { userUuid: 'uuid-alice' };
        const ai = service(controlComputerJobs, memory);
        expect(await ai.runComputerControlCall(CANCEL_JOB_TOOL, {}, { botId: BRICK, playerId: 1 })).toEqual({ error: "That can't be done in this chat right now." });
        ai.noteBrick(BRICK, { isDefault: false });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const turn = async (message: string, retry = false) => {
            const stream = ai.generateBotResponseStream(BRICK, 1, message, '', 'none', 'matrix-dm', '', ...((retry ? [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true] : []) as never[]));
            await stream.next();
            await stream.return(undefined);
        };
        await turn('cancel the visa');
        await ai.runComputerControlCall(CANCEL_JOB_TOOL, {}, { botId: BRICK, playerId: 1 });
        const queue = memory.computerConfirmations as ConfirmationQueue;
        queue.tell();
        await queue.deliver('$e');
        const cancels = () => controlComputerJobs.mock.calls.filter((call) => (call[2] as ComputerControlAsk).action === 'cancel');
        await turn('cancel the visa', true);
        await ai.runComputerControlCall(CANCEL_JOB_TOOL, {}, { botId: BRICK, playerId: 1 });
        expect(cancels()).toHaveLength(0);
        await turn('yes');
        await ai.runComputerControlCall(CANCEL_JOB_TOOL, {}, { botId: BRICK, playerId: 1 });
        expect(cancels()).toHaveLength(1);
        expect(controlComputerJobs.mock.calls[0].slice(0, 2)).toEqual([BRICK, 'uuid-alice']);
    });
});
