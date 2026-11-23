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
import { v5 as uuidv5 } from 'uuid';
import {
    CANCEL_JOB_TOOL,
    COMPUTER_COMMAND_NAMESPACE,
    COMPUTER_CONTROL_TOOLS,
    COMPUTER_JOBS_TOOL,
    JOB_FIRST_TOOL,
    PAUSE_JOB_TOOL,
    RESUME_JOB_TOOL,
    STOP_COMPUTER_TOOL,
    TELL_JOB_TOOL,
    computerControlToolDefinitions,
    askNamedBy,
    findJob,
    isClearYes,
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
    return {
        admin: { controlComputerJobs },
        asks,
        /** What was asked, without each control's own id (`commands()` reads those): the ids are made from the message and are checked where that is what the test is about. */
        acted: () =>
            asks
                .filter((ask) => ask.action !== 'list')
                .map((ask) => {
                    const { commandId: _id, ...rest } = ask;
                    return rest;
                }),
        /** The id every control that changed something went under, in order (finding 4). */
        commands: () => asks.filter((ask) => ask.action !== 'list').map((ask) => ask.commandId),
    };
}

function chat(admin: ReturnType<typeof door>['admin'], state: ControlState = newControlState()) {
    let queue = new ConfirmationQueue();
    return {
        state,
        get queue() {
            return queue;
        },
        run: (name: string, args: Record<string, unknown> = {}, event = '$msg:one') =>
            runComputerControlTool(name, args, { admin, botId: BRICK, userId: 'uuid-alice', state, confirmations: queue, inbound: { eventId: event } }),
        /** The reply reached the person: its lines are in the event Matrix took. Returns the lines it carried. */
        deliver: async (): Promise<string[]> => {
            const lines = queue.tell();
            await queue.deliver('$event:test');
            return lines;
        },
        /** The reply never reached them (it failed, or a newer message replaced it). */
        drop: () => queue.drop(),
        /** The person writes again (a clear yes unless they say otherwise): a new reply, with its own queue. */
        nextMessage: (said = 'Yes') => {
            queue = new ConfirmationQueue();
            startControlTurn(state, said);
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

    // GPT's sixth answer, finding 5: their Pause of a job that is already paused still reaches Orbit, because a job the month or a limit paused would otherwise carry on by
    // itself the moment room appears. Orbit takes it as their own pause; what they read is the approved "already paused" line.
    it('sends their Pause of a job that is already paused to Orbit all the same, and asks whether to resume it', async () => {
        const orbit = door(viewOf(working(), [paused('job-hotel', 'Hotel booking', { pausedWhy: 'allowance' })]));
        const c = chat(orbit.admin);
        const result = await c.run(PAUSE_JOB_TOOL, { job: 'hotel' });
        expect(orbit.acted()).toEqual([{ action: 'pause', jobId: 'job-hotel' }]);
        expect(result).toMatchObject({ done: true, already: true });
        expect(await c.deliver()).toEqual([lineOf(CONTROL_REFUSALS.alreadyPaused, 'Hotel booking')]);
    });

    it('sends that Pause once in a turn, however often it is asked for, and says the same each time', async () => {
        const orbit = door(viewOf(working(), [paused('job-hotel', 'Hotel booking', { pausedWhy: 'rule' })]));
        const c = chat(orbit.admin);
        await c.run(PAUSE_JOB_TOOL, { job: 'hotel' });
        c.retry();
        await c.run(PAUSE_JOB_TOOL, { job: 'hotel' });
        expect(orbit.acted()).toEqual([{ action: 'pause', jobId: 'job-hotel' }]);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_REFUSALS.alreadyPaused, 'Hotel booking')]);
    });

    it('says what Orbit said when it refuses their Pause of a paused job, and claims nothing', async () => {
        const orbit = door(viewOf(working(), [paused('job-hotel', 'Hotel booking')]), { pause: { ok: false, reason: 'over' } });
        const c = chat(orbit.admin);
        const result = await c.run(PAUSE_JOB_TOOL, { job: 'hotel' });
        expect(result).toMatchObject({ done: false, success: false, reason: 'over' });
        expect(await c.deliver()).toEqual([lineOf(CONTROL_REFUSALS.over, 'Hotel booking')]);
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

    it('"do this first" whose paused job lost its sign-ins says so after the paused line; signInsKept true or absent says nothing about sign-ins', async () => {
        const after = viewOf(working({ id: 'job-taxi', title: 'Taxi booking' }), [inLine('job-visa', 'Visa form')]);
        for (const [signInsKept, extra] of [[false, ` ${CONTROL_WORDS.signInAgain}`], [true, ''], [undefined, '']] as const) {
            const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]), { first: { ...after, ...(signInsKept === undefined ? {} : { signInsKept }) } });
            const c = chat(orbit.admin);
            await c.run(JOB_FIRST_TOOL, { job: 'taxi', pause_running: true });
            expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.firstStarted, 'Taxi booking'), lineOf(CONTROL_WORDS.firstPausedOther, 'Visa form') + extra]);
        }
        expect(CONTROL_WORDS.pausedSignInLost.plain.endsWith(CONTROL_WORDS.signInAgain)).toBe(true);
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
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.askCancel, 'Visa form')]);
        expect(lineOf(CONTROL_WORDS.askCancel, 'Visa form')).toMatch(/pause it instead/);
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
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.askCancel, 'Visa form')]);
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

    it('a job that never started used nothing: it is cancelled at once, with no question, and "it hadn\'t started"', async () => {
        const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]), { cancel: viewOf(working()) });
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'taxi' });
        expect(orbit.acted()).toEqual([{ action: 'cancel', jobId: 'job-taxi' }]);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.cancelledQueued, 'Taxi booking')]);
    });

    it('a paused job has started: it is asked about first, every time, like a working one', async () => {
        const orbit = door(viewOf(working(), [paused('job-hotel', 'Hotel booking')]), { cancel: viewOf(working()) });
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'hotel' });
        expect(orbit.acted()).toEqual([]);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.askCancel, 'Hotel booking')]);
        c.nextMessage();
        await c.run(CANCEL_JOB_TOOL, { job: 'hotel' });
        expect(orbit.acted()).toEqual([{ action: 'cancel', jobId: 'job-hotel' }]);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.cancelled, 'Hotel booking')]);
    });

    it('a yes for one job never cancels another', async () => {
        const orbit = door(viewOf(working(), [paused('job-hotel', 'Hotel booking')]));
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await c.deliver();
        c.nextMessage();
        await c.run(CANCEL_JOB_TOOL, { job: 'hotel' });
        expect(orbit.acted()).toEqual([]);
    });

    // CodeRabbit on #2114: one reply that asks about two cancels is answered by a yes that names ONE of them
    it('two cancel questions in one reply: a yes that names one cancels that one only, and the other is asked again', async () => {
        const orbit = door(viewOf(working(), [paused('job-hotel', 'Hotel booking')]), { cancel: viewOf(working()) });
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await c.run(CANCEL_JOB_TOOL, { job: 'hotel' });
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.askCancel, 'Visa form'), lineOf(CONTROL_WORDS.askCancel, 'Hotel booking')]);
        c.nextMessage('Yes, cancel the visa one');
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        const second = await c.run(CANCEL_JOB_TOOL, { job: 'hotel' });
        expect(orbit.acted()).toEqual([{ action: 'cancel', jobId: 'job-visa' }]);
        // the hotel is asked about again, and not cancelled
        expect(second).toMatchObject({ done: false, asked: true });
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.cancelled, 'Visa form'), lineOf(CONTROL_WORDS.askCancel, 'Hotel booking')]);
    });

    it('two cancel questions in one reply: a bare yes, or one that fits both, cancels neither', async () => {
        for (const said of ['Yes', 'yes cancel the booking and the form', 'ok do it']) {
            const orbit = door(viewOf(working({ title: 'Visa booking form' }), [paused('job-hotel', 'Hotel booking')]), { cancel: viewOf(null) });
            const c = chat(orbit.admin);
            await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
            await c.run(CANCEL_JOB_TOOL, { job: 'hotel' });
            await c.deliver();
            c.nextMessage(said);
            await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
            await c.run(CANCEL_JOB_TOOL, { job: 'hotel' });
            expect(orbit.acted(), said).toEqual([]);
        }
    });

    it('a cancel question and a stop question in one reply: a yes that names neither cancels and stops nothing; "stop everything" answers the stop only', async () => {
        const orbit = door(viewOf(working(), [paused('job-hotel', 'Hotel booking')]), { stop: viewOf(null) });
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'hotel' });
        await c.run(STOP_COMPUTER_TOOL);
        await c.deliver();
        c.nextMessage('Yes please');
        await c.run(CANCEL_JOB_TOOL, { job: 'hotel' });
        await c.run(STOP_COMPUTER_TOOL);
        expect(orbit.acted()).toEqual([]);
        await c.deliver();
        c.nextMessage();
        const again = door(viewOf(working(), [paused('job-hotel', 'Hotel booking')]), { stop: viewOf(null) });
        const d = chat(again.admin);
        await d.run(CANCEL_JOB_TOOL, { job: 'hotel' });
        await d.run(STOP_COMPUTER_TOOL);
        await d.deliver();
        d.nextMessage('yes, stop everything');
        await d.run(CANCEL_JOB_TOOL, { job: 'hotel' });
        await d.run(STOP_COMPUTER_TOOL);
        expect(again.acted()).toEqual([{ action: 'stop' }]);
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

    it('"when it starts" from the door is said by the job\'s own state: in line it starts, paused it carries on', async () => {
        for (const [job, line] of [
            [inLine('job-taxi', 'Taxi booking'), lineOf(CONTROL_WORDS.toldWhenItStarts, 'Taxi booking')],
            [paused('job-taxi', 'Taxi booking'), lineOf(CONTROL_WORDS.toldWhenItCarriesOn, 'Taxi booking')],
        ] as const) {
            const orbit = door(viewOf(working(), [job]), { note: { ...viewOf(working(), [job]), note: { seq: 1, delivery: 'when_it_starts' } } });
            const c = chat(orbit.admin);
            await c.run(TELL_JOB_TOOL, { job: 'taxi', message: 'Window seat' });
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
    const jobs = [working(), inLine('job-taxi', 'Taxi booking'), inLine('job-visa2', 'Visa form for Sara')].map((job) => controlAnswerOf(viewOf(job)).ok && (controlAnswerOf(viewOf(job)) as unknown as { view: { job: never } }).view.job);
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
        expect(withJobLines('Sure.', lines)).toBe(`Sure.\n\n${jobLine({ state: 'started', title: 'Taxi booking' })}\n${lineOf(CONTROL_WORDS.askCancel, 'Visa form')}`);
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

describe('CodeRabbit N1/N12: only a clear yes, decided in code, ends a job', () => {
    const YES = ['Yes', 'yes please', 'Yeah, cancel it', 'ok', 'Sure, go ahead', 'do it', 'yes, cancel the visa one', 'Yes!', '  YES  ', 'Yes, stop all of them', 'نعم', 'ايوه الغيه', 'تمام', 'أكيد', 'نعم الغيه'];
    const NOT_YES = [
        'No',
        'No, keep it running',
        "no don't",
        "Don't cancel it",
        'keep it',
        'leave it running',
        'wait, not yet',
        'never mind',
        'yes but keep the visa one',
        'actually, no',
        'what is the visa job doing?',
        '',
        '   ',
        'Book me a taxi for Friday',
        'yes yes yes yes yes yes yes yes yes yes yes yes yes',
        'لا',
        'لا خليه',
        'استنى شوي',
        'خله يكمل',
        'لا تلغي',
        'ما ابي',
        'ما أبغى',
        'مو الحين',
        'مش دلوقتي',
        'انتظر',
        'بعدين',
        'yes but wait',
        'maybe',
        'cancel',
    ];
    it('is a yes only for a short message that starts with a yes and has no word of refusing, keeping or waiting', () => {
        for (const said of YES) expect(isClearYes(said), said).toBe(true);
        for (const said of NOT_YES) expect(isClearYes(said), said).toBe(false);
        expect(isClearYes(undefined)).toBe(false);
    });

    for (const [name, tool, args] of [['cancel', CANCEL_JOB_TOOL, { job: 'visa' }], ['stop', STOP_COMPUTER_TOOL, {}]] as const) {
        it(`${name}: a reply of "No, keep it running" never runs it, whatever the model calls; the question is asked again and a yes to THAT one runs it once`, async () => {
            const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]), { cancel: viewOf(null), stop: viewOf(null) });
            const c = chat(orbit.admin);
            await c.run(tool, args);
            await c.deliver();
            c.nextMessage('No, keep it running');
            // the model calls the tool anyway, more than once
            await c.run(tool, args);
            await c.run(tool, args);
            expect(orbit.acted()).toEqual([]);
            expect(await c.deliver()).toHaveLength(1);
            // a yes to the question as it was asked again
            c.nextMessage('Yes');
            await c.run(tool, args);
            expect(orbit.acted()).toHaveLength(1);
            expect(orbit.acted()[0]).toMatchObject({ action: name });
        });

        it(`${name}: a message that is not a yes (another subject, a longer sentence, a "but") ends the question too`, async () => {
            for (const said of ['Book me a taxi', 'yes but keep it', 'I am not sure', 'what jobs do you have?']) {
                const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]), { cancel: viewOf(null), stop: viewOf(null) });
                const c = chat(orbit.admin);
                await c.run(tool, args);
                await c.deliver();
                c.nextMessage(said);
                await c.run(tool, args);
                expect(orbit.acted(), said).toEqual([]);
            }
        });
    }

    it('CONTROL: the same call after a clear yes does cancel, exactly once, the named job', async () => {
        const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]), { cancel: viewOf(null) });
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await c.deliver();
        c.nextMessage('Yes please');
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        expect(orbit.acted()).toEqual([{ action: 'cancel', jobId: 'job-visa' }]);
    });

    it('a yes does not carry from the question of one job to another: a yes to "Cancel visa?" does not cancel the taxi', async () => {
        const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking', { pausedBefore: true })]), { cancel: viewOf(null) });
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await c.deliver();
        c.nextMessage('yes');
        await c.run(CANCEL_JOB_TOOL, { job: 'taxi' });
        expect(orbit.acted()).toEqual([]);
    });
});

describe('CodeRabbit N4: a control that began on an older message changes nothing', () => {
    it('a message that comes in while the list is being read: the older cancel is abandoned (nothing sent, nothing said), and the question stays asked for the new message to answer', async () => {
        const answers: Array<() => void> = [];
        const asks: ComputerControlAsk[] = [];
        const view = viewOf(working(), [inLine('job-taxi', 'Taxi booking')]);
        const slow = {
            controlComputerJobs: vi.fn(async (_b: string, _u: string, ask: ComputerControlAsk) => {
                asks.push(ask);
                if (ask.action === 'list') await new Promise<void>((resolve) => answers.push(resolve));
                return controlAnswerOf(ask.action === 'list' ? view : viewOf(null));
            }),
        };
        const c = chat(slow);
        // first message: the question, delivered (its list read answers at once)
        const asked = c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        answers.shift()!();
        await asked;
        await c.deliver();
        // the second message is a clear yes, and the model cancels; its list read is slow
        c.nextMessage('Yes');
        const old = c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        // a THIRD message arrives while that list is being read ("no, keep it"): the second turn is over
        await new Promise((resolve) => setTimeout(resolve, 0));
        c.nextMessage('No, keep it running');
        answers.shift()!();
        const result = await old;
        expect(result).toMatchObject({ done: false, stale: true });
        expect(asks.filter((ask) => ask.action === 'cancel')).toEqual([]);
        expect(await c.deliver()).toEqual([]);
    });

    it('Opus (A4): a stale call neither sends nor uses up the question the NEWER message answers: that message\'s own cancel then goes through, once', async () => {
        const answers: Array<() => void> = [];
        const asks: ComputerControlAsk[] = [];
        const view = viewOf(working(), [inLine('job-taxi', 'Taxi booking')]);
        let slowList = false;
        const slow = {
            controlComputerJobs: vi.fn(async (_b: string, _u: string, ask: ComputerControlAsk) => {
                asks.push(ask);
                if (ask.action === 'list' && slowList) await new Promise<void>((resolve) => answers.push(resolve));
                return controlAnswerOf(ask.action === 'list' ? view : viewOf(null));
            }),
        };
        const c = chat(slow);
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await c.deliver();
        // still in that first turn, the model calls cancel again, and its list read is slow
        slowList = true;
        const old = c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        // the person's yes comes in while it reads: the old call is stale
        c.nextMessage('Yes');
        answers.shift()!();
        expect(await old).toMatchObject({ done: false, stale: true });
        expect(asks.filter((ask) => ask.action === 'cancel')).toEqual([]);
        // the yes still answers the question: this turn's own cancel goes, once
        slowList = false;
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        expect(asks.filter((ask) => ask.action === 'cancel').map((ask) => ask.jobId)).toEqual(['job-visa']);
    });

    it('CONTROL: with no newer message the same slow cancel goes through once', async () => {
        const answers: Array<() => void> = [];
        const asks: ComputerControlAsk[] = [];
        const view = viewOf(working(), [inLine('job-taxi', 'Taxi booking')]);
        const slow = {
            controlComputerJobs: vi.fn(async (_b: string, _u: string, ask: ComputerControlAsk) => {
                asks.push(ask);
                if (ask.action === 'list') await new Promise<void>((resolve) => answers.push(resolve));
                return controlAnswerOf(ask.action === 'list' ? view : viewOf(null));
            }),
        };
        const c = chat(slow);
        const asked = c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        answers.shift()!();
        await asked;
        await c.deliver();
        c.nextMessage('Yes');
        const sent = c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        answers.shift()!();
        await sent;
        expect(asks.filter((ask) => ask.action === 'cancel')).toHaveLength(1);
    });

    it('every mutating control is abandoned the same way (pause, resume, first, a note), a read is not', async () => {
        for (const [tool, args, view] of [
            [PAUSE_JOB_TOOL, {}, viewOf(working())],
            [RESUME_JOB_TOOL, { job: 'taxi' }, viewOf(working(), [paused('job-taxi', 'Taxi booking')])],
            [JOB_FIRST_TOOL, { job: 'taxi' }, viewOf(working(), [inLine('job-taxi', 'Taxi booking')])],
            [TELL_JOB_TOOL, { message: 'use 12 March' }, viewOf(working())],
        ] as const) {
            const answers: Array<() => void> = [];
            const asks: ComputerControlAsk[] = [];
            const slow = {
                controlComputerJobs: vi.fn(async (_b: string, _u: string, ask: ComputerControlAsk) => {
                    asks.push(ask);
                    if (ask.action === 'list') await new Promise<void>((resolve) => answers.push(resolve));
                    return controlAnswerOf(view);
                }),
            };
            const c = chat(slow);
            const call = c.run(tool, args as Record<string, unknown>);
            await new Promise((resolve) => setTimeout(resolve, 0));
            c.nextMessage('hello');
            answers.shift()!();
            expect(await call, tool).toMatchObject({ stale: true });
            expect(asks.filter((ask) => ask.action !== 'list'), tool).toEqual([]);
        }
        // a read goes on
        const orbit = door(viewOf(working()));
        const c = chat(orbit.admin);
        const reading = c.run(COMPUTER_JOBS_TOOL);
        c.nextMessage('hello');
        expect(await reading).toMatchObject({ jobs: [expect.objectContaining({ id: 'job-visa' })] });
    });
});

describe('CodeRabbit N2/N3: which jobs started, and which job a selector names', () => {
    it('a job that ran and was put back in line (queued for its turn, paused before, or with steps behind it) is asked about before cancelling; one that never ran goes at once', async () => {
        for (const over of [{ pausedBefore: true }, { stepDone: 3 }]) {
            const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking', over)]), { cancel: viewOf(working()) });
            const c = chat(orbit.admin);
            await c.run(CANCEL_JOB_TOOL, { job: 'taxi' });
            expect(orbit.acted(), JSON.stringify(over)).toEqual([]);
            expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.askCancel, 'Taxi booking')]);
        }
        const never = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]), { cancel: viewOf(working()) });
        const c = chat(never.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'taxi' });
        expect(never.acted()).toEqual([{ action: 'cancel', jobId: 'job-taxi' }]);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.cancelledQueued, 'Taxi booking')]);
    });

    it('reads pausedBefore from Orbit (the flag, or a pause count above 0)', () => {
        const job = { id: 'a', status: 'queued', title: 'T' };
        expect(controlAnswerOf({ ok: true, view: { job: null, queued: [{ ...job, pausedBefore: true }] } })).toMatchObject({ view: { queued: [{ pausedBefore: true }] } });
        expect(controlAnswerOf({ ok: true, view: { job: null, queued: [{ ...job, pauses: 2 }] } })).toMatchObject({ view: { queued: [{ pausedBefore: true }] } });
        expect(controlAnswerOf({ ok: true, view: { job: null, queued: [{ ...job }] } })).toMatchObject({ view: { queued: [{ pausedBefore: false }] } });
    });

    it('a selector that is nothing once cleaned ("???") names no job: nothing is cancelled, whatever is in line', async () => {
        expect(findJob('???', [inLine('job-visa', 'Visa form')] as never)).toEqual({ none: true });
        expect(findJob('!!', [inLine('job-visa', 'Visa form')] as never)).toEqual({ none: true });
        const orbit = door(viewOf(null, [inLine('job-visa', 'Visa form')]), { cancel: viewOf(null) });
        const c = chat(orbit.admin);
        const answer = await c.run(CANCEL_JOB_TOOL, { job: '???' });
        expect(answer).toMatchObject({ done: false });
        expect(orbit.acted()).toEqual([]);
        // control: no selector at all keeps the single-job fallback
        expect(findJob('', [inLine('job-visa', 'Visa form')] as never)).toMatchObject({ job: { id: 'job-visa' } });
    });
});

describe('CodeRabbit: a reply asked again replays what the control did, and claims no more than Orbit said', () => {
    it('pause, resume and first: the reply asked again (the list now shows the new state) says the same line, sends once', async () => {
        const cases = [
            { tool: PAUSE_JOB_TOOL, args: {}, before: viewOf(working()), after: viewOf(null, [paused('job-visa', 'Visa form')]), action: 'pause', line: lineOf(CONTROL_WORDS.paused, 'Visa form') },
            { tool: RESUME_JOB_TOOL, args: {}, before: viewOf(null, [paused('job-visa', 'Visa form')]), after: viewOf(working()), action: 'resume', line: lineOf(CONTROL_WORDS.resumedNow, 'Visa form') },
        ];
        for (const one of cases) {
            let state = one.before;
            const asks: ComputerControlAsk[] = [];
            const admin = {
                controlComputerJobs: vi.fn(async (_b: string, _u: string, ask: ComputerControlAsk) => {
                    asks.push(ask);
                    if (ask.action === 'list') return controlAnswerOf(state);
                    state = one.after;
                    return controlAnswerOf(one.after);
                }),
            };
            const c = chat(admin);
            await c.run(one.tool, one.args);
            expect(await c.deliver()).toEqual([one.line]);
            c.retry();
            await c.run(one.tool, one.args);
            expect(await c.deliver(), one.action).toEqual([one.line]);
            expect(asks.filter((ask) => ask.action === one.action), one.action).toHaveLength(1);
        }
    });

    it('pause and resume: the reply asked again NAMING the job (other words than the first call, so it is found afresh in the new state) still replays the line and sends nothing more', async () => {
        const cases = [
            { tool: PAUSE_JOB_TOOL, before: viewOf(working()), after: viewOf(null, [paused('job-visa', 'Visa form')]), action: 'pause', line: lineOf(CONTROL_WORDS.paused, 'Visa form') },
            { tool: RESUME_JOB_TOOL, before: viewOf(null, [paused('job-visa', 'Visa form')]), after: viewOf(working()), action: 'resume', line: lineOf(CONTROL_WORDS.resumedNow, 'Visa form') },
        ];
        for (const one of cases) {
            let state = one.before;
            const asks: ComputerControlAsk[] = [];
            const admin = {
                controlComputerJobs: vi.fn(async (_b: string, _u: string, ask: ComputerControlAsk) => {
                    asks.push(ask);
                    if (ask.action === 'list') return controlAnswerOf(state);
                    state = one.after;
                    return controlAnswerOf(one.after);
                }),
            };
            const c = chat(admin);
            await c.run(one.tool, {});
            expect(await c.deliver()).toEqual([one.line]);
            c.retry();
            // the same reply written again names the job this time: it is found in the list as it stands now (paused, or working again), so only the call already sent can say what happened
            await c.run(one.tool, { job: 'visa' });
            expect(await c.deliver(), one.action).toEqual([one.line]);
            expect(asks.filter((ask) => ask.action === one.action), one.action).toHaveLength(1);
        }
    });

    it('cancel and stop: the reply asked again, after the job is gone from the list, says what was done and sends nothing more', async () => {
        for (const [tool, args, action] of [[CANCEL_JOB_TOOL, { job: 'visa' }, 'cancel'], [STOP_COMPUTER_TOOL, {}, 'stop']] as const) {
            let state = viewOf(working());
            const asks: ComputerControlAsk[] = [];
            const admin = {
                controlComputerJobs: vi.fn(async (_b: string, _u: string, ask: ComputerControlAsk) => {
                    asks.push(ask);
                    if (ask.action === 'list') return controlAnswerOf(state);
                    state = viewOf(null);
                    return controlAnswerOf(state);
                }),
            };
            const c = chat(admin);
            await c.run(tool, args);
            await c.deliver();
            c.nextMessage('Yes');
            await c.run(tool, args);
            const first = await c.deliver();
            expect(first).toHaveLength(1);
            expect(first[0]).toMatch(/cancelled|stopped/i);
            c.retry();
            await c.run(tool, args);
            expect(await c.deliver(), action).toEqual(first);
            expect(asks.filter((ask) => ask.action === action), action).toHaveLength(1);
        }
    });

    it('a resume Orbit acknowledged with no view (or a view without the job) says it was asked to carry on, and claims nothing of where the job is; a view with the job holding the computer keeps the approved line', async () => {
        for (const answer of [{ ok: true }, { ok: true, view: { job: null, queued: [] } }]) {
            const orbit = door(viewOf(null, [paused('job-visa', 'Visa form')]), { resume: answer });
            const c = chat(orbit.admin);
            await c.run(RESUME_JOB_TOOL, {});
            expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.resumeAsked, 'Visa form')]);
        }
        const holding = door(viewOf(null, [paused('job-visa', 'Visa form')]), { resume: viewOf(working()) });
        const c = chat(holding.admin);
        await c.run(RESUME_JOB_TOOL, {});
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.resumedNow, 'Visa form')]);
    });

    it('a way of delivering words that this server does not know says Orbit took them, and nothing of when the job uses them; `now` keeps the approved line', async () => {
        const unknown = door(viewOf(working()), { note: { ok: true, view: { job: working(), queued: [] }, note: { delivery: 'deferred' } } });
        const c = chat(unknown.admin);
        await c.run(TELL_JOB_TOOL, { message: 'use 12 March' });
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.toldAccepted, 'Visa form')]);
        expect(lineOf(CONTROL_WORDS.toldAccepted, 'Visa form')).not.toMatch(/next step|when it/);
        const known = door(viewOf(working()), { note: { ok: true, note: { delivery: 'now' } } });
        const d = chat(known.admin);
        await d.run(TELL_JOB_TOOL, { message: 'use 12 March' });
        expect(await d.deliver()).toEqual([lineOf(CONTROL_WORDS.toldRunning, 'Visa form')]);
    });
});

describe('CodeRabbit N8: an ambiguous HTTP failure is never read as Orbit\'s refusal', () => {
    const asked = async (status: number, data: unknown) => {
        const orbit = new AdminApiService('http://orbit.test', 'admin-token');
        (orbit as unknown as { brickCall: unknown }).brickCall = vi.fn(async () => {
            throw Object.assign(new Error(`status ${status}`), { response: { status, data } });
        });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        return orbit.controlComputerJobs(BRICK, 'uuid-alice', { action: 'note', jobId: 'job-visa', text: 'use 12 March' });
    };
    it('a 502, 500, 504 or 408 whose body looks like a refusal is `unknown` (it may have been committed)', async () => {
        for (const status of [500, 502, 504, 408]) expect(await asked(status, { ok: false, reason: 'bad_gateway' }), String(status)).toEqual({ ok: false, reason: 'unknown' });
    });
    it('Orbit\'s own refusals on 404 and 409 are still read as refusals, and a 503 that says retry is still asked again', async () => {
        expect(await asked(409, { ok: false, reason: 'ending' })).toEqual({ ok: false, reason: 'ending' });
        expect(await asked(404, { ok: false, reason: 'not_found' })).toEqual({ ok: false, reason: 'not_found' });
    });
});

// GPT's sixth answer, finding 4: every control that changes something carries its own id, made from the person's message, the kind and the job. Orbit does it once per id.
describe('finding 4: each control goes to Orbit under its own id', () => {
    it('makes the id from the message, the kind and the job, so the same control sent again is the same id', async () => {
        const orbit = door(viewOf(working(), [paused('job-taxi', 'Taxi booking')]));
        const c = chat(orbit.admin);
        await c.run(PAUSE_JOB_TOOL);
        const [first] = orbit.commands();
        expect(first).toBe(uuidv5('$msg:one:pause:job-visa:', COMPUTER_COMMAND_NAMESPACE));
        // the same control in the same message, from a reply written again: the same id (and here the turn's own record means nothing is even sent twice)
        c.retry();
        await c.run(PAUSE_JOB_TOOL);
        expect(orbit.commands()).toEqual([first]);
        // another kind, and another job, each get their own
        await c.run(RESUME_JOB_TOOL, { job: 'taxi' });
        expect(orbit.commands()).toEqual([first, uuidv5('$msg:one:resume:job-taxi:', COMPUTER_COMMAND_NAMESPACE)]);
    });

    it('sends the SAME id again when the request itself broke before Orbit answered, so the control is done once', async () => {
        const orbit = door(viewOf(working()), { pause: new Error('socket hang up') });
        const c = chat(orbit.admin);
        await c.run(PAUSE_JOB_TOOL);
        expect(orbit.commands()).toHaveLength(1);
        // tried again in the same message: it goes out again (nothing was changed), under the id it had
        orbit.admin.controlComputerJobs.mockImplementation(async (_bot: string, _user: string, ask: ComputerControlAsk) => {
            orbit.asks.push(ask);
            return controlAnswerOf(ask.action === 'list' ? viewOf(working()) : viewOf(paused('job-visa', 'Visa form')));
        });
        await c.run(PAUSE_JOB_TOOL);
        const ids = orbit.commands();
        expect(ids).toHaveLength(2);
        expect(ids[1]).toBe(ids[0]);
    });

    it('gives two different notes in one message two ids, and the same note in the NEXT message an id of its own (a deliberate second note)', async () => {
        const told = { ...viewOf(working()), note: { seq: 1, delivery: 'now' } };
        const orbit = door(viewOf(working()), { note: told });
        const c = chat(orbit.admin);
        await c.run(TELL_JOB_TOOL, { message: 'Use 12 March instead.' });
        await c.run(TELL_JOB_TOOL, { message: 'And aisle seat.' });
        const [one, two] = orbit.commands();
        expect(one).toBe(uuidv5('$msg:one:note:job-visa:Use 12 March instead.', COMPUTER_COMMAND_NAMESPACE));
        expect(two).toBe(uuidv5('$msg:one:note:job-visa:And aisle seat.', COMPUTER_COMMAND_NAMESPACE));
        // the same words again in the same message are the same note: nothing is sent
        await c.run(TELL_JOB_TOOL, { message: 'Use 12 March instead.' });
        expect(orbit.commands()).toEqual([one, two]);
        // their next message asking for the same note is a second note, under an id of its own
        c.nextMessage('Tell it again');
        await c.run(TELL_JOB_TOOL, { message: 'Use 12 March instead.' }, '$msg:two');
        const ids = orbit.commands();
        expect(ids).toHaveLength(3);
        expect(ids[2]).toBe(uuidv5('$msg:two:note:job-visa:Use 12 March instead.', COMPUTER_COMMAND_NAMESPACE));
        expect(new Set(ids).size).toBe(3);
    });

    // CodeRabbit on #2114: the id of a note is made from its words, never from the order the notes of a turn came in
    it('makes the same ids for the same two notes of one message when they are replayed in the other order', async () => {
        const told = { ...viewOf(working()), note: { seq: 1, delivery: 'now' } };
        const first = door(viewOf(working()), { note: told });
        await chat(first.admin).run(TELL_JOB_TOOL, { message: 'Use 12 March instead.' });
        await chat(first.admin).run(TELL_JOB_TOOL, { message: 'And aisle seat.' });
        // a fresh state (the reply written again after a restart), the two notes made in the other order
        const second = door(viewOf(working()), { note: told });
        const c = chat(second.admin);
        await c.run(TELL_JOB_TOOL, { message: 'And aisle seat.' });
        await c.run(TELL_JOB_TOOL, { message: 'Use 12 March instead.' });
        const [march, aisle] = first.commands();
        expect(second.commands()).toEqual([aisle, march]);
        expect(march).not.toBe(aisle);
    });

    it('gives cancel, do-this-first and stop their own ids, and stop names the jobs it was asked about', async () => {
        const orbit = door(viewOf(working(), [inLine('job-taxi', 'Taxi booking')]));
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await c.deliver();
        c.nextMessage('Yes');
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' }, '$msg:two');
        expect(orbit.commands()).toEqual([uuidv5('$msg:two:cancel:job-visa:', COMPUTER_COMMAND_NAMESPACE)]);
        await c.run(JOB_FIRST_TOOL, { job: 'taxi', pause_running: true }, '$msg:two');
        expect(orbit.commands()[1]).toBe(uuidv5('$msg:two:first:job-taxi:true', COMPUTER_COMMAND_NAMESPACE));
        await c.run(STOP_COMPUTER_TOOL, {}, '$msg:two');
        await c.deliver();
        c.nextMessage('Yes');
        await c.run(STOP_COMPUTER_TOOL, {}, '$msg:three');
        // Stop names no one job, so its id is made from the jobs it was asked about (in a fixed order), and a stop over other jobs is another id
        expect(orbit.commands()[2]).toBe(uuidv5('$msg:three:stop::job-taxi|job-visa', COMPUTER_COMMAND_NAMESPACE));
    });

    // Fable's final lines for the two answers the game cannot say more about (23 Nov, brick-four-job-lines), checked against the exact text and never against the constants
    it('says the approved words, word for word, for a note Orbit took in a way the game does not know and a carry on with no view of the job', () => {
        const title = '\u201cVisa form\u201d';
        expect(CONTROL_WORDS.toldAccepted.titled(title)).toBe('I\'ve added that to \u201cVisa form\u201d.');
        expect(CONTROL_WORDS.toldAccepted.plain).toBe('I\'ve added that to your job.');
        expect(CONTROL_WORDS.resumeAsked.titled(title)).toBe('I\'ve asked \u201cVisa form\u201d to carry on. The bar above this chat shows where it is.');
        expect(CONTROL_WORDS.resumeAsked.plain).toBe('I\'ve asked your job to carry on. The bar above this chat shows where it is.');
    });

    it('reading the jobs carries no id at all: it changes nothing', async () => {
        const orbit = door(viewOf(working()));
        const c = chat(orbit.admin);
        await c.run(COMPUTER_JOBS_TOOL);
        expect(orbit.asks.every((ask) => ask.commandId === undefined)).toBe(true);
    });

    // Orbit B's contract of 23 Nov: a control with no id, or an id reused with other arguments, is refused with 400 and NOTHING is done
    it('a control Orbit refuses for its id is not told as done, and the log says which refusal it was', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            for (const reason of ['command_missing', 'command_reused'] as const) {
                const orbit = door(viewOf(working()));
                orbit.admin.controlComputerJobs.mockImplementation(async (_bot: string, _user: string, ask: ComputerControlAsk) => {
                    orbit.asks.push(ask);
                    return ask.action === 'list' ? controlAnswerOf(viewOf(working())) : { ok: false as const, reason };
                });
                const c = chat(orbit.admin);
                const answer = await c.run(PAUSE_JOB_TOOL);
                expect(answer, reason).toMatchObject({ done: false, success: false, reason });
                expect(c.queue.tell(), reason).toEqual([CONTROL_REFUSALS.couldNot]);
                expect(warn, reason).toHaveBeenCalledWith(expect.stringContaining(reason));
            }
        } finally {
            warn.mockRestore();
        }
    });

    it('a control asked outside a chat message still goes under one id for the turn', async () => {
        const orbit = door(viewOf(working()));
        const state = newControlState();
        const answer = await runComputerControlTool(PAUSE_JOB_TOOL, {}, { admin: orbit.admin, botId: BRICK, userId: 'uuid-alice', state });
        expect(answer).toMatchObject({ done: true });
        const [id] = orbit.commands();
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(state.commands.get('pause|job-visa|')).toBe(id);
    });
});

describe('CodeRabbit on #2114: exact selectors, a replay that needs no list, and a resumed job that is waiting', () => {
    it('two jobs whose ids differ only in a dash or an underscore are two jobs: a pause for one never replays the other', async () => {
        const orbit = door(viewOf(working({ id: 'job-a', title: 'Alpha form' }), [inLine('job_a', 'Beta form')]));
        const c = chat(orbit.admin);
        await c.run(PAUSE_JOB_TOOL, { job: 'job-a' });
        await c.run(PAUSE_JOB_TOOL, { job: 'job_a' });
        expect(orbit.acted()).toEqual([
            { action: 'pause', jobId: 'job-a' },
            { action: 'pause', jobId: 'job_a' },
        ]);
    });

    it('a cancel Orbit accepted is told as cancelled when the reply is written again and the list cannot be read: it never reads as "nothing changed" and nothing is sent twice', async () => {
        let list = true;
        const asks: ComputerControlAsk[] = [];
        const admin = {
            controlComputerJobs: vi.fn(async (_b: string, _u: string, ask: ComputerControlAsk) => {
                asks.push(ask);
                if (ask.action === 'list') return list ? controlAnswerOf(viewOf(working())) : ({ ok: false as const, reason: 'unknown' } as never);
                return controlAnswerOf(viewOf(null));
            }),
        };
        const c = chat(admin);
        await c.run(CANCEL_JOB_TOOL);
        await c.deliver();
        c.nextMessage('Yes');
        await c.run(CANCEL_JOB_TOOL, {}, '$msg:two');
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.cancelled, 'Visa form')]);
        // the same reply written again: Orbit's list cannot be read now
        c.retry();
        list = false;
        await c.run(CANCEL_JOB_TOOL, {}, '$msg:two');
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.cancelled, 'Visa form')]);
        expect(asks.filter((ask) => ask.action === 'cancel')).toHaveLength(1);
    });

    it('a control that was never sent still needs the list: with none, it is told as one that could not be done', async () => {
        const admin = { controlComputerJobs: vi.fn(async () => ({ ok: false as const, reason: 'unknown' }) as never) };
        const c = chat(admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        expect(await c.deliver()).toEqual([CONTROL_REFUSALS.couldNot]);
    });

    it('carrying on a job that comes back waiting for the person (a sign-in) is never said as working now', async () => {
        const waiting = viewOf(working({ id: 'job-hotel', title: 'Hotel booking', status: 'waiting', waitingFor: 'signin' }));
        const orbit = door(viewOf(working(), [paused('job-hotel', 'Hotel booking')]), { resume: waiting });
        const c = chat(orbit.admin);
        await c.run(RESUME_JOB_TOOL);
        expect(await c.deliver()).toEqual([lineOf(CONTROL_WORDS.resumeAsked, 'Hotel booking')]);
    });
});

// CodeRabbit on #2114 (review of d098522a)
describe('CodeRabbit on d098522a: which question a yes answers, and a question whose reply is still being delivered', () => {
    it('a yes that names ANOTHER action ("yes, pause it") does not answer a cancel question: the job is not cancelled and the question ends', async () => {
        for (const said of ['Yes, pause it', 'yes please pause that one for now', 'ok resume it']) {
            const orbit = door(viewOf(working()), { cancel: viewOf(null) });
            const c = chat(orbit.admin);
            await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
            await c.deliver();
            c.nextMessage(said);
            // the old question ended with that message, before anything can ask a new one
            expect(c.state.asks.size, said).toBe(0);
            await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
            expect(orbit.acted(), said).toEqual([]);
        }
        // the plain yes still answers it
        const orbit = door(viewOf(working()), { cancel: viewOf(null) });
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await c.deliver();
        c.nextMessage('Yes, cancel it');
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        expect(orbit.acted()).toEqual([{ action: 'cancel', jobId: 'job-visa' }]);
    });

    it('a stop question is not answered by a yes that says pause either', async () => {
        const orbit = door(viewOf(working()), { stop: viewOf(null) });
        const c = chat(orbit.admin);
        await c.run(STOP_COMPUTER_TOOL);
        await c.deliver();
        c.nextMessage('yes pause everything');
        await c.run(STOP_COMPUTER_TOOL);
        expect(orbit.acted()).toEqual([]);
    });

    it('two questions in one reply: a message that names BOTH answers neither, even when it names one more closely (ending a job is never decided by the nearer match)', async () => {
        const orbit = door(viewOf(working({ title: 'Visa booking trip' }), [paused('job-hotel', 'Hotel booking')]), { cancel: viewOf(null) });
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await c.run(CANCEL_JOB_TOOL, { job: 'hotel' });
        await c.deliver();
        // "visa" and "booking" are in the first title, "booking" in the second: both are named
        c.nextMessage('yes cancel the visa booking');
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        await c.run(CANCEL_JOB_TOOL, { job: 'hotel' });
        expect(orbit.acted()).toEqual([]);
    });

    it('askNamedBy counts each distinct word of a title once, however often the title repeats it, and still matches a plural', () => {
        const ask = (titles: string[]) => ({ kind: 'cancel' as const, titles });
        expect(askNamedBy('cancel the paris one', ask(['Paris Paris trip']))).toBe(1);
        expect(askNamedBy('cancel the paris trip', ask(['Paris Paris trip']))).toBe(2);
        expect(askNamedBy('the visas', ask(['Visa form']))).toBe(1);
        expect(askNamedBy('paris', ask(['Paris hotel', 'Paris flight']))).toBe(1);
    });

    // CodeRabbit on d098522a asked for the late question to be kept; Opus's read: a plain yes to the NEXT message may be meant for whatever the in-between reply asked, so it is asked again instead
    it('a question whose reply is delivered AFTER a newer message began a turn is not put back: a later plain yes (meant for what the in-between reply asked) ends nothing', async () => {
        const orbit = door(viewOf(working()), { cancel: viewOf(null), stop: viewOf(null) });
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        const sending = c.queue;
        // the reply is handed over to be sent (its text carries the question) ...
        expect(sending.tell()).toEqual([lineOf(CONTROL_WORDS.askCancel, 'Visa form')]);
        // ... the person writes again before Matrix has taken it: a new turn, the old queue dropped (what it already told stays)
        c.nextMessage('what is going on?');
        sending.drop();
        // the in-between reply asks something else (no control question of ours: "shall I send you a summary?")
        // Matrix then accepts the first event, late
        await sending.deliver('$event:late');
        expect(c.state.asks.size).toBe(0);
        // the person's plain yes is for the summary: nothing is cancelled or stopped, whichever way the model then calls the tools
        c.nextMessage('Yes');
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' }, '$msg:three');
        await c.run(STOP_COMPUTER_TOOL, {}, '$msg:three');
        expect(orbit.acted()).toEqual([]);
    });

    it('the question is asked again, and then a yes answers it; a reply that was never delivered asks nothing', async () => {
        const orbit = door(viewOf(working()), { cancel: viewOf(null) });
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        const first = c.queue;
        first.tell();
        c.nextMessage('what is going on?');
        first.drop();
        // the newer turn asks its own question about the same job, and it is delivered
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' }, '$msg:three');
        await c.deliver();
        c.nextMessage('Yes');
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' }, '$msg:four');
        expect(orbit.acted()).toEqual([{ action: 'cancel', jobId: 'job-visa' }]);
        // a reply that is never delivered asks nothing
        const never = door(viewOf(working()), { cancel: viewOf(null) });
        const c3 = chat(never.admin);
        await c3.run(CANCEL_JOB_TOOL, { job: 'visa' });
        const unsent = c3.queue;
        unsent.tell();
        c3.nextMessage('hello');
        unsent.drop();
        expect(c3.state.asks.size).toBe(0);
        c3.nextMessage('Yes');
        await c3.run(CANCEL_JOB_TOOL, { job: 'visa' }, '$msg:three');
        expect(never.acted()).toEqual([]);
    });

    it('a late delivery never touches the newer question for the same key', async () => {
        const orbit = door(viewOf(working()), { cancel: viewOf(null) });
        const c = chat(orbit.admin);
        await c.run(CANCEL_JOB_TOOL, { job: 'visa' });
        const sending = c.queue;
        sending.tell();
        c.nextMessage('what is going on?');
        sending.drop();
        const c2 = chat(orbit.admin, c.state);
        await c2.run(CANCEL_JOB_TOOL, { job: 'visa' }, '$msg:three');
        const newer = [...c.state.asks.values()][0];
        await sending.deliver('$event:late');
        expect([...c.state.asks.values()]).toEqual([newer]);
        expect(newer.told).toBe(false);
    });

    it('a job added again after the reply took its line keeps what that reply confirms; a new key not in the reply stays out of it', async () => {
        const sent: string[] = [];
        const queue = new ConfirmationQueue();
        queue.add('k1', async () => void sent.push('first'), { state: 'started', title: 'Visa form' } as never);
        expect(queue.tell()).toHaveLength(1);
        // the same key again (a tool call retried while the reply is being sent), and one that was never in the reply
        queue.add('k1', async () => void sent.push('replacement'), { state: 'started', title: 'Other' } as never);
        queue.add('k2', async () => void sent.push('second'), { state: 'started', title: 'Late' } as never);
        await queue.deliver('$event:one');
        expect(sent).toEqual(['first']);
    });

    // CodeRabbit on 27ab3385
    it('titles are read with the reply\'s own tokenizer: an accent in a title is no reason to miss it ("Yes, cancel Cafe and Hotel" names both, so it authorizes neither)', async () => {
        const orbit = door(viewOf(working({ id: 'job-cafe', title: 'Café receipts' }), [paused('job-hotel', 'Hotel tickets')]), { cancel: viewOf(null) });
        const ask = async () => {
            const c = chat(orbit.admin);
            await c.run(CANCEL_JOB_TOOL, { job: 'receipts' });
            await c.run(CANCEL_JOB_TOOL, { job: 'hotel' });
            await c.deliver();
            return c;
        };
        const both = await ask();
        both.nextMessage('Yes, cancel Cafe and Hotel');
        await both.run(CANCEL_JOB_TOOL, { job: 'receipts' });
        await both.run(CANCEL_JOB_TOOL, { job: 'hotel' });
        expect(orbit.acted()).toEqual([]);
        // naming only the accented one still selects it
        const one = await ask();
        one.nextMessage('Yes, cancel Café');
        await one.run(CANCEL_JOB_TOOL, { job: 'receipts' });
        await one.run(CANCEL_JOB_TOOL, { job: 'hotel' });
        expect(orbit.acted()).toEqual([{ action: 'cancel', jobId: 'job-cafe' }]);
        expect(askNamedBy('cancel the cafe one', { kind: 'cancel', titles: ['Café receipts'] })).toBe(1);
    });

    it('a job whose own TITLE says "pause" is not a different action: "Yes, cancel Pause menu audit" confirms the cancel; "Yes, pause it" still cannot', async () => {
        for (const [said, cancels] of [
            ['Yes, cancel Pause menu audit', true],
            ['yes cancel the pause menu', true],
            ['Yes, pause it', false],
            ['yes pause the pause menu audit', false],
        ] as const) {
            const orbit = door(viewOf(working({ title: 'Pause menu audit' })), { cancel: viewOf(null) });
            const c = chat(orbit.admin);
            await c.run(CANCEL_JOB_TOOL, { job: 'pause' });
            await c.deliver();
            c.nextMessage(said);
            await c.run(CANCEL_JOB_TOOL, { job: 'pause' });
            expect(orbit.acted(), said).toEqual(cancels ? [{ action: 'cancel', jobId: 'job-visa' }] : []);
        }
    });

    // CodeRabbit on a767269a
    it('a job called just "Pause" does not turn "Yes, pause it" into a confirmation: its title counts only right after a verb that ends a job', async () => {
        for (const [said, cancels] of [
            ['Yes, cancel Pause', true],
            ['yes, end the pause job', true],
            ['Yes, stop Pause please', true],
            ['Yes, pause it', false],
            ['yes pause', false],
            ['Yes, Pause', false],
            ['yes pause Pause', false],
        ] as const) {
            const orbit = door(viewOf(working({ title: 'Pause' })), { cancel: viewOf(null) });
            const c = chat(orbit.admin);
            await c.run(CANCEL_JOB_TOOL, { job: 'pause' });
            await c.deliver();
            c.nextMessage(said);
            await c.run(CANCEL_JOB_TOOL, { job: 'pause' });
            expect(orbit.acted(), said).toEqual(cancels ? [{ action: 'cancel', jobId: 'job-visa' }] : []);
        }
    });

    // CodeRabbit on 8f22995a (old thread r4666780215): the action word at the start of a longer title masks itself the same way
    it('a title that starts with an action word ("Pause it review") is the title only right after an ending verb: "Yes, pause it" cannot confirm its cancel', async () => {
        for (const [said, cancels] of [
            ['Yes, pause it', false],
            ['Yes, pause it review', false],
            ['yes pause it', false],
            ['Yes, cancel Pause it review', true],
            ['yes, end the pause it review job', true],
        ] as const) {
            const orbit = door(viewOf(working({ title: 'Pause it review' })), { cancel: viewOf(null) });
            const c = chat(orbit.admin);
            await c.run(CANCEL_JOB_TOOL, { job: 'review' });
            await c.deliver();
            c.nextMessage(said);
            await c.run(CANCEL_JOB_TOOL, { job: 'review' });
            expect(orbit.acted(), said).toEqual(cancels ? [{ action: 'cancel', jobId: 'job-visa' }] : []);
        }
    });
});
