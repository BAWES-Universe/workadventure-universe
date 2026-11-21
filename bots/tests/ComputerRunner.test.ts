import { AdminApiService } from '../server/AdminApiService';
import { describe, expect, it, vi } from 'vitest';
import {
    RESUME_PROMPT,
    CONTINUE_PROMPT,
    RUNNER_GUARDS,
    createComputerRunner,
    endingOf,
    whyOf,
    jobPrompt,
    outputFolderOf,
    probeRelay,
    POOL_BUSY_WHY,
    RELAY_UNREACHABLE_WHY,
    relayUrlFromEnv,
    type RelayProbeResult,
    runnerOrbitFor,
    type RunnableJob,
    type RunnerEvent,
    type RunnerOrbit,
    type TurnOpened,
} from '../server/ComputerRunner';
import { readRunnerEvents, runnerEventOf, streamLimits } from '../server/ComputerTurnStream';
import { createRefusalNotes, SHARED_CALL_SKEW_MS, type CallRow, type SharedCalls } from '../server/ComputerRefusals';

const JOB: RunnableJob = { jobId: 'job-1', botId: 'brick-1', title: 'Visa form', brief: 'Two people, Kuwait', writes: true, hasTurn: false };
const RELAY = 'https://bot-server.example.test';
const quiet = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
const instantly = async () => undefined;

const done = (words: string): RunnerEvent[] => [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'text', text: words }, { type: 'completed', outputText: words, usage: null }];
const stream = (events: RunnerEvent[]): TurnOpened => ({ ok: true, events: (async function* () { for (const event of events) yield event; })() });

/** A scripted Orbit: each turn answers with the next script, and `look` says how the job stands each time the runner asks. */
function fakeOrbit(scripts: Array<RunnerEvent[] | TurnOpened | ((input: string) => RunnerEvent[] | TurnOpened)>, look: () => { status: string; control: string; generation?: number } | null = () => ({ status: 'running', control: 'brick' })) {
    const seen = { turns: [] as string[], streams: 0, prepares: [] as string[], prepareFacts: [] as Array<{ run?: string } | undefined>, actions: [] as Array<Record<string, unknown>>, cancels: 0, looks: 0 };
    let renewAnswer: (n: number) => Record<string, unknown> = () => ({ ok: true, renewInSeconds: 240 });
    let handoverFails = 0;
    let prepareAnswer: () => { ok: true } | { ok: false; reason: string } = () => ({ ok: true });
    const nextScript = (input: string): TurnOpened => {
        const script = scripts.shift();
        if (!script) throw new Error('the runner asked for a turn nobody scripted');
        const value = typeof script === 'function' ? script(input) : script;
        return Array.isArray(value) ? stream(value) : value;
    };
    const orbit: RunnerOrbit = {
        running: async () => [JOB],
        job: async () => {
            seen.looks++;
            return look();
        },
        action: async (_botId, _jobId, body) => {
            seen.actions.push(body);
            if (body.action === 'handover' && handoverFails > 0) {
                handoverFails--;
                throw new Error('Orbit could not be reached');
            }
            return body.action === 'renew' ? renewAnswer(seen.actions.filter((a) => a.action === 'renew').length) : { ok: true };
        },
        prepare: async (_jobId, relay, extra) => {
            seen.prepares.push(relay);
            seen.prepareFacts.push(extra);
            return prepareAnswer();
        },
        turn: async (_jobId, input) => {
            seen.turns.push(input);
            return nextScript(input);
        },
        stream: async () => {
            seen.streams++;
            return nextScript('(stream)');
        },
        cancel: async () => {
            seen.cancels++;
        },
    };
    return { orbit, seen, setRenew: (fn: typeof renewAnswer) => (renewAnswer = fn), setPrepare: (fn: typeof prepareAnswer) => (prepareAnswer = fn), failHandovers: (n: number) => (handoverFails = n) };
}

const runJob = async (orbit: RunnerOrbit, job: RunnableJob = JOB, relayUrl: string | null = RELAY, refusals?: Parameters<typeof createComputerRunner>[0]['refusals'], runId?: () => string) => {
    const runner = createComputerRunner({ orbit, relayUrl, sleep: instantly, log: quiet, timing: { waitMs: 0, progressMs: 0, reconnectMs: [0, 0], prepareMs: [0, 0] }, ...(refusals ? { refusals } : {}), ...(runId ? { runId } : {}) });
    orbit.running = async () => [job];
    await runner.tick();
    await runner.idle();
    return runner;
};
/** The finishes sent, as before: the run they were numbered in is read on its own (see `finishedWithRun`) */
const finished = (seen: { actions: Array<Record<string, unknown>> }) => finishedWithRun(seen).map(({ run: _run, ...rest }) => rest);
const finishedWithRun = (seen: { actions: Array<Record<string, unknown>> }) => seen.actions.filter((a) => a.action === 'finish');

describe('how the agent says its turn ended', () => {
    it('reads done, failed, and the last word when it says more than one', () => {
        expect(endingOf('All filled in. [[done]]')).toEqual({ kind: 'done' });
        expect(endingOf('The site is down. [[FAILED]]')).toEqual({ kind: 'failed' });
        expect(endingOf('I will say [[done]] later [[failed]]')).toEqual({ kind: 'failed' });
        expect(endingOf('nothing to say')).toEqual({ kind: 'none' });
    });

    it('reads what it needs from the person, and never "details" without saying what and where', () => {
        expect(endingOf('[[handover details | Your name and passport number | visa.example.com]]')).toEqual({ kind: 'handover', waitingFor: 'details', what: 'Your name and passport number', where: 'visa.example.com' });
        expect(endingOf('[[handover signin]]')).toEqual({ kind: 'handover', waitingFor: 'signin', what: null, where: null });
        expect(endingOf('[[handover pay | x | y]]')).toEqual({ kind: 'handover', waitingFor: 'pay', what: null, where: null });
        // details with nothing named is a question, so the person is never asked to tap to fill in "nothing"
        expect(endingOf('[[handover details]]')).toMatchObject({ waitingFor: 'answer' });
        expect(endingOf('[[handover whatever | a | b]]')).toMatchObject({ waitingFor: 'answer' });
        expect(endingOf('[[handover details | ' + 'x'.repeat(400) + ' | here]]')).toMatchObject({ what: 'x'.repeat(150) });
    });

    it('gives the job in the person’s words, says how to end, and says a look-only job writes nothing', () => {
        const prompt = jobPrompt(JOB);
        expect(prompt).toContain('Visa form');
        expect(prompt).toContain('Two people, Kuwait');
        expect(prompt).toContain('[[done]]');
        expect(prompt).not.toContain('only to look');
        expect(jobPrompt({ ...JOB, writes: false, brief: null })).toContain('only to look');
    });

    it('tells a job that writes the folder of its own to save what it makes in, and a look-only job none: the folder is what Orbit hands over', () => {
        expect(outputFolderOf('job-1')).toBe('Outputs/job-1');
        expect(jobPrompt(JOB)).toContain('save it in the folder Outputs/job-1 in your home folder');
        expect(jobPrompt(JOB)).toContain('Only what is in that folder is given to the person');
        // Another job has another folder
        expect(jobPrompt({ ...JOB, jobId: 'job-2' })).toContain('Outputs/job-2');
        expect(jobPrompt({ ...JOB, jobId: 'job-2' })).not.toContain('Outputs/job-1');
        expect(jobPrompt({ ...JOB, writes: false })).not.toContain('Outputs/');
    });
});

describe('a job that runs', () => {
    it('gets its machine ready, sends the job as a turn, and ends done when the agent says so', async () => {
        const { orbit, seen } = fakeOrbit([done('Filled it in. [[done]]')]);
        await runJob(orbit);
        expect(seen.prepares).toEqual([RELAY]);
        expect(seen.turns).toHaveLength(1);
        expect(seen.turns[0]).toContain('Two people, Kuwait');
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
    });

    it('ends failed when the agent says it cannot go on', async () => {
        const { orbit, seen } = fakeOrbit([done('The site is down. [[failed]]')]);
        await runJob(orbit);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', why: 'The site is down.' }]);
    });

    it('says nothing about why when the agent gave no sentence before its marker, and never on a job that finished', async () => {
        const { orbit, seen } = fakeOrbit([done('[[failed]]')]);
        await runJob(orbit);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent' }]);
    });

    it('reports a step for each tool that finished, with its label, and no more than what the agent gave', async () => {
        const events: RunnerEvent[] = [
            { type: 'created', id: 'r', sessionId: 's' },
            { type: 'tool', state: 'started', tool: 'browser', label: 'Opening the form' },
            { type: 'tool', state: 'completed', tool: 'browser', durationMs: 10 },
            { type: 'tool', state: 'started', tool: 'browser', label: 'Typing the dates' },
            { type: 'tool', state: 'completed', tool: 'browser' },
            { type: 'completed', outputText: '[[done]]', usage: null },
        ];
        const { orbit, seen } = fakeOrbit([events]);
        await runJob(orbit);
        const progress = seen.actions.filter((a) => a.action === 'progress');
        expect(progress.at(-1)).toEqual({ action: 'progress', stepDone: 2, label: 'Typing the dates' });
    });

    it('asks to renew its room once, by the clock Orbit gives, and not again for each turn', async () => {
        const { orbit, seen } = fakeOrbit([done('working'), done('still working'), done('[[done]]')]);
        await runJob(orbit);
        expect(seen.turns).toHaveLength(3);
        expect(seen.actions.filter((a) => a.action === 'renew')).toHaveLength(1);
    });

    it('carries on with a plain nudge when the agent stopped without saying how it ended', async () => {
        const { orbit, seen } = fakeOrbit([done('Page one is done.'), done('[[done]]')]);
        await runJob(orbit);
        expect(seen.turns[1]).toBe(CONTINUE_PROMPT);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
    });

    it('ends as failed when turns keep ending with nothing said, or with an error, and when a job goes on for too many turns', async () => {
        const failing: RunnerEvent[] = [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'model_error', message: 'no' }];
        const a = fakeOrbit([failing, failing, failing]);
        await runJob(a.orbit);
        expect(a.seen.turns).toHaveLength(RUNNER_GUARDS.maxBadTurns);
        expect(finished(a.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1, 2, 3] }]);

        const b = fakeOrbit(Array.from({ length: RUNNER_GUARDS.maxTurns + 5 }, () => done('still on it')));
        await runJob(b.orbit);
        expect(b.seen.turns).toHaveLength(RUNNER_GUARDS.maxTurns);
        expect(finished(b.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent' }]);
    });

    it('ends as failed with the agent’s cause when its turns come back with no words, which is what a job can ask for', async () => {
        // e.g. a brief that says never to reply in text: every turn completes, with nothing said
        const { orbit, seen } = fakeOrbit(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => done('')));
        await runJob(orbit);
        expect(seen.turns).toHaveLength(RUNNER_GUARDS.maxBadTurns);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [1, 2, 3] }]);
    });

    it('is ours only when every bad turn really failed: one silent turn among failed ones makes it the agent’s', async () => {
        const failing = (): RunnerEvent[] => [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'model_error', message: 'no' }];
        const mixed = fakeOrbit([failing(), done(''), failing()]);
        await runJob(mixed.orbit);
        expect(finished(mixed.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [1, 2, 3] }]);

        // a good turn in between starts the count again, and the streak that follows is judged on its own
        const again = fakeOrbit([done(''), done('Working on it'), failing(), failing(), failing()]);
        await runJob(again.orbit);
        expect(finished(again.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [3, 4, 5] }]);
    });

    it('never calls a turn ours when the relay refused a call of the job for the person’s allowance or a rule during it', async () => {
        const failing = (): RunnerEvent[] => [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'insufficient_quota', message: 'no' }];
        // the turn failed (Hermes only sees an error), but the relay says why
        const a = fakeOrbit([failing(), failing(), failing()]);
        await runJob(a.orbit, JOB, RELAY, { sawSince: () => true });
        expect(a.seen.turns).toHaveLength(RUNNER_GUARDS.maxBadTurns);
        expect(finished(a.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [1, 2, 3] }]);

        // a turn that said something after a call was refused went on: it is no bad turn, so a job is not ended for refusals it got round
        const b = fakeOrbit([done('One call was refused, so I used another way'), done('[[done]]')]);
        await runJob(b.orbit, JOB, RELAY, { sawSince: () => true });
        expect(b.seen.turns).toHaveLength(2);
        expect(finished(b.seen)).toEqual([{ action: 'finish', outcome: 'done' }]);

        // a refusal noted before the turn began belongs to an earlier turn: it is asked from the turn's own start
        const since: unknown[] = [];
        const c = fakeOrbit([failing(), failing(), failing()]);
        await runJob(c.orbit, JOB, RELAY, { sawSince: (_job, at) => (since.push(at), false) });
        expect(since).toHaveLength(RUNNER_GUARDS.maxBadTurns);
        expect(finished(c.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1, 2, 3] }]);
    });

    it('keeps the refusal window of a turn across a reconnect that could not be made, with the real refusal notes', async () => {
        let t = 0;
        const clock = () => ++t;
        const notes = createRefusalNotes(clock);
        const failing = (): RunnerEvent[] => [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'model_error', message: 'no' }];
        const { orbit, seen } = fakeOrbit([
            // the turn is refused for the person's allowance, then its stream breaks
            () => (notes.note(JOB.jobId), [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'stream_broke', message: 'broke' }]),
            // the reconnect cannot be made, so the same turn is read again on the next look, and ends failed
            { ok: false, reason: 'failed' },
            () => (notes.called(JOB.jobId), failing()),
            () => (notes.called(JOB.jobId), failing()),
            () => (notes.called(JOB.jobId), failing()),
        ]);
        const runner = createComputerRunner({ orbit, relayUrl: RELAY, sleep: instantly, log: quiet, now: clock, refusals: notes, timing: { waitMs: 0, progressMs: 0, reconnectMs: [0, 0], prepareMs: [0, 0] } });
        orbit.running = async () => [JOB];
        await runner.tick();
        await runner.idle();
        expect(seen.turns).toHaveLength(3);
        expect(seen.streams).toBe(2);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [1, 2, 3] }]);
    });

    it('does not carry a refusal into the next turn: a turn that got round it is a good turn, and the failures after it are ours', async () => {
        let t = 0;
        const clock = () => ++t;
        const notes = createRefusalNotes(clock);
        const failing = (): RunnerEvent[] => [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'model_error', message: 'no' }];
        const { orbit, seen } = fakeOrbit([() => (notes.note(JOB.jobId), done('One call was refused, trying another way')), failing(), failing(), failing()]);
        const runner = createComputerRunner({ orbit, relayUrl: RELAY, sleep: instantly, log: quiet, now: clock, refusals: notes, timing: { waitMs: 0, progressMs: 0, reconnectMs: [0, 0], prepareMs: [0, 0] } });
        orbit.running = async () => [JOB];
        await runner.tick();
        await runner.idle();
        expect(seen.turns).toHaveLength(1 + RUNNER_GUARDS.maxBadTurns);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [2, 3, 4] }]);
    });

    describe('a fault of ours that Hermes hands back as a finished turn', () => {
        const rig = (scripts: Array<(input: string) => RunnerEvent[]>) => {
            let t = 0;
            const clock = () => ++t;
            const notes = createRefusalNotes(clock);
            const { orbit, seen } = fakeOrbit(scripts.map((script) => (input: string) => script(input)));
            const runner = createComputerRunner({ orbit, relayUrl: RELAY, sleep: instantly, log: quiet, now: clock, refusals: notes, timing: { waitMs: 0, progressMs: 0, reconnectMs: [0, 0], prepareMs: [0, 0] } });
            orbit.running = async () => [JOB];
            return { notes, seen, run: async () => { await runner.tick(); await runner.idle(); } };
        };

        it('ends the job as failed and ours when every turn completed with the relay’s error as its words', async () => {
            const { notes, seen, run } = rig(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => () => (notes.fault(JOB.jobId), done('Error: the service is busy (503)'))));
            await run();
            expect(seen.turns).toHaveLength(RUNNER_GUARDS.maxBadTurns);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1, 2, 3] }]);
        });

        it('ends the job as failed and ours when every turn completed with no words after a provider 500', async () => {
            const { notes, seen, run } = rig(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => () => (notes.fault(JOB.jobId), done(''))));
            await run();
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1, 2, 3] }]);
        });

        it('does not charge the person for a turn that did its work: a fault a later call made good is a good turn', async () => {
            const { notes, seen, run } = rig([
                () => (notes.fault(JOB.jobId), notes.answered(JOB.jobId), done('Filled the form after a retry')),
                () => (notes.fault(JOB.jobId), notes.answered(JOB.jobId), done('[[done]]')),
            ]);
            await run();
            expect(seen.turns).toHaveLength(2);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
        });

        it('keeps a silent turn the agent’s own when no fault of ours came in during it', async () => {
            const { notes, seen, run } = rig(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => () => (notes.called(JOB.jobId), done(''))));
            await run();
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [1, 2, 3] }]);
        });

        it('does not read a fault from an earlier turn into the turn that followed it', async () => {
            const { notes, seen, run } = rig([
                () => (notes.fault(JOB.jobId), done('Error: busy')),
                () => done('Carrying on with the form'),
                () => done('[[done]]'),
            ]);
            await run();
            expect(seen.turns).toHaveLength(3);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
        });

        it('leaves it to the person’s allowance when a refusal of theirs came in during the same turn', async () => {
            const { notes, seen, run } = rig(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => () => (notes.note(JOB.jobId), notes.fault(JOB.jobId), done('Error'))));
            await run();
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [1, 2, 3] }]);
        });

        it('ends as the agent’s when each turn ended on a person’s own provider failing (their key out of credit, their endpoint failing): the relay notes nothing of ours', async () => {
            const { notes, seen, run } = rig(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => () => (notes.called(JOB.jobId), done(''))));
            await run();
            expect(seen.turns).toHaveLength(RUNNER_GUARDS.maxBadTurns);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [1, 2, 3] }]);
        });

        it('ends as the agent’s when turns failed on a person’s own provider (noted on their side), never as ours', async () => {
            const failing = (notes: ReturnType<typeof createRefusalNotes>) => () => (notes.note(JOB.jobId), [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'upstream_error', message: 'The AI did not answer.' }] as RunnerEvent[]);
            let t = 0;
            const clock = () => ++t;
            const notes = createRefusalNotes(clock);
            const { orbit, seen } = fakeOrbit(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => failing(notes)));
            const runner = createComputerRunner({ orbit, relayUrl: RELAY, sleep: instantly, log: quiet, now: clock, refusals: notes, timing: { waitMs: 0, progressMs: 0, reconnectMs: [0, 0], prepareMs: [0, 0] } });
            orbit.running = async () => [JOB];
            await runner.tick();
            await runner.idle();
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [1, 2, 3] }]);
        });

        it('still takes the agent’s own ending from a turn, and a turn that completed ahead of a done marker is done', async () => {
            const { notes, seen, run } = rig([() => (notes.fault(JOB.jobId), notes.answered(JOB.jobId), done('Finished [[done]]'))]);
            await run();
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
        });
    });

    it('reads a turn that is gone on its first open as a failed turn, not as the agent saying nothing', async () => {
        const { orbit, seen } = fakeOrbit(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => ({ ok: false as const, reason: 'no_turn' })));
        await runJob(orbit);
        expect(seen.turns).toHaveLength(RUNNER_GUARDS.maxBadTurns);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1, 2, 3] }]);
    });

    it('does not count the time it waits for a machine as turns: a machine that is slow to come back never ends the job before it ran', async () => {
        const { orbit, seen, setPrepare } = fakeOrbit([done('All set. [[done]]')]);
        let asked = 0;
        setPrepare(() => (++asked <= RUNNER_GUARDS.maxTurns + 3 ? { ok: false, reason: 'no_machine' } : { ok: true }));
        await runJob(orbit);
        expect(asked).toBeGreaterThan(RUNNER_GUARDS.maxTurns);
        expect(seen.turns).toHaveLength(1);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
    });

    it('ends as failed, and says why in the log, when there is no relay address to give the machine', async () => {
        const { orbit, seen } = fakeOrbit([]);
        await runJob(orbit, JOB, null);
        expect(seen.prepares).toEqual([]);
        expect(seen.turns).toEqual([]);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours' }]);
        expect(quiet.error).toHaveBeenCalledWith(expect.stringContaining('COMPUTER_RELAY_URL'));
    });

    it('does nothing for a job that is over or gone', async () => {
        for (const state of [null, { status: 'stopped', control: 'brick' }, { status: 'done', control: 'brick' }]) {
            const { orbit, seen } = fakeOrbit([], () => state);
            await runJob(orbit);
            expect(seen.turns).toEqual([]);
            expect(finished(seen)).toEqual([]);
        }
    });
});

describe('a stop, an Orbit that cannot be asked, and a turn that was cut off', () => {
    const createRunner = (orbit: RunnerOrbit) => createComputerRunner({ orbit, relayUrl: RELAY, sleep: instantly, log: quiet, timing: { waitMs: 0, progressMs: 0, reconnectMs: [0, 0], prepareMs: [0, 0] } });

    it('does not open a turn when the stop came while the machine was being made ready', async () => {
        const { orbit, seen, setPrepare } = fakeOrbit([done('[[done]]')]);
        const runner = createRunner(orbit);
        setPrepare(() => {
            runner.stop();
            return { ok: true };
        });
        await runner.tick();
        await runner.idle();
        expect(seen.turns).toHaveLength(0);
        expect(finished(seen)).toEqual([]);
    });

    it('starts nothing from a list of jobs that was asked for before a stop', async () => {
        const { orbit, seen } = fakeOrbit([done('[[done]]')]);
        let answer: (jobs: RunnableJob[]) => void = () => undefined;
        orbit.running = () => new Promise((resolve) => { answer = resolve; });
        const runner = createRunner(orbit);
        const ticking = runner.tick();
        runner.stop();
        answer([JOB]);
        await ticking;
        await runner.idle();
        expect(seen.prepares).toEqual([]);
        expect(runner.active()).toEqual([]);
    });

    it('does not finish a job on the word of a turn when Orbit could not be asked who has the machine', async () => {
        let looks = 0;
        const { orbit, seen } = fakeOrbit([done('[[done]]'), done('[[done]]')], () => {
            looks += 1;
            // the first look is the job's own, the next ones (after the first turn) cannot be answered, then it is answered again
            if (looks >= 2 && looks <= 1 + RUNNER_GUARDS.maxBadTurns) throw new Error('Orbit is down');
            return { status: 'running', control: 'brick' };
        });
        await runJob(orbit);
        expect(seen.turns).toHaveLength(2);
        expect(seen.turns[1]).toBe(CONTINUE_PROMPT);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
    });

    it('does not take an ending from a turn that was cut off: the machine’s turn may still be running', async () => {
        const cut: RunnerEvent[] = [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'text', text: 'All done [[done]]' }, { type: 'failed', code: 'model_error', message: 'cut' }];
        const { orbit, seen } = fakeOrbit([cut, done('[[done]]')]);
        await runJob(orbit);
        expect(seen.turns).toHaveLength(2);
        expect(seen.turns[1]).toBe(CONTINUE_PROMPT);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
    });
});

describe('a stop or a failed start that must not cost the job its words', () => {
    const createRunner = (orbit: RunnerOrbit) => createComputerRunner({ orbit, relayUrl: RELAY, sleep: instantly, log: quiet, timing: { waitMs: 0, progressMs: 0, reconnectMs: [0, 0], prepareMs: [0, 0] } });

    it('ends nothing when the stop came during the last try to get the machine ready', async () => {
        const { orbit, seen, setPrepare } = fakeOrbit([]);
        const runner = createRunner(orbit);
        let tries = 0;
        setPrepare(() => {
            tries += 1;
            // the third try is the last one: it fails, and the stop arrives while Orbit is being asked
            if (tries === 3) runner.stop();
            return { ok: false, reason: 'failed' };
        });
        await runner.tick();
        await runner.idle();
        expect(tries).toBe(3);
        expect(finished(seen)).toEqual([]);
    });

    it('does not take an ending from words said before a connection that cannot be picked up again: the turn is gone, not proved over', async () => {
        const broke: RunnerEvent[] = [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'text', text: 'All done [[done]]' }, { type: 'failed', code: 'stream_broke', message: 'broke' }];
        const { orbit, seen } = fakeOrbit([broke, { ok: false, reason: 'no_turn' }, done('[[done]]')]);
        await runJob(orbit);
        expect(seen.turns).toEqual([jobPrompt(JOB), CONTINUE_PROMPT]);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
    });

    it('sends the job’s own words again when the agent could not take the first turn, not only a nudge to carry on', async () => {
        const { orbit, seen } = fakeOrbit([{ ok: false, reason: 'failed' }, done('[[done]]')]);
        await runJob(orbit);
        expect(seen.turns).toEqual([jobPrompt(JOB), jobPrompt(JOB)]);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
    });

    it('does not send the job’s words again when the turn was taken and only the reconnection failed: it reconnects', async () => {
        const broke: RunnerEvent[] = [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'text', text: 'Half ' }, { type: 'failed', code: 'stream_broke', message: 'broke' }];
        // the first turn is taken and breaks; the reconnect cannot be made (look); the next try must reconnect, not send the job again
        const { orbit, seen } = fakeOrbit([broke, { ok: false, reason: 'unreachable' } as unknown as TurnOpened, done('[[done]]')]);
        await runJob(orbit);
        expect(seen.turns).toEqual([jobPrompt(JOB)]);
        expect(seen.streams).toBe(2);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
    });

    it('keeps the job’s own words through a take-over that came before the first turn was taken', async () => {
        let looks = 0;
        const { orbit, seen } = fakeOrbit([done('[[done]]')], () => {
            looks += 1;
            // the person has it first, then hands it back
            return looks === 1 ? { status: 'waiting', control: 'person' } : { status: 'running', control: 'brick' };
        });
        await runJob(orbit);
        expect(seen.turns).toEqual([jobPrompt(JOB)]);
    });
});

describe('the person’s part', () => {
    it('asks again when the handover did not go through, and does not take the job back as if the person had finished', async () => {
        const { orbit, seen, failHandovers } = fakeOrbit([done('[[handover signin]]'), done('[[done]]')]);
        failHandovers(RUNNER_GUARDS.maxBadTurns - 1);
        await runJob(orbit);
        expect(seen.actions.filter((a) => a.action === 'handover')).toHaveLength(RUNNER_GUARDS.maxBadTurns);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
    });

    it('does not count a handover Orbit answered with a refusal as made', async () => {
        const { orbit, seen } = fakeOrbit([done('[[handover signin]]'), done('[[done]]')]);
        const original = orbit.action;
        let refusals = RUNNER_GUARDS.maxBadTurns - 1;
        orbit.action = async (botId, jobId, body) => {
            const answer = await original(botId, jobId, body);
            if (body.action === 'handover' && refusals > 0) {
                refusals--;
                return { ok: false, reason: 'not_running' };
            }
            return answer;
        };
        await runJob(orbit);
        expect(seen.actions.filter((a) => a.action === 'handover')).toHaveLength(RUNNER_GUARDS.maxBadTurns);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
    });

    it('ends the job as failed when the handover never goes through, without resuming it', async () => {
        const { orbit, seen, failHandovers } = fakeOrbit([done('[[handover signin]]')]);
        failHandovers(50);
        await runJob(orbit);
        expect(seen.turns).toHaveLength(1);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours' }]);
    });

    it('ends the job as the agent’s when Orbit answered the handover with a no every time, and as ours only when it could not be reached', async () => {
        const { orbit, seen } = fakeOrbit([done('[[handover signin]]')]);
        const original = orbit.action;
        orbit.action = async (botId, jobId, body) => (body.action === 'handover' ? (await original(botId, jobId, body), { ok: false, reason: 'not_running' }) : original(botId, jobId, body));
        await runJob(orbit);
        expect(seen.actions.filter((a) => a.action === 'handover')).toHaveLength(RUNNER_GUARDS.maxBadTurns);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent' }]);
    });

    it('reads a handover for a job Orbit no longer has (404) as a no, but a request of ours that does not fit (400), a key it does not accept (401), its own failure (500) and an Orbit that is down as ours', async () => {
        const run = async (error: Error) => {
            const { orbit, seen } = fakeOrbit([done('[[handover signin]]')]);
            const original = orbit.action;
            orbit.action = async (botId, jobId, body) => {
                if (body.action === 'handover') throw error;
                return original(botId, jobId, body);
            };
            await runJob(orbit);
            return finished(seen);
        };
        const status = (code: number) => Object.assign(new Error(`status ${code}`), { response: { status: code } });
        expect(await run(status(404))).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent' }]);
        expect(await run(status(400))).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours' }]);
        expect(await run(status(401))).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours' }]);
        expect(await run(status(500))).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours' }]);
        expect(await run(new Error('connect ECONNREFUSED'))).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours' }]);
    });

    it('hands over with exactly what is ready to be put in, waits for the person, and carries on with a look at the page', async () => {
        let looks = 0;
        // running for the first look and the check after the turn, then waiting for the person, then Brick's again
        const states = [{ status: 'running', control: 'brick' }, { status: 'running', control: 'brick' }, { status: 'waiting', control: 'brick' }, { status: 'running', control: 'brick' }];
        const { orbit, seen } = fakeOrbit([done('[[handover details | Your passport number | visa.example.com]]'), done('[[done]]')], () => states[Math.min(looks++, states.length - 1)]);
        await runJob(orbit);
        expect(seen.actions).toContainEqual({ action: 'handover', waitingFor: 'details', ready: { what: 'Your passport number', where: 'visa.example.com' } });
        expect(seen.turns[1]).toBe(RESUME_PROMPT);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
    });

    it('drops what the agent said when the person took over meanwhile, and waits until they hand it back', async () => {
        let looks = 0;
        // the first look is Brick's, after the turn the person has it, then Brick's again
        const states = [{ status: 'running', control: 'brick' }, { status: 'running', control: 'person' }, { status: 'running', control: 'person' }, { status: 'running', control: 'brick' }];
        const { orbit, seen } = fakeOrbit([done('Submitted. [[done]]'), done('[[done]]')], () => states[Math.min(looks++, states.length - 1)]);
        await runJob(orbit);
        // the first "done" was not acted on: the person had the mouse
        expect(finished(seen)).toHaveLength(1);
        expect(seen.turns[1]).toBe(RESUME_PROMPT);
    });

    it('goes on with a look at the page after a turn the take-over cut short', async () => {
        const fenced: RunnerEvent[] = [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'fenced', message: 'The turn was stopped because the person took over' }];
        const { orbit, seen } = fakeOrbit([fenced, done('[[done]]')]);
        await runJob(orbit);
        expect(seen.turns[1]).toBe(RESUME_PROMPT);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
    });

    it('stops without ending anything when the person ended it while the agent worked', async () => {
        let looks = 0;
        const { orbit, seen } = fakeOrbit([done('[[done]]')], () => (looks++ < 1 ? { status: 'running', control: 'brick' } : { status: 'stopped', control: 'brick' }));
        await runJob(orbit);
        expect(finished(seen)).toEqual([]);
    });
});

describe('a turn that is lost, or room that is gone', () => {
    it('reconnects to the turn when the stream breaks, and reads it to its end', async () => {
        const broke: RunnerEvent[] = [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'text', text: 'Half ' }, { type: 'failed', code: 'stream_broke', message: 'broke' }];
        const { orbit, seen } = fakeOrbit([broke, done('Half way. [[done]]')]);
        await runJob(orbit);
        expect(seen.turns).toHaveLength(1);
        expect(seen.streams).toBe(1);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
    });

    it('ends as failed with our cause when the stream keeps breaking and cannot be read again, so the person is not charged for it', async () => {
        const broke = (): RunnerEvent[] => [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'stream_broke', message: 'broke' }];
        // every turn breaks, and each of its two reconnects breaks too
        const { orbit, seen } = fakeOrbit(Array.from({ length: RUNNER_GUARDS.maxBadTurns * 3 }, () => broke()));
        await runJob(orbit);
        expect(seen.turns).toHaveLength(RUNNER_GUARDS.maxBadTurns);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1, 2, 3] }]);
    });

    it('never sends a cause with a job that is done', async () => {
        const { orbit, seen } = fakeOrbit([done('All set. [[done]]')]);
        await runJob(orbit);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
        expect(finished(seen)[0]).not.toHaveProperty('cause');
    });

    it('reads the agent’s own turn when it says it is already working, instead of starting another', async () => {
        const { orbit, seen } = fakeOrbit([{ ok: false, reason: 'busy', responseId: 'r9' }, done('[[done]]')]);
        await runJob(orbit);
        expect(seen.turns).toHaveLength(1);
        expect(seen.streams).toBe(1);
    });

    it('picks up a job whose turn was going (a restart) by reconnecting, not by sending the job again', async () => {
        const { orbit, seen } = fakeOrbit([done('Done now. [[done]]')]);
        await runJob(orbit, { ...JOB, hasTurn: true });
        expect(seen.turns).toEqual([]);
        expect(seen.streams).toBe(1);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
    });

    it('stops the agent when Orbit refuses the renewal with a 4xx, and keeps trying when Orbit cannot be reached or says slow down', async () => {
        const refused = fakeOrbit([done('working')]);
        const original = refused.orbit.action;
        refused.orbit.action = async (botId, jobId, body) => {
            if (body.action === 'renew') throw Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } });
            return original(botId, jobId, body);
        };
        let looks = 0;
        refused.orbit.job = async () => (looks++ < 1 ? { status: 'running', control: 'brick' } : { status: 'stopped', control: 'brick' });
        await runJob(refused.orbit);
        expect(refused.seen.cancels).toBe(1);
        expect(refused.seen.turns).toEqual([]);

        for (const failure of [Object.assign(new Error('down'), {}), Object.assign(new Error('slow'), { response: { status: 429 } }), Object.assign(new Error('bad'), { response: { status: 502 } })]) {
            const kept = fakeOrbit([done('[[done]]')]);
            const run = kept.orbit.action;
            let thrown = false;
            kept.orbit.action = async (botId, jobId, body) => {
                if (body.action === 'renew' && !thrown) {
                    thrown = true;
                    throw failure;
                }
                return run(botId, jobId, body);
            };
            await runJob(kept.orbit);
            expect(kept.seen.cancels).toBe(0);
            expect(kept.seen.turns).toHaveLength(1);
        }
    });

    it('a later renewal that Orbit refuses while a turn stream is open ends that stream, and the next turn is told to look at the page again', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            const { orbit, seen } = fakeOrbit([done('Done. [[done]]')]);
            const original = orbit.action;
            const open = orbit.turn;
            let renewals = 0;
            orbit.action = async (botId, jobId, body) => {
                if (body.action === 'renew') {
                    seen.actions.push(body);
                    // The first renewal is granted for five seconds, the next one is refused
                    if (renewals++ === 0) return { ok: true, renewInSeconds: 5 };
                    throw Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } });
                }
                return original(botId, jobId, body);
            };
            let streamAborted = false;
            let first = true;
            orbit.turn = async (jobId, input, signal) => {
                if (!first) return open(jobId, input, signal);
                first = false;
                seen.turns.push(input);
                // A turn that goes on until it is stopped
                const events = (async function* (): AsyncGenerator<RunnerEvent> {
                    yield { type: 'created', id: 'r', sessionId: 's' };
                    await new Promise<void>((resolve) => signal?.addEventListener('abort', () => ((streamAborted = true), resolve()), { once: true }));
                })();
                return { ok: true, events };
            };
            const running = runJob(orbit);
            await vi.advanceTimersByTimeAsync(5_000);
            await running;
            expect(streamAborted).toBe(true);
            expect(seen.cancels).toBe(1);
            expect(seen.turns).toHaveLength(2);
            expect(seen.turns[1]).toBe(RESUME_PROMPT);
        } finally {
            vi.useRealTimers();
        }
    });

    describe('the control generation of a job (an action from an older turn changes nothing)', () => {
        const stale = (generation: number) => Object.assign(new Error('Request failed with status code 409'), { isAxiosError: true, response: { status: 409, data: { ok: false, reason: 'stale', generation } } });

        it('sends the generation it read when the turn started with every action of that turn: renew, progress, finish', async () => {
            const { orbit, seen } = fakeOrbit(
                [[{ type: 'created', id: 'r', sessionId: 's' }, { type: 'tool', state: 'completed', tool: 'click' }, { type: 'text', text: 'Done. [[done]]' }, { type: 'completed', outputText: 'Done. [[done]]', usage: null }]],
                () => ({ status: 'running', control: 'brick', generation: 7 })
            );
            await runJob(orbit);
            const kinds = ['renew', 'progress', 'finish'];
            for (const kind of kinds) {
                const sent = seen.actions.filter((a) => a.action === kind);
                expect(sent.length, kind).toBeGreaterThan(0);
                for (const body of sent) expect(body.generation, kind).toBe(7);
            }
        });

        it('sends the generation with a handover too', async () => {
            const { orbit, seen } = fakeOrbit([done('Sign in please. [[handover signin]]'), done('Done. [[done]]')]);
            // Brick's before and after the turn, the person's while they sign in, then Brick's again
            let looks = 0;
            orbit.job = async () => {
                const at = looks++;
                return { status: 'running', control: at === 2 ? 'person' : 'brick', generation: 3 };
            };
            await runJob(orbit);
            const handover = seen.actions.find((a) => a.action === 'handover');
            expect(handover).toMatchObject({ action: 'handover', waitingFor: 'signin', generation: 3 });
        });

        it('sends no generation when Orbit gave none (an older Orbit works as before)', async () => {
            const { orbit, seen } = fakeOrbit([done('Done. [[done]]')]);
            await runJob(orbit);
            expect(seen.actions.length).toBeGreaterThan(0);
            for (const body of seen.actions) expect('generation' in body).toBe(false);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
        });

        it('a finish refused as stale ends nothing: the job is read again, and finished with the generation it has now', async () => {
            let generation = 1;
            const { orbit, seen } = fakeOrbit([done('Old turn done. [[done]]'), done('New turn done. [[done]]')], () => ({ status: 'running', control: 'brick', generation }));
            const original = orbit.action;
            let refused = false;
            orbit.action = async (botId, jobId, body) => {
                if (body.action === 'finish' && !refused) {
                    refused = true;
                    seen.actions.push(body);
                    generation = 2;
                    throw stale(2);
                }
                return original(botId, jobId, body);
            };
            await runJob(orbit);
            const finishes = finished(seen);
            expect(finishes).toEqual([
                { action: 'finish', outcome: 'done', generation: 1 },
                { action: 'finish', outcome: 'done', generation: 2 },
            ]);
            // The old turn's words were not the end: another turn was asked for, with the words that tell the agent to look where things stand
            expect(seen.turns).toHaveLength(2);
            expect(seen.turns[1]).toBe(RESUME_PROMPT);
        });

        it('a handover refused as stale is not a failure to hand over: the job is not ended, and the next turn decides', async () => {
            let generation = 1;
            const { orbit, seen } = fakeOrbit([done('Sign in please. [[handover signin]]'), done('All done. [[done]]')], () => ({ status: 'running', control: 'brick', generation }));
            const original = orbit.action;
            let refused = false;
            orbit.action = async (botId, jobId, body) => {
                if (body.action === 'handover' && !refused) {
                    refused = true;
                    seen.actions.push(body);
                    generation = 2;
                    throw stale(2);
                }
                return original(botId, jobId, body);
            };
            await runJob(orbit);
            expect(seen.actions.filter((a) => a.action === 'handover')).toHaveLength(1);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done', generation: 2 }]);
        });

        describe('with the cause of a failure (#2101) and the generation of a turn (#2078) together', () => {
            const status = (code: number) => Object.assign(new Error(`status ${code}`), { response: { status: code } });
            const failing: RunnerEvent[] = [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'model_error', message: 'no' }];

            it('sends a failure with its cause AND the generation of the turn it ends: the agent’s own words, turns of ours, a handover Orbit said no to, one it could not take, and no relay', async () => {
                const at = () => ({ status: 'running', control: 'brick', generation: 4 });
                const agent = fakeOrbit([done('The site is down. [[failed]]')], at);
                await runJob(agent.orbit);
                expect(finished(agent.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', why: 'The site is down.', generation: 4 }]);

                const ours = fakeOrbit([failing, failing, failing], at);
                await runJob(ours.orbit);
                expect(finished(ours.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', generation: 4, turns: [1, 2, 3] }]);

                for (const [error, cause] of [[status(404), 'agent'], [status(500), 'ours']] as const) {
                    const handover = fakeOrbit([done('[[handover signin]]')], at);
                    const original = handover.orbit.action;
                    handover.orbit.action = async (botId, jobId, body) => {
                        if (body.action === 'handover') throw error;
                        return original(botId, jobId, body);
                    };
                    await runJob(handover.orbit);
                    expect(finished(handover.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause, generation: 4 }]);
                }

                // no relay: nothing is read of the job yet, so no generation, and the failure is ours
                const none = fakeOrbit([], at);
                await runJob(none.orbit, JOB, null);
                expect(finished(none.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours' }]);
            });

            it('a failure refused as stale ends nothing, and the job is read again: the next failure names its cause with the generation it has now', async () => {
                let generation = 1;
                // The refusal says the job changed hands: the streak of the three failed turns is cleared, so three new failed turns are needed to end it
                const { orbit, seen } = fakeOrbit([failing, failing, failing, failing, failing, failing], () => ({ status: 'running', control: 'brick', generation }));
                const original = orbit.action;
                let refused = false;
                orbit.action = async (botId, jobId, body) => {
                    if (body.action === 'finish' && !refused) {
                        refused = true;
                        seen.actions.push(body);
                        generation = 2;
                        throw stale(2);
                    }
                    return original(botId, jobId, body);
                };
                await runJob(orbit);
                expect(finished(seen)).toEqual([
                    { action: 'finish', outcome: 'failed', cause: 'ours', generation: 1, turns: [1, 2, 3] },
                    { action: 'finish', outcome: 'failed', cause: 'ours', generation: 2, turns: [4, 5, 6] },
                ]);
            });

            it('the agent’s own failure refused as stale is read again, and a new turn that says it is done ends done with the new generation and no cause', async () => {
                let generation = 1;
                const { orbit, seen } = fakeOrbit([done('Stuck. [[failed]]'), done('All fine. [[done]]')], () => ({ status: 'running', control: 'brick', generation }));
                const original = orbit.action;
                let refused = false;
                orbit.action = async (botId, jobId, body) => {
                    if (body.action === 'finish' && !refused) {
                        refused = true;
                        seen.actions.push(body);
                        generation = 2;
                        throw stale(2);
                    }
                    return original(botId, jobId, body);
                };
                await runJob(orbit);
                expect(finished(seen)).toEqual([
                    { action: 'finish', outcome: 'failed', cause: 'agent', why: 'Stuck.', generation: 1 },
                    { action: 'finish', outcome: 'done', generation: 2 },
                ]);
            });

            it('a refusal the relay saw still makes a streak of failed turns the agent’s, on a job whose turns carry a generation', async () => {
                const { orbit, seen } = fakeOrbit([failing, failing, failing], () => ({ status: 'running', control: 'brick', generation: 9 }));
                await runJob(orbit, JOB, RELAY, { sawSince: () => true });
                expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', generation: 9, turns: [1, 2, 3] }]);
            });
        });

        it('a renewal refused as stale stops the old turn and reads the job again', async () => {
            let generation = 1;
            const { orbit, seen } = fakeOrbit([done('old'), done('Done. [[done]]')], () => ({ status: 'running', control: 'brick', generation }));
            const original = orbit.action;
            let refused = false;
            orbit.action = async (botId, jobId, body) => {
                if (body.action === 'renew' && !refused) {
                    refused = true;
                    seen.actions.push(body);
                    generation = 2;
                    throw stale(2);
                }
                return original(botId, jobId, body);
            };
            await runJob(orbit);
            expect(seen.cancels).toBe(1);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done', generation: 2 }]);
        });

        it('a progress report refused as stale stops the old turn: its words are not acted on', async () => {
            let generation = 1;
            const stepped: RunnerEvent[] = [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'tool', state: 'completed', tool: 'click' }, { type: 'text', text: 'Old words. [[done]]' }, { type: 'completed', outputText: 'Old words. [[done]]', usage: null }];
            const { orbit, seen } = fakeOrbit([stepped, done('New words. [[done]]')], () => ({ status: 'running', control: 'brick', generation }));
            const original = orbit.action;
            let refused = false;
            orbit.action = async (botId, jobId, body) => {
                if (body.action === 'progress' && !refused) {
                    refused = true;
                    seen.actions.push(body);
                    generation = 2;
                    throw stale(2);
                }
                return original(botId, jobId, body);
            };
            await runJob(orbit);
            expect(seen.cancels).toBe(1);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done', generation: 2 }]);
            // The stopped turn is not reconnected to: the agent is told to look at the page again, not just to carry on (Sentry)
            expect(seen.turns[1]).toBe(RESUME_PROMPT);
        });

        it('a final progress report refused as stale, with no step reported before it, also stops the old turn: its ending is not acted on', async () => {
            let generation = 1;
            let reads = 0;
            // No tool step: the closing report is the first one the job answers
            const quiet: RunnerEvent[] = [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'text', text: 'Old words. [[done]]' }, { type: 'completed', outputText: 'Old words. [[done]]', usage: null }];
            // Orbit cannot be asked for the three reads after the turn: a lost turn must still be told to look at the page, not just to carry on
            const { orbit, seen } = fakeOrbit([quiet, done('New words. [[done]]')], () => (++reads >= 2 && reads <= 4 ? (undefined as never) : { status: 'running', control: 'brick', generation }));
            const original = orbit.action;
            let refused = false;
            orbit.action = async (botId, jobId, body) => {
                if (body.action === 'progress' && !refused) {
                    refused = true;
                    seen.actions.push(body);
                    generation = 2;
                    throw stale(2);
                }
                return original(botId, jobId, body);
            };
            await runJob(orbit);
            expect(seen.cancels).toBe(1);
            // Only the turn that started on the job's generation now finishes it
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done', generation: 2 }]);
            expect(seen.turns[1]).toBe(RESUME_PROMPT);
        });

        it('a turn the job moved on from while it went (taken and given back) is not acted on, even though the job is Brick\'s again', async () => {
            const generations = [1, 2, 2, 2, 2, 2];
            let at = 0;
            const { orbit, seen } = fakeOrbit([done('Old words. [[done]]'), done('New words. [[done]]')], () => ({ status: 'running', control: 'brick', generation: generations[Math.min(at++, generations.length - 1)] }));
            await runJob(orbit);
            // The first turn started on 1 and was over on 2: no finish was sent for it
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done', generation: 2 }]);
            expect(seen.turns[1]).toBe(RESUME_PROMPT);
        });

        it('a job taken and given back after a turn\'s closing read is not told to just carry on: the agent looks at the page first', async () => {
            // The turn started on 1 and the closing read says 1 too; the person then takes the machine and gives it back, so the next turn starts on 3
            const generations = [1, 1, 3, 3, 3, 3];
            let at = 0;
            const { orbit, seen } = fakeOrbit([done('Still working.'), done('All done. [[done]]')], () => ({ status: 'running', control: 'brick', generation: generations[Math.min(at++, generations.length - 1)] }));
            await runJob(orbit);
            expect(seen.turns).toHaveLength(2);
            expect(seen.turns[1]).toBe(RESUME_PROMPT);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done', generation: 3 }]);
        });

        it('a job that stays on its generation between turns is still told to carry on', async () => {
            const { orbit, seen } = fakeOrbit([done('Still working.'), done('All done. [[done]]')], () => ({ status: 'running', control: 'brick', generation: 5 }));
            await runJob(orbit);
            expect(seen.turns[1]).toBe(CONTINUE_PROMPT);
        });

        it('getComputerJob passes the generation on, and leaves it out when Orbit gives none or something that is no generation', async () => {
            const service = Object.create(AdminApiService.prototype) as { getComputerJob: AdminApiService['getComputerJob']; brickCall: unknown };
            const answer = (job: Record<string, unknown>) => {
                service.brickCall = vi.fn(async () => ({ data: { job: { id: 'j', status: 'running', control: 'brick', ...job } } }));
            };
            answer({ generation: 4 });
            expect(await service.getComputerJob('b', 'j')).toEqual({ id: 'j', status: 'running', control: 'brick', generation: 4 });
            answer({});
            expect(await service.getComputerJob('b', 'j')).toEqual({ id: 'j', status: 'running', control: 'brick' });
            for (const bad of ['4', -1, 1.5, null]) {
                answer({ generation: bad });
                expect(await service.getComputerJob('b', 'j')).toEqual({ id: 'j', status: 'running', control: 'brick' });
            }
        });
    });

    it('stops the agent and ends nothing itself when Orbit says the room is gone', async () => {
        const { orbit, seen, setRenew } = fakeOrbit([done('working')], () => ({ status: 'running', control: 'brick' }));
        setRenew(() => ({ ok: false, reason: 'allowance' }));
        let looks = 0;
        orbit.job = async () => (looks++ < 1 ? { status: 'running', control: 'brick' } : { status: 'stopped', control: 'brick' });
        await runJob(orbit);
        expect(seen.cancels).toBe(1);
        expect(seen.turns).toEqual([]);
        expect(finished(seen)).toEqual([]);
    });

    it('tries to get the machine ready again, then ends as failed; and looks again when the job is not Brick’s to work on', async () => {
        const a = fakeOrbit([]);
        a.setPrepare(() => ({ ok: false, reason: 'failed' }));
        await runJob(a.orbit);
        expect(a.seen.prepares).toHaveLength(3);
        expect(a.seen.turns).toEqual([]);
        expect(finished(a.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours' }]);

        let looks = 0;
        const b = fakeOrbit([done('[[done]]')]);
        b.setPrepare(() => (looks++ < 2 ? { ok: false, reason: 'person_has_it' } : { ok: true }));
        await runJob(b.orbit);
        expect(b.seen.prepares).toHaveLength(3);
        expect(finished(b.seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
    });
});

describe('the supervisor', () => {
    it('works a job once, however many times it looks, and stops reading when stopped (the turn goes on)', async () => {
        let release: () => void = () => undefined;
        const holding = new Promise<void>((resolve) => (release = resolve));
        const { orbit, seen } = fakeOrbit([
            () => ({
                ok: true,
                events: (async function* () {
                    yield { type: 'created', id: 'r', sessionId: 's' } as RunnerEvent;
                    await holding;
                })(),
            }),
        ]);
        const runner = createComputerRunner({ orbit, relayUrl: RELAY, log: quiet, timing: { waitMs: 0, progressMs: 0, reconnectMs: [0], prepareMs: [0] } });
        await runner.tick();
        await vi.waitFor(() => expect(seen.turns).toHaveLength(1));
        await runner.tick();
        await runner.tick();
        expect(runner.active()).toEqual(['job-1']);
        expect(seen.turns).toHaveLength(1);
        runner.stop();
        release();
        await runner.idle();
        expect(runner.active()).toEqual([]);
        // stopped: nothing was ended, nothing cancelled, and it does not look again
        expect(finished(seen)).toEqual([]);
        expect(seen.cancels).toBe(0);
        await runner.tick();
        expect(runner.active()).toEqual([]);
    });

    it('does not throw when Orbit cannot be asked for jobs', async () => {
        const { orbit } = fakeOrbit([]);
        orbit.running = async () => {
            throw new Error('down');
        };
        const runner = createComputerRunner({ orbit, relayUrl: RELAY, log: quiet });
        await expect(runner.tick()).resolves.toBeUndefined();
    });

    it('never works on more jobs at once than its guard', async () => {
        const jobs = Array.from({ length: RUNNER_GUARDS.maxJobs + 5 }, (_, i) => ({ ...JOB, jobId: `j${i}` }));
        const { orbit } = fakeOrbit([]);
        orbit.running = async () => jobs;
        orbit.job = async () => new Promise(() => undefined);
        const runner = createComputerRunner({ orbit, relayUrl: RELAY, log: quiet });
        await runner.tick();
        expect(runner.active()).toHaveLength(RUNNER_GUARDS.maxJobs);
        runner.stop();
    });
});

describe('reading Orbit’s events', () => {
    const body = (...parts: string[]) =>
        new ReadableStream<Uint8Array>({
            start(controller) {
                const encoder = new TextEncoder();
                for (const part of parts) controller.enqueue(encoder.encode(part));
                controller.close();
            },
        });
    const frame = (event: Record<string, unknown>) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    const all = async (stream: ReadableStream<Uint8Array>) => {
        const seen: RunnerEvent[] = [];
        for await (const event of readRunnerEvents(stream)) seen.push(event);
        return seen;
    };

    it('reads a whole turn, including a frame that arrives in pieces and a keep-alive line', async () => {
        const text = frame({ type: 'text', text: 'Hel' });
        const seen = await all(
            body(
                ': keepalive\n\n',
                frame({ type: 'created', id: 'r', sessionId: 's' }),
                text.slice(0, 9),
                text.slice(9),
                frame({ type: 'tool', state: 'started', tool: 'browser', label: 'Opening', extra: { command: 'secret' } }),
                frame({ type: 'completed', outputText: 'Hello', usage: { inputTokens: 1, outputTokens: 2 } })
            )
        );
        expect(seen).toEqual([
            { type: 'created', id: 'r', sessionId: 's' },
            { type: 'text', text: 'Hel' },
            { type: 'tool', state: 'started', tool: 'browser', label: 'Opening' },
            { type: 'completed', outputText: 'Hello', usage: { inputTokens: 1, outputTokens: 2 } },
        ]);
    });

    it('ends at the first terminal event, and says so when the stream closes before one', async () => {
        expect((await all(body(frame({ type: 'failed', code: 'fenced', message: 'x' }), frame({ type: 'text', text: 'after' })))).map((e) => e.type)).toEqual(['failed']);
        expect((await all(body(frame({ type: 'text', text: 'half' }))).then((list) => list.at(-1)))).toMatchObject({ type: 'failed', code: 'stream_ended' });
        expect(await all(body(`event: completed\ndata: ${JSON.stringify({ type: 'completed', outputText: 'end', usage: null })}`))).toEqual([{ type: 'completed', outputText: 'end', usage: null }]);
    });

    it('drops a stream that sends too much without a newline, or too many data lines without a blank one', async () => {
        const chunk = 'x'.repeat(256 * 1024);
        const noNewline = await all(body(frame({ type: 'created', id: 'r', sessionId: 's' }), ...Array.from({ length: 6 }, () => chunk)));
        expect(noNewline.map((e) => e.type)).toEqual(['created', 'failed']);
        expect(noNewline.at(-1)).toMatchObject({ type: 'failed', code: 'stream_broke' });
        const line = `data: ${'y'.repeat(streamLimits.line / 2)}\n`;
        const noBlank = await all(body(frame({ type: 'created', id: 'r', sessionId: 's' }), ...Array.from({ length: 12 }, () => line)));
        expect(noBlank.map((e) => e.type)).toEqual(['created', 'failed']);
        expect(noBlank.at(-1)).toMatchObject({ code: 'stream_broke' });
    });

    it('drops a stream whose unfinished last line is too big, however much came before it in the same piece, or that pushes an event past its bound at the end', async () => {
        const big = 'x'.repeat(streamLimits.line + 10);
        const afterHeader = await all(body(frame({ type: 'created', id: 'r', sessionId: 's' }), `event: text\ndata: ${big}`));
        expect(afterHeader.map((e) => e.type)).toEqual(['created', 'failed']);
        expect(afterHeader.at(-1)).toMatchObject({ code: 'stream_broke' });
        // Seven lines of about half a megabyte fit an event; an eighth, with no newline at the end of the stream, does not
        const line = `data: ${'y'.repeat(streamLimits.line / 2)}`;
        const atTheEnd = await all(body(frame({ type: 'created', id: 'r', sessionId: 's' }), ...Array.from({ length: 7 }, () => `${line}\n`), line));
        expect(atTheEnd.map((e) => e.type)).toEqual(['created', 'failed']);
        expect(atTheEnd.at(-1)).toMatchObject({ code: 'stream_broke' });
    });

    it('keeps the end of a reply that is too long, where the marker that says how it ended is', () => {
        const long = `${'x'.repeat(250_000)} [[done]]`;
        const event = runnerEventOf(JSON.stringify({ type: 'completed', outputText: long, usage: null }));
        expect(event).toMatchObject({ type: 'completed' });
        const kept = (event as { outputText: string }).outputText;
        expect(kept).toHaveLength(200_000);
        expect(kept.endsWith('[[done]]')).toBe(true);
    });

    it('leaves out what it cannot read', () => {
        expect(runnerEventOf('not json')).toBeNull();
        expect(runnerEventOf(JSON.stringify({ type: 'created' }))).toBeNull();
        expect(runnerEventOf(JSON.stringify({ type: 'tool', state: 'mystery', tool: 'x' }))).toBeNull();
        expect(runnerEventOf(JSON.stringify({ type: 'surprise' }))).toBeNull();
    });
});

describe('the bot server’s calls to Orbit', () => {
    it('opens a turn for the runner and says why when Orbit did not', async () => {
        const encoder = new TextEncoder();
        const admin = {
            computerRunningJobs: vi.fn(async () => [JOB]),
            getComputerJob: vi.fn(async () => ({ id: 'job-1', status: 'running', control: 'brick' })),
            computerJobAction: vi.fn(async () => ({})),
            computerBroker: vi.fn(async (_id: string, step: string, _body?: unknown) => (step === 'prepare' ? { status: 409, data: { ok: false, reason: 'person_has_it' } } : { status: 200, data: {} })),
            computerOpenTurn: vi.fn(async (_id: string, step: string) =>
                step === 'turn'
                    ? { ok: false as const, status: 409, reason: 'busy', responseId: 'r9' }
                    : { ok: true as const, body: new ReadableStream<Uint8Array>({ start: (c) => { c.enqueue(encoder.encode(`event: completed\ndata: ${JSON.stringify({ type: 'completed', outputText: 'x', usage: null })}\n\n`)); c.close(); } }) }
            ),
        };
        const orbit = runnerOrbitFor(admin as never);
        expect(await orbit.job('b', 'j')).toEqual({ status: 'running', control: 'brick' });
        expect(await orbit.prepare('j', RELAY)).toEqual({ ok: false, reason: 'person_has_it' });
        expect(await orbit.turn('j', 'hi', new AbortController().signal)).toEqual({ ok: false, reason: 'busy', responseId: 'r9' });
        const reattached = await orbit.stream('j', new AbortController().signal);
        if (!('events' in reattached)) throw new Error('no stream');
        const seen: RunnerEvent[] = [];
        for await (const event of reattached.events) seen.push(event);
        expect(seen).toEqual([{ type: 'completed', outputText: 'x', usage: null }]);
        // a server error is "failed", never a reason of Orbit's own
        admin.computerBroker.mockResolvedValueOnce({ status: 502, data: { ok: false, reason: 'failed' } });
        expect(await orbit.prepare('j', RELAY)).toEqual({ ok: false, reason: 'failed' });
        // the run goes with the address, and nothing else is added
        admin.computerBroker.mockClear();
        await orbit.prepare('j', RELAY);
        await orbit.prepare('j', RELAY, { run: 'run1' });
        expect(admin.computerBroker.mock.calls.map((call) => [call[1], call[2]])).toEqual([
            ['prepare', { relay: RELAY }],
            ['prepare', { relay: RELAY, run: 'run1' }],
        ]);
    });

    it('reads every page of the running jobs, and stops when a page gives no way forward', async () => {
        const service = Object.create(AdminApiService.prototype) as { computerRunningJobs: AdminApiService['computerRunningJobs']; brickCall: unknown };
        const job = (id: string) => ({ jobId: id, botId: 'b', title: 'T', brief: null, writes: true, hasTurn: false });
        const pages: Record<string, unknown> = {
            '': { jobs: [job('a'), job('b')], nextCursor: 'c1' },
            c1: { jobs: [job('b'), job('c')], nextCursor: 'c2' },
            c2: { jobs: [job('d')], nextCursor: null },
        };
        const asked: Array<Record<string, string> | undefined> = [];
        service.brickCall = async (_method: string, _path: string, _body: unknown, params?: Record<string, string>) => {
            asked.push(params);
            return { data: pages[params?.cursor ?? ''] };
        };
        expect((await service.computerRunningJobs()).map((j) => j.jobId)).toEqual(['a', 'b', 'c', 'd']);
        expect(asked).toEqual([undefined, { cursor: 'c1' }, { cursor: 'c2' }]);
        // a cursor that does not move on ends the walk
        let calls = 0;
        service.brickCall = async () => {
            calls++;
            return { data: { jobs: [job('x')], nextCursor: 'same' } };
        };
        expect((await service.computerRunningJobs()).map((j) => j.jobId)).toEqual(['x']);
        expect(calls).toBe(2);
    });

    it('says a job is gone only when Orbit says so (404); a hiccup is an error the runner waits out', async () => {
        const service = Object.create(AdminApiService.prototype) as { getComputerJob: AdminApiService['getComputerJob']; brickCall: unknown };
        const answer = { value: undefined as unknown };
        service.brickCall = async () => {
            if (answer.value instanceof Error) throw answer.value;
            return { data: answer.value };
        };
        const http = (status: number) => Object.assign(new Error(`status ${status}`), { isAxiosError: true, response: { status } });
        answer.value = { job: { id: 'j', status: 'running', control: 'brick' } };
        expect(await service.getComputerJob('b', 'j')).toEqual({ id: 'j', status: 'running', control: 'brick' });
        answer.value = http(404);
        expect(await service.getComputerJob('b', 'j')).toBeNull();
        answer.value = http(502);
        await expect(service.getComputerJob('b', 'j')).rejects.toThrow('status 502');
        answer.value = new Error('socket hang up');
        await expect(service.getComputerJob('b', 'j')).rejects.toThrow('hang up');
    });

    it('takes the relay address from its own setting, else the bot server’s public address, without a trailing slash or /v1', () => {
        expect(relayUrlFromEnv({ COMPUTER_RELAY_URL: 'https://relay.example.test/', BOT_SERVER_URL: 'https://other.example.test' } as never)).toBe('https://relay.example.test');
        expect(relayUrlFromEnv({ BOT_SERVER_URL: 'https://bot-server.example.test/v1/' } as never)).toBe('https://bot-server.example.test');
        expect(relayUrlFromEnv({} as never)).toBeNull();
        // A chosen value that is no address (a bare host, a path) is refused, never handed to a machine
        expect(relayUrlFromEnv({ COMPUTER_RELAY_URL: 'bot.example.test' } as never)).toBeNull();
        expect(relayUrlFromEnv({ BOT_SERVER_URL: '/bot' } as never)).toBeNull();
        // Else the play server's public https address implies it, the first name replaced; an internal or bare address implies nothing
        expect(relayUrlFromEnv({ PUSHER_URL: 'https://play.example.test' } as never)).toBe('https://bot-server.example.test');
        expect(relayUrlFromEnv({ WORKADVENTURE_URL: 'https://play.dev.example.test:8443/' } as never)).toBe('https://bot-server.dev.example.test:8443');
        expect(relayUrlFromEnv({ PUSHER_URL: 'http://pusher:8080' } as never)).toBeNull();
        expect(relayUrlFromEnv({ PUSHER_URL: 'http://play.example.test' } as never)).toBeNull();
        expect(relayUrlFromEnv({ PUSHER_URL: 'https://10.0.0.5' } as never)).toBeNull();
        expect(relayUrlFromEnv({ PUSHER_URL: 'nonsense' } as never)).toBeNull();
    });
});

describe('whyOf: the one sentence the agent gave for why it could not go on', () => {
    it('redacts the whole sentence before it is cut to its length: a cut through an assignment must not leave its value showing', () => {
        const words = `PASSWORD=hunter2 ${'x '.repeat(144)}tail [[failed]]`;
        const why = whyOf(words) ?? '';
        expect(why).not.toContain('hunter2');
        expect(why.length).toBeLessThanOrEqual(300);
        expect(why.endsWith('tail')).toBe(true);
        // the same when the value is a key by its shape, or a header
        const key = `Authorization: Bearer ${'k'.repeat(24)}1 ${'y '.repeat(150)}end [[failed]]`;
        expect(whyOf(key)).not.toMatch(/k{8}/);
    });

    it('redacts the text BEFORE it is split into sentences: a stop or a line break inside a quoted secret value is no end of a sentence, and no fragment of the value stands as the reason', () => {
        for (const words of [
            'The login failed with PASSWORD="hunter. Two3 secret" [[failed]]',
            'The login failed with PASSWORD="hunter.\nTwo3 secret" [[failed]]',
            "Tried it. The command export API_TOKEN='abc! Zed9 hidden' did not work [[failed]]",
        ]) {
            const why = whyOf(words) ?? '';
            expect(why, words).not.toMatch(/Two3|secret|Zed9|hidden'/);
            expect(why, words).toContain('[hidden]');
        }
        expect(whyOf('The login failed with PASSWORD="hunter. Two3 secret" [[failed]]')).toBe('The login failed with PASSWORD=[hidden]');
        // the limit is on the redacted result
        const long = whyOf(`${'word '.repeat(100)}PASSWORD="a. B ${'c '.repeat(200)}" ${'tail '.repeat(100)}[[failed]]`) ?? '';
        expect(long.length).toBeLessThanOrEqual(300);
        expect(long).not.toMatch(/PASSWORD="a/);
    });

    it('redacts a value that has a marker written inside it BEFORE the markers are taken out, so no half of the value is left standing', () => {
        for (const words of [
            'PASSWORD=[[note]]demo-value [[failed]]',
            'The step used PASSWORD=[[note]]demo-value [[failed]]',
            'Ran export API_TOKEN=[[x]]abc123def456 and then it stopped. [[failed]]',
            'Tried. The header was Authorization: Bearer [[a]]zz9yy8xx7ww6 and it failed [[failed]]',
        ]) {
            const why = whyOf(words) ?? '';
            expect(why, words).not.toMatch(/demo-value|abc123def456|zz9yy8xx7ww6|\*\*\*REDACTED/);
            expect(why, words).toContain('[hidden]');
        }
        // markers that stand alone are still taken out
        expect(whyOf('Tried. [[done]] Then the site is down [[note]] again. [[failed]]')).toBe('Then the site is down again.');
    });

    it('is the last sentence before the failed marker', () => {
        expect(whyOf('I opened the form. The site stopped me at the passport upload and kept showing an error. [[failed]]')).toBe('The site stopped me at the passport upload and kept showing an error.');
        expect(whyOf('First line\nThe site is down [[failed]]')).toBe('The site is down');
        expect(whyOf('Tried twice. [[done]] Then the site is down. [[failed]]')).toBe('Then the site is down.');
    });

    it('does not cut a sentence at a stop inside a file name or a number', () => {
        expect(whyOf('Tried the upload. The site rejected passport.pdf at version 3.5 and kept showing an error. [[failed]]')).toBe('The site rejected passport.pdf at version 3.5 and kept showing an error.');
        expect(whyOf('The form wants e.g. a scan of the passport and I have none [[failed]]')).toBe('The form wants e.g. a scan of the passport and I have none');
    });

    it('is empty when nothing came before the marker, or there is no failed marker', () => {
        expect(whyOf('[[failed]]')).toBeNull();
        expect(whyOf('All good [[done]]')).toBeNull();
        expect(whyOf('')).toBeNull();
    });

    it('is cut to the last 300 characters, so a runaway reply is not sent whole', () => {
        const long = whyOf(`${'word '.repeat(200)}[[failed]]`);
        expect(long && long.length).toBeLessThanOrEqual(300);
    });
});

describe('which turns of a failed streak are named, and whose the ending is, from the relay’s call record', () => {
    const failing = (): RunnerEvent[] => [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'model_error', message: 'no' }];

    it('names the turns the streak was made of, and what the relay recorded for the job reaches Orbit before the finish does', async () => {
        const order: string[] = [];
        const { orbit, seen } = fakeOrbit([done('Working on it'), failing(), failing(), failing()]);
        const original = orbit.action;
        orbit.action = async (botId, jobId, body) => {
            if (body.action === 'finish') order.push('finish');
            return original(botId, jobId, body);
        };
        await runJob(orbit, JOB, RELAY, {
            sawSince: () => false,
            flush: async () => {
                order.push('flush');
                return true;
            },
        });
        // the good turn started the count again: the streak is turns 2, 3 and 4
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [2, 3, 4] }]);
        expect(order).toEqual(['flush', 'finish']);
    });

    it('does not name turns for a failure that was no streak (the agent’s own words, no relay), and still sends the record first', async () => {
        const flushed: string[] = [];
        const a = fakeOrbit([done('Stuck. [[failed]]')]);
        await runJob(a.orbit, JOB, RELAY, { sawSince: () => false, flush: async (jobId) => (flushed.push(jobId), true) });
        expect(finished(a.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', why: 'Stuck.' }]);
        expect(flushed).toEqual([JOB.jobId]);
        // a job that finishes well has no use for the record
        flushed.length = 0;
        const b = fakeOrbit([done('All fine. [[done]]')]);
        await runJob(b.orbit, JOB, RELAY, { sawSince: () => false, flush: async (jobId) => (flushed.push(jobId), true) });
        expect(flushed).toEqual([]);
    });

    it('ends the job whatever happens to the record: a flush that throws or never says yes does not keep a job from ending', async () => {
        const a = fakeOrbit([failing(), failing(), failing()]);
        await runJob(a.orbit, JOB, RELAY, { sawSince: () => false, flush: () => Promise.reject(new Error('orbit is down')) });
        expect(finished(a.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1, 2, 3] }]);
        const b = fakeOrbit([failing(), failing(), failing()]);
        await runJob(b.orbit, JOB, RELAY, { sawSince: () => false, flush: async () => false });
        expect(finished(b.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1, 2, 3] }]);
    });

    it('numbers a turn when it begins, tells the relay, and keeps the number while the same turn is read again after a reconnect', async () => {
        const told: number[] = [];
        const { orbit } = fakeOrbit([done('one'), done('two'), done('[[done]]')]);
        await runJob(orbit, JOB, RELAY, { sawSince: () => false, turn: (_job, n) => void told.push(n) });
        expect(Array.from(new Set(told))).toEqual([1, 2, 3]);
    });

    it('is ours when a bad turn of the streak had a confirmed fault, even after a silent one: silent first, then two documented failures on our key', async () => {
        // a fake that answers by the turn the runner said it is on, so it gives the same answer however often it is asked
        let turnNo = 0;
        // turn 1 says nothing; turns 2 and 3 ended on a fault of ours that the relay recorded as confirmed (our key refused)
        const refusals = {
            sawSince: () => false,
            turn: (_job: string, n: number) => void (turnNo = n),
            endedOnFault: () => turnNo > 1,
            confirmedSince: () => turnNo > 1,
        };
        const { orbit, seen } = fakeOrbit([done(''), done('The model said no'), done('The model said no')]);
        await runJob(orbit, JOB, RELAY, refusals);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1, 2, 3] }]);
    });

    it('is the agent’s when a confirmed fault of the streak was recovered in its own turn (a call answered after it) and the turns then said nothing', async () => {
        let t = 0;
        const clock = () => ++t;
        const confirmedFault = (notes: ReturnType<typeof createRefusalNotes>) =>
            notes.record('bot', JOB.jobId, { callId: `c${t}`, kind: 'fault', reason: 'provider_key_ours', source: 'universe-ai', route: 'r', providerStatus: 401 });
        const silentTurn = (notes: ReturnType<typeof createRefusalNotes>, recovered: boolean) => () => {
            confirmedFault(notes);
            if (recovered) notes.answered(JOB.jobId);
            return [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'completed', outputText: '', usage: null }] as RunnerEvent[];
        };
        for (const [recovered, cause] of [[true, 'agent'], [false, 'ours']] as const) {
            const notes = createRefusalNotes(clock);
            const { orbit, seen } = fakeOrbit(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => silentTurn(notes, recovered)));
            const runner = createComputerRunner({ orbit, relayUrl: RELAY, sleep: instantly, log: quiet, now: clock, refusals: notes, timing: { waitMs: 0, progressMs: 0, reconnectMs: [0, 0], prepareMs: [0, 0] } });
            orbit.running = async () => [JOB];
            await runner.tick();
            await runner.idle();
            expect(finished(seen), `recovered ${recovered}`).toEqual([{ action: 'finish', outcome: 'failed', cause, turns: [1, 2, 3] }]);
        }
    });

    it('stays the agent’s for a silent turn and unresolved faults only (nothing confirmed), and for a streak the person’s allowance or a rule stopped', async () => {
        let turnNo = 0;
        const unresolved = { sawSince: () => false, turn: (_job: string, n: number) => void (turnNo = n), endedOnFault: () => turnNo > 1, confirmedSince: () => false };
        const a = fakeOrbit([done(''), done('The model did not answer'), done('The model did not answer')]);
        await runJob(a.orbit, JOB, RELAY, unresolved);
        expect(finished(a.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [1, 2, 3] }]);

        // a spending rule or the allowance stops the job as the person's, even when a fault was confirmed in a turn of its own
        const b = fakeOrbit([failing(), failing(), failing()]);
        await runJob(b.orbit, JOB, RELAY, { sawSince: () => true, confirmedSince: () => false });
        expect(finished(b.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [1, 2, 3] }]);
    });

    it('names the run its turns were numbered in, so a restart that numbers turns from 1 again is never read as the same turns', async () => {
        const failing = (): RunnerEvent[] => [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'model_error', message: 'no' }];
        const told: Array<[number, string | undefined]> = [];
        const refusals = { sawSince: () => false, turn: (_jobId: string, turn: number, run?: string) => void told.push([turn, run]) };
        // The first run of the bot server on the job...
        const first = fakeOrbit([failing(), failing(), failing()]);
        await runJob(first.orbit, JOB, RELAY, refusals, () => 'run-first');
        // ...and after a restart a second one takes the job up again: its turns are numbered from 1 again, in a run of its own
        const second = fakeOrbit([failing(), failing(), failing()]);
        await runJob(second.orbit, JOB, RELAY, refusals, () => 'run-second');
        expect(finishedWithRun(first.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1, 2, 3], run: 'run-first' }]);
        expect(finishedWithRun(second.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1, 2, 3], run: 'run-second' }]);
        // The relay is told the run with each turn, so the rows of its calls carry it
        expect(told).toEqual([[1, 'run-first'], [2, 'run-first'], [3, 'run-first'], [1, 'run-second'], [2, 'run-second'], [3, 'run-second']]);
    });

    it('gives each run of a job a run of its own when none is named: two runs never share one', async () => {
        const runs = new Set<string | undefined>();
        const refusals = { sawSince: () => false, turn: (_jobId: string, _turn: number, run?: string) => void runs.add(run) };
        for (let i = 0; i < 5; i++) {
            const { orbit } = fakeOrbit([done('All fine. [[done]]')]);
            // eslint-disable-next-line no-await-in-loop
            await runJob(orbit, JOB, RELAY, refusals);
        }
        expect(runs.size).toBe(5);
        expect([...runs].every((run) => typeof run === 'string' && /^[0-9a-z]{9,}$/.test(run))).toBe(true);
    });

    it('does not carry a silent turn from before the person had the machine into the next streak: three turns that are ours end ours', async () => {
        const failing = (): RunnerEvent[] => [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'model_error', message: 'no' }];
        let generation = 1;
        const { orbit, seen } = fakeOrbit(
            [
                // two silent turns (the agent's own, never ours), then a turn during which the person took the machine and gave it back
                done(''),
                done(''),
                () => ((generation = 2), done('')),
                // a new streak: three turns that failed for no reason but ours
                failing(),
                failing(),
                failing(),
            ],
            () => ({ status: 'running', control: 'brick', generation })
        );
        await runJob(orbit);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', generation: 2, turns: [4, 5, 6] }]);
    });

    // The real notes on a clock that never moves: every event lands in the same millisecond, so only the order of events can tell the turns apart
    const sameMillisecond = () => {
        const notes = createRefusalNotes(() => 1000);
        const call = (callId: string, kind: 'fault' | 'not_ours' | 'answered', reason: 'provider_key_ours' | 'allowance' | 'provider_5xx') => notes.record('bot', JOB.jobId, { callId, kind, reason, source: 'universe-ai', route: 'universe-ai:p', providerStatus: null });
        const run = async (orbit: RunnerOrbit) => {
            const runner = createComputerRunner({ orbit, relayUrl: RELAY, sleep: instantly, log: quiet, now: () => 1000, timing: { waitMs: 0, progressMs: 0, reconnectMs: [0, 0], prepareMs: [0, 0] }, refusals: notes });
            orbit.running = async () => [JOB];
            await runner.tick();
            await runner.idle();
        };
        return { notes, call, run };
    };

    it('does not read a refusal of the turn before as one of this turn, even when both began in the same millisecond', async () => {
        const { call, run } = sameMillisecond();
        const failing = (): RunnerEvent[] => [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'model_error', message: 'no' }];
        // turn 1 recovered after the person's allowance refused a call; turns 2 to 4 failed for no reason of the person's
        const { orbit, seen } = fakeOrbit([() => (call('c1', 'not_ours', 'allowance'), done('Worked round it')), failing(), failing(), failing()]);
        await run(orbit);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [2, 3, 4] }]);
    });

    it('does not read a confirmed fault of the turn before as one of this turn, even when both began in the same millisecond', async () => {
        const { call, run } = sameMillisecond();
        // turn 1 had a confirmed fault and then a good answer; turns 2 to 4 are silent turns, the agent's own
        const { orbit, seen } = fakeOrbit([() => (call('c1', 'fault', 'provider_key_ours'), call('c1b', 'answered', 'provider_5xx'), done('Worked round it')), () => (call('c2', 'answered', 'provider_5xx'), done('')), () => (call('c3', 'answered', 'provider_5xx'), done('')), () => (call('c4', 'answered', 'provider_5xx'), done(''))]);
        await run(orbit);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [2, 3, 4] }]);
    });

    it('gives the turn that replaces a cancelled one its own number and window: a fault noted in the cancelled turn is not the new turn’s', async () => {
        const { call, run } = sameMillisecond();
        const stepped: RunnerEvent[] = [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'tool', state: 'completed', tool: 'click' }, { type: 'text', text: 'Old words' }, { type: 'completed', outputText: 'Old words', usage: null }];
        // the generation does not change: only the cancellation tells the runner this turn is over
        const stale = Object.assign(new Error('Request failed with status code 409'), { isAxiosError: true, response: { status: 409, data: { ok: false, reason: 'stale' } } });
        const refused = (callId: string) => () => (call(callId, 'not_ours', 'allowance'), [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'model_error', message: 'no' }] as RunnerEvent[]);
        const { orbit, seen } = fakeOrbit([() => (call('c0', 'fault', 'provider_key_ours'), stepped), refused('c1'), refused('c2'), refused('c3')]);
        const original = orbit.action;
        let cancelled = false;
        orbit.action = async (botId, jobId, body) => {
            if (body.action === 'progress' && !cancelled) {
                cancelled = true;
                seen.actions.push(body);
                throw stale;
            }
            return original(botId, jobId, body);
        };
        await run(orbit);
        expect(seen.cancels).toBe(1);
        // the replacement and the two after it are numbered 2, 3 and 4, and the person's allowance is what stopped them, not the fault of the cancelled turn
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [2, 3, 4] }]);
    });

    it('does not carry a streak across a time the person had the machine between two turns: the next failed turn is the first of a new streak', async () => {
        let looks = 0;
        const failing = (): RunnerEvent[] => [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'model_error', message: 'no' }];
        // two silent turns (the agent's own); then the person has the machine when the next turn is to start, and gives it back
        const { orbit, seen } = fakeOrbit([done(''), done(''), failing(), failing(), failing()], () => (looks++ === 4 ? { status: 'running', control: 'person' } : { status: 'running', control: 'brick' }));
        await runJob(orbit);
        // the first failed turn after the person came back does not end the job on the strength of the two before; three of them do, and they are ours
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [3, 4, 5] }]);
    });

    it('does not carry a streak across a generation that changed between two turns (taken and given back while no turn was being read)', async () => {
        let looks = 0;
        const failing = (): RunnerEvent[] => [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'model_error', message: 'no' }];
        // two silent turns on generation 1; the next turn finds the job on generation 2
        const { orbit, seen } = fakeOrbit([done(''), done(''), failing(), failing(), failing()], () => ({ status: 'running', control: 'brick', generation: looks++ < 4 ? 1 : 2 }));
        await runJob(orbit);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', generation: 2, turns: [3, 4, 5] }]);
    });

    it('does not carry a confirmed fault into the next streak: a good turn clears it', async () => {
        let confirmedNow = true;
        const refusals = { sawSince: () => false, confirmedSince: () => confirmedNow };
        const { orbit, seen } = fakeOrbit([
            failing(),
            () => (confirmedNow = false, done('Working on it')),
            done(''),
            done(''),
            done(''),
        ]);
        await runJob(orbit, JOB, RELAY, refusals);
        // turn 1 had the confirmed fault; turns 3, 4 and 5 are a new streak of silent turns, the agent's
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [3, 4, 5] }]);
    });
});

describe('a machine that cannot reach our own model service', () => {
    const WHY = RELAY_UNREACHABLE_WHY;
    /** A runner with real notes whose rows are caught on their way to Orbit. */
    const rig = (scripts: Array<RunnerEvent[] | TurnOpened | ((input: string) => RunnerEvent[] | TurnOpened)>, options: { probe?: (relay: string) => Promise<RelayProbeResult>; shared?: SharedCalls } = {}) => {
        let t = 0;
        const clock = () => ++t;
        const rows: CallRow[] = [];
        const notes = createRefusalNotes(clock, {
            ...(options.shared ? { shared: options.shared } : {}),
            sink: async (_botId, _jobId, sent) => {
                rows.push(...sent);
                return true;
            },
        });
        const fake = fakeOrbit(scripts);
        const runner = createComputerRunner({ orbit: fake.orbit, relayUrl: RELAY, sleep: instantly, log: quiet, now: clock, refusals: notes, runId: () => 'run1', ...(options.probe ? { relayProbe: options.probe } : {}), timing: { waitMs: 0, progressMs: 0, reconnectMs: [0, 0], prepareMs: [0, 0] } });
        fake.orbit.running = async () => [JOB];
        return { ...fake, notes, rows, clock, runner, advance: (ms: number) => (t += ms), run: async () => { await runner.tick(); await runner.idle(); } };
    };
    const unreachable = () => ({ ok: false as const, reason: 'relay_unreachable' });

    it('does not end the job as relay_down when the address answers with a challenge: the machine side check (Orbit prepare) decides', async () => {
        const { seen, rows, run } = rig([done('[[done]]')], { probe: (relay) => probeRelay(relay, (async () => new Response('<html>Checking your browser</html>', { status: 403 })) as never) });
        await run();
        // a probe that reads "unknown" asks Orbit to prepare the machine, and the job runs
        expect(seen.prepares.length).toBeGreaterThan(0);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
        expect(rows).toEqual([]);
    });

    it('ends the job as a confirmed fault of ours, said in plain words, when Orbit says the machine could not reach the relay', async () => {
        const { seen, setPrepare, rows, run } = rig([]);
        setPrepare(unreachable);
        await run();
        // tried again like any failure to get ready (three tries), no turn sent, and ended once
        expect(seen.prepares).toHaveLength(3);
        expect(seen.prepareFacts).toEqual([{ run: 'run1' }, { run: 'run1' }, { run: 'run1' }]);
        expect(seen.turns).toEqual([]);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1], why: WHY }]);
        expect(finishedWithRun(seen)[0].run).toBe('run1');
        // the record Orbit judges by: one confirmed fault of ours on that turn of that run, sent before the finish
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ turn: 1, run: 'run1', kind: 'fault', reason: 'relay_down', source: 'universe-ai', providerStatus: null });
    });

    it('goes on when the relay came back between two tries', async () => {
        const { seen, setPrepare, rows, run } = rig([done('[[done]]')]);
        let asked = 0;
        setPrepare(() => (++asked < 2 ? unreachable() : { ok: true }));
        await run();
        expect(seen.prepares).toHaveLength(2);
        expect(seen.turns).toHaveLength(1);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
        expect(rows).toEqual([]);
    });

    it('ends it the same way, without asking Orbit to prepare, when the relay’s address answers as something else (an error page)', async () => {
        const { seen, rows, run } = rig([], { probe: async () => ({ answer: 'wrong', status: 404 }) });
        await run();
        // The job ends on its own fault row: Orbit is not asked to prepare a machine for it
        expect(seen.prepares).toEqual([]);
        expect(seen.turns).toEqual([]);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1], why: WHY }]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ kind: 'fault', reason: 'relay_down', turn: 1, run: 'run1' });
    });

    it('goes on when the address is the relay, and when it could not be asked from here (that proves nothing about the machine)', async () => {
        for (const answer of ['relay', 'unknown'] as const) {
            const { seen, rows, run } = rig([done('[[done]]')], { probe: async () => ({ answer, status: answer === 'relay' ? 401 : null }) });
            await run();
            expect(seen.prepares, answer).toHaveLength(1);
            expect(finished(seen), answer).toEqual([{ action: 'finish', outcome: 'done' }]);
            expect(rows, answer).toEqual([]);
        }
    });

    it('asks the address afresh at every try to get ready, so a relay that was only down for a moment is not judged by what was kept', async () => {
        // the clock of this rig moves one tick per call: the kept answer would still be fresh at every try
        const answers: RelayProbeResult[] = [{ answer: 'wrong', status: 502 }, { answer: 'relay', status: 401 }];
        const probe = vi.fn(async (): Promise<RelayProbeResult> => answers.shift() ?? { answer: 'relay', status: 401 });
        const { seen, rows, run } = rig([done('[[done]]')], { probe });
        await run();
        expect(probe).toHaveBeenCalledTimes(2);
        expect(seen.prepares).toHaveLength(1);
        expect(seen.turns).toHaveLength(1);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
        expect(rows).toEqual([]);
    });

    it('ends the job as unreachable only when the address answered as something else at every one of the tries', async () => {
        const probe = vi.fn(async (): Promise<RelayProbeResult> => ({ answer: 'wrong', status: 404 }));
        const { seen, rows, run } = rig([], { probe });
        await run();
        // three tries, each asked of the address itself
        expect(probe).toHaveBeenCalledTimes(3);
        expect(seen.prepares).toEqual([]);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1], why: WHY }]);
        expect(rows).toHaveLength(1);
    });

    it('asks the address once in a while, not for every job and turn', async () => {
        const probe = vi.fn(async (): Promise<RelayProbeResult> => ({ answer: 'relay', status: 401 }));
        const { run } = rig([done('Carrying on'), done('[[done]]')], { probe });
        await run();
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('treats turns that failed with no call ever reaching the relay as ours, even though Orbit’s prepare said yes', async () => {
        const failing = (): RunnerEvent[] => [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'model_error', message: 'No route' }];
        const { seen, rows, run } = rig([failing(), failing(), failing()]);
        await run();
        expect(seen.turns).toHaveLength(RUNNER_GUARDS.maxBadTurns);
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1, 2, 3] }]);
        // a confirmed fault for each turn, under ids of their own, so Orbit never counts it against the goodwill a month allows
        expect(rows.map((row) => [row.turn, row.kind, row.reason])).toEqual([
            [1, 'fault', 'relay_down'],
            [2, 'fault', 'relay_down'],
            [3, 'fault', 'relay_down'],
        ]);
        expect(new Set(rows.map((row) => row.callId)).size).toBe(3);
        expect(rows.every((row) => row.run === 'run1')).toBe(true);
    });

    describe('a turn this process did not start (the bot server restarted while the agent was on it)', () => {
        const failing = (): RunnerEvent[] => [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'failed', code: 'model_error', message: 'No route' }];
        const taken = (rigged: ReturnType<typeof rig>) => (rigged.orbit.running = async () => [{ ...JOB, hasTurn: true }]);

        it('writes no fault for a turn it only reconnected to that ends failed with no call noted: it may have made calls before the restart', async () => {
            const r = rig([failing(), done('[[done]]')]);
            taken(r);
            await r.run();
            // the first turn was taken up with orbit.stream (no input), and nothing was concluded from the absence of calls in it
            expect(r.seen.turns).toHaveLength(1);
            expect(r.seen.streams).toBe(1);
            expect(r.rows).toEqual([]);
            expect(finished(r.seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
        });

        it('does not make the streak confirmed from it, but still judges the turns it started itself after it', async () => {
            const r = rig([failing(), failing(), failing()]);
            taken(r);
            await r.run();
            // turn 1 was taken up (no row); turns 2 and 3 were started here (the no-call rule stays in force for them)
            expect(r.rows.map((row) => [row.turn, row.kind, row.reason])).toEqual([
                [2, 'fault', 'relay_down'],
                [3, 'fault', 'relay_down'],
            ]);
            expect(finished(r.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1, 2, 3] }]);
        });

        it('says the same for a turn it asked for but that Orbit said the agent was already on (busy): that turn was not started here', async () => {
            const r = rig([{ ok: false, reason: 'busy' }, failing(), done('[[done]]')]);
            await r.run();
            // the first turn was asked for (busy) and read with orbit.stream; the next one was started here and ended well
            expect(r.seen.turns).toHaveLength(2);
            expect(r.seen.streams).toBe(1);
            expect(r.rows).toEqual([]);
        });

        it('keeps the rule for a turn it started, also when it reconnected to it after the stream broke in this same process', async () => {
            const broken = (): TurnOpened => ({
                ok: true,
                events: (async function* (): AsyncGenerator<RunnerEvent> {
                    yield { type: 'created', id: 'r', sessionId: 's' };
                    throw new Error('terminated');
                })(),
            });
            const r = rig([broken(), failing(), failing(), failing()]);
            await r.run();
            // the reconnect (orbit.stream) is to a turn this process started and saw from the beginning: turn 1 is counted like the others
            expect(r.seen.streams).toBe(1);
            expect(r.rows.map((row) => [row.turn, row.reason])).toEqual([[1, 'relay_down'], [2, 'relay_down'], [3, 'relay_down']]);
        });

        it('keeps the rule for a turn it started itself, for a job it took up with no turn yet', async () => {
            const r = rig([failing(), failing(), failing()]);
            await r.run();
            expect(r.rows.map((row) => row.turn)).toEqual([1, 2, 3]);
        });
    });

    it('does the same for silent turns with no call at all (a model answers even to say nothing)', async () => {
        const { seen, rows, run } = rig([done(''), done(''), done('')]);
        await run();
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1, 2, 3] }]);
        expect(rows).toHaveLength(3);
    });

    it('does not read a good turn as a fault when no call reached the relay (a job’s words and endings are what they are)', async () => {
        const { seen, rows, run } = rig([done('[[done]]')]);
        await run();
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
        expect(rows).toEqual([]);
    });


/** What the bot servers share in the store, in memory: one latest call per job and server; a server reads the others' only. */
    const sharedStore = () => {
        const seen = new Map<string, Map<string, number>>();
        const state = { down: false, failCalled: 0, failUnrecorded: false, told: [] as string[], unrecorded: [] as string[], hold: undefined as Promise<void> | undefined };
        const put = (jobId: string, field: string, at: number) => {
            const byServer = seen.get(jobId) ?? new Map<string, number>();
            byServer.set(field, Math.max(at, byServer.get(field) ?? 0));
            seen.set(jobId, byServer);
        };
        const forServer = (id: string): SharedCalls => ({
            noteCalled: async (jobId, at) => {
                if (state.hold) await state.hold;
                if (state.down) throw new Error('shared store down');
                if (state.failCalled > 0) {
                    state.failCalled -= 1;
                    throw new Error('write lost');
                }
                state.told.push(`${id}:${jobId}`);
                put(jobId, id, at);
            },
            noteUnrecorded: async (jobId, at) => {
                if (state.down || state.failUnrecorded) throw new Error('shared store down');
                state.unrecorded.push(`${id}:${jobId}`);
                put(jobId, `unsure:${id}`, at);
            },
            lastCalledByOthers: async (jobId) => {
                if (state.down) throw new Error('shared store down');
                let latest: number | null = null;
                for (const [field, at] of seen.get(jobId) ?? []) {
                    const server = field.startsWith('unsure:') ? field.slice('unsure:'.length) : field;
                    if (server !== id && (latest === null || at > latest)) latest = at;
                }
                return latest;
            },
        });
        return { forServer, state };
    };

    describe('two bot servers: the runner of the job is on one, the machine’s calls arrive at the other', () => {
        const silent = () => done('');

        it('writes no fault, and does not make the ending ours, when the other server saw the calls of every turn', async () => {
            const store = sharedStore();
            let other!: ReturnType<typeof createRefusalNotes>;
            // each turn's call is made well apart from the others (more than the clocks of two servers can differ): only a call of its own turn can show for it
            const { seen, rows, clock, advance, run } = rig(
                Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => () => (other.called(JOB.jobId), advance(SHARED_CALL_SKEW_MS + 1000), silent())),
                { shared: store.forServer('A') }
            );
            other = createRefusalNotes(clock, { shared: store.forServer('B') });
            await run();
            // every turn's call was recorded by the other server
            expect(store.state.told).toEqual(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => `B:${JOB.jobId}`));
            // silent turns after calls are the agent's, as on one server; no_call is not written, so the streak is not ours
            expect(rows).toEqual([]);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [1, 2, 3] }]);
        });

        it('still writes the fault of ours when no server saw a call: the shared notes make it surer, not blind', async () => {
            const store = sharedStore();
            const { seen, rows, run } = rig(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => silent), { shared: store.forServer('A') });
            await run();
            expect(rows.map((row) => [row.turn, row.kind, row.reason])).toEqual([
                [1, 'fault', 'relay_down'],
                [2, 'fault', 'relay_down'],
                [3, 'fault', 'relay_down'],
            ]);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1, 2, 3] }]);
        });

        it('writes no fault when the other server’s first write of its call was lost and its retry landed (the record has the call)', async () => {
            const store = sharedStore();
            let other!: ReturnType<typeof createRefusalNotes>;
            const { seen, rows, clock, advance, run } = rig(
                Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => () => ((store.state.failCalled = 1), void other.reached(JOB.jobId), advance(SHARED_CALL_SKEW_MS + 1000), silent())),
                { shared: store.forServer('A') }
            );
            other = createRefusalNotes(clock, { shared: store.forServer('B') });
            await run();
            // each turn's first write was lost and its retry landed: one record for each turn
            await vi.waitFor(() => expect(store.state.told).toEqual(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => `B:${JOB.jobId}`)));
            expect(rows).toEqual([]);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [1, 2, 3] }]);
        });

        it('writes no fault when the other server could not record its call at all, but said so apart', async () => {
            const store = sharedStore();
            let other!: ReturnType<typeof createRefusalNotes>;
            const { seen, rows, clock, advance, run } = rig(
                Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => () => ((store.state.failCalled = 2), void other.reached(JOB.jobId), advance(SHARED_CALL_SKEW_MS + 1000), silent())),
                { shared: store.forServer('A') }
            );
            // the runner of the job is working on B too (a stale one, a job both servers think they run), so its call goes ahead and says apart that it was not recorded
            other = createRefusalNotes(clock, { shared: store.forServer('B'), runsHere: () => true });
            await run();
            // each turn's call said apart that it was not recorded: one note for each turn, and none of the calls recorded as an arrival
            await vi.waitFor(() => expect(store.state.unrecorded).toEqual(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => `B:${JOB.jobId}`)));
            expect(store.state.told).toEqual([]);
            expect(rows).toEqual([]);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [1, 2, 3] }]);
        });

        it('records nothing and sends no finish for a turn when the job was stopped while the other servers were being asked', async () => {
            const store = sharedStore();
            const reads = { n: 0 };
            let stop = () => undefined as void;
            const shared: SharedCalls = {
                ...store.forServer('A'),
                // the third turn's question to the other servers is the one the stop comes in the middle of
                lastCalledByOthers: async () => {
                    reads.n += 1;
                    if (reads.n === 3) stop();
                    return null;
                },
            };
            const { seen, rows, runner, run } = rig(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => silent), { shared });
            stop = () => runner.stop();
            await run();
            expect(reads.n).toBe(3);
            // the two turns before it were judged as usual; the stopped one writes no no_call row and the job is not ended on it
            expect(rows.map((row) => row.turn)).toEqual([1, 2]);
            expect(finished(seen)).toEqual([]);
        });

        it('judges a turn by the notes as they are AFTER the other servers were asked: a fault recovered meanwhile is no bad turn, so it does not end the job', async () => {
            let turnNo = 0;
            let recovered = false;
            // the relay answers a call of the third turn while the other servers are being asked about it
            const refusals = {
                sawSince: () => false,
                mark: () => ({ order: 1, at: 1 }),
                turn: (_job: string, n: number) => void ((turnNo = n), (recovered = false)),
                calledAnywhereSince: async () => {
                    if (turnNo === 3) recovered = true;
                    return true;
                },
                endedOnFault: () => !recovered,
                confirmedSince: () => !recovered,
            };
            const { orbit, seen } = fakeOrbit([done('Working on it'), done('Working on it'), done('Working on it'), done('All fine. [[done]]')]);
            await runJob(orbit, JOB, RELAY, refusals);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
            expect(seen.turns).toHaveLength(4);
        });

        it('writes no fault when the shared store cannot be read: a call may have arrived elsewhere, and nothing is concluded', async () => {
            const store = sharedStore();
            store.state.down = true;
            const { seen, rows, run } = rig(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => silent), { shared: store.forServer('A') });
            await run();
            expect(rows).toEqual([]);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [1, 2, 3] }]);
        });
    });

    it('leaves a turn alone when a call did reach the relay: a silent turn after a call is still the agent’s, and nothing is noted', async () => {
        const { notes, seen, rows, run } = rig(Array.from({ length: RUNNER_GUARDS.maxBadTurns }, () => () => (notes.called(JOB.jobId), done(''))));
        await run();
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', turns: [1, 2, 3] }]);
        expect(rows).toEqual([]);
    });
});

describe('a stop that comes while the relay’s address is being asked', () => {
    it('sends no prepare for the job, and ends nothing', async () => {
        let answer!: (result: RelayProbeResult) => void;
        const probe = vi.fn(() => new Promise<RelayProbeResult>((resolve) => (answer = resolve)));
        const warn = vi.fn();
        const { orbit, seen } = fakeOrbit([done('[[done]]')]);
        const runner = createComputerRunner({ orbit, relayUrl: RELAY, sleep: instantly, log: { warn, error: vi.fn(), info: vi.fn() }, relayProbe: probe, timing: { waitMs: 0, progressMs: 0, reconnectMs: [0], prepareMs: [0] } });
        orbit.running = async () => [JOB];
        await runner.tick();
        await vi.waitFor(() => expect(probe).toHaveBeenCalled());
        runner.stop();
        // the address answers after the stop, as the relay or as nothing the bot server can tell
        for (const result of [{ answer: 'relay', status: 401 }, { answer: 'unknown', status: null }] as const) {
            answer(result);
            await runner.idle();
            expect(seen.prepares, result.answer).toEqual([]);
            expect(finished(seen), result.answer).toEqual([]);
        }
    });
});

describe('asking an address whether it is the relay', () => {
    const answer = (status: number, body: string): typeof fetch => (async () => new Response(body, { status })) as never;
    it('reads the relay’s own answers (a JSON error without a key, the list, an Orbit that is away) as the relay', async () => {
        expect(await probeRelay('https://x.test', answer(401, JSON.stringify({ error: { message: 'Invalid API key.', code: 'invalid_api_key' } })))).toEqual(expect.objectContaining({ answer: 'relay' }));
        expect(await probeRelay('https://x.test', answer(503, JSON.stringify({ error: { message: 'The service is busy.', code: 'service_unavailable' } })))).toEqual(expect.objectContaining({ answer: 'relay' }));
        expect(await probeRelay('https://x.test', answer(200, JSON.stringify({ object: 'list', data: [] })))).toEqual(expect.objectContaining({ answer: 'relay' }));
    });

    it('reads an error page, a body that is not JSON and a JSON that is not an error or a list as something else', async () => {
        expect(await probeRelay('https://x.test', answer(404, '<!DOCTYPE html><html><body>404 Not Found</body></html>'))).toEqual(expect.objectContaining({ answer: 'wrong' }));
        expect(await probeRelay('https://x.test', answer(502, '<html>Bad gateway</html>'))).toEqual(expect.objectContaining({ answer: 'wrong' }));
        expect(await probeRelay('https://x.test', answer(200, 'ok'))).toEqual(expect.objectContaining({ answer: 'wrong' }));
        expect(await probeRelay('https://x.test', answer(200, JSON.stringify({ hello: 'world' })))).toEqual(expect.objectContaining({ answer: 'wrong' }));
        expect(await probeRelay('https://x.test', answer(200, 'null'))).toEqual(expect.objectContaining({ answer: 'wrong' }));
    });

    it('says "something else is there" only for a status that a service says it with: a 2xx, a 404 or a 5xx, whatever the body', async () => {
        for (const status of [200, 404, 500, 502, 503, 504, 520]) {
            expect(await probeRelay('https://x.test', answer(status, '<html>not the relay</html>')), `html ${status}`).toEqual({ answer: 'wrong', status });
            expect(await probeRelay('https://x.test', answer(status, JSON.stringify({ hello: 'world' }))), `json ${status}`).toEqual({ answer: 'wrong', status });
        }
        // a 204 has no body at all (a real bodyless Response: the constructor does not take one for it)
        expect(() => new Response('<html></html>', { status: 204 })).toThrow();
        expect(await probeRelay('https://x.test', (async () => new Response(null, { status: 204 })) as never)).toEqual({ answer: 'wrong', status: 204 });
    });

    it('proves nothing either way for a redirect or a challenge in front of the relay (http to https, a WAF or proxy block, a rate limit): unknown, so Orbit’s own check from the machine decides', async () => {
        for (const status of [301, 302, 307, 308, 401, 403, 429]) {
            expect(await probeRelay('https://x.test', answer(status, '<html>Just a moment...</html>')), `html ${status}`).toEqual({ answer: 'unknown', status });
            expect(await probeRelay('https://x.test', answer(status, '')), `empty ${status}`).toEqual({ answer: 'unknown', status });
            expect(await probeRelay('https://x.test', answer(status, JSON.stringify({ blocked: true }))), `json ${status}`).toEqual({ answer: 'unknown', status });
        }
        // the relay's own 401 is still the relay, and so is its 429-free error shape
        expect((await probeRelay('https://x.test', answer(401, JSON.stringify({ error: { code: 'invalid_api_key' } })))).answer).toBe('relay');
    });

    it('says it could not be asked when nothing answers, and asks the model list with no key', async () => {
        const failing = (async () => {
            throw new Error('connect ECONNREFUSED');
        }) as never;
        expect(await probeRelay('https://x.test', failing)).toEqual({ answer: 'unknown', status: null });
        expect(await probeRelay('https://x.test', answer(404, '<html></html>'))).toEqual({ answer: 'wrong', status: 404 });
        const seen: Array<[string, RequestInit | undefined]> = [];
        await probeRelay('https://x.test', (async (url: string, init?: RequestInit) => (seen.push([url, init]), new Response('{}', { status: 200 }))) as never);
        expect(seen[0][0]).toBe('https://x.test/v1/models');
        expect(JSON.stringify(seen[0][1])).not.toMatch(/authorization/i);
    });

    it('reads no more than a fixed number of bytes of a long answer and lets the rest go (an address that streams on and on costs no more than that)', async () => {
        let pulls = 0;
        let cancelled = false;
        const chunk = new TextEncoder().encode('x'.repeat(1024));
        const endless = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulls += 1;
                // far more than any limit: if the whole body were read this would run until the test times out
                if (pulls <= 100_000) controller.enqueue(chunk);
                else controller.close();
            },
            cancel() {
                cancelled = true;
            },
        });
        const result = await probeRelay('https://x.test', (async () => new Response(endless, { status: 200 })) as never);
        // not JSON, from something that answers 2xx: it is something else
        expect(result).toEqual({ answer: 'wrong', status: 200 });
        expect(cancelled).toBe(true);
        expect(pulls).toBeLessThan(100);
    });

    it('still reads a small JSON answer in many pieces as the relay’s, and a bodyless 204 as before', async () => {
        const text = JSON.stringify({ object: 'list', data: [{ id: 'a' }, { id: 'b' }] });
        const bytes = new TextEncoder().encode(text);
        const pieces = new ReadableStream<Uint8Array>({
            start(controller) {
                for (let at = 0; at < bytes.length; at += 7) controller.enqueue(bytes.slice(at, at + 7));
                controller.close();
            },
        });
        expect(await probeRelay('https://x.test', (async () => new Response(pieces, { status: 200 })) as never)).toEqual({ answer: 'relay', status: 200 });
        expect(await probeRelay('https://x.test', (async () => new Response(null, { status: 204 })) as never)).toEqual({ answer: 'wrong', status: 204 });
    });
});

describe('saying where the relay is assumed to be', () => {
    it('says so once, with the host only, when the address is taken from the play address, and says nothing when it was chosen', () => {
        const log = { error: vi.fn() };
        expect(relayUrlFromEnv({ PUSHER_URL: 'https://play.dev.example.test' } as never, log)).toBe('https://bot-server.dev.example.test');
        expect(log.error).toHaveBeenCalledTimes(1);
        const line = String(log.error.mock.calls[0][0]);
        expect(line).toContain('bot-server.dev.example.test');
        expect(line).toContain('COMPUTER_RELAY_URL');
        expect(line).not.toContain('https://');
        const quietLog = { error: vi.fn() };
        expect(relayUrlFromEnv({ COMPUTER_RELAY_URL: 'https://relay.example.test' } as never, quietLog)).toBe('https://relay.example.test');
        expect(relayUrlFromEnv({ BOT_SERVER_URL: 'https://bot.example.test' } as never, quietLog)).toBe('https://bot.example.test');
        expect(relayUrlFromEnv({ PUSHER_URL: 'http://pusher:8080' } as never, quietLog)).toBeNull();
        expect(relayUrlFromEnv({} as never, quietLog)).toBeNull();
        expect(quietLog.error).not.toHaveBeenCalled();
    });
});

describe('a pool with no room: the machine is given up, not waited for', () => {
    const poolRefusal = { callId: 'c1', kind: 'fault', reason: 'pool_busy', source: 'universe-ai', route: 'universe-ai:p', providerStatus: 503 } as const;

    /**
     * A turn that goes on until it is stopped or until `endsAfterMs`, like a machine whose model calls Hermes goes on retrying. What `during` does is done once
     * the turn has begun (the calls its machine makes reach the relay, which notes them).
     */
    const retryingTurn = (orbit: RunnerOrbit, during: (at: (ms: number, what: () => void) => void) => void, endsAfterMs: number | null) => {
        const state = { aborted: false, turns: 0 };
        orbit.turn = async (_jobId, _input, signal) => {
            state.turns += 1;
            during((ms, what) => void setTimeout(what, ms));
            const events = (async function* (): AsyncGenerator<RunnerEvent> {
                yield { type: 'created', id: 'r', sessionId: 's' };
                await new Promise<void>((resolve) => {
                    signal?.addEventListener('abort', () => ((state.aborted = true), resolve()), { once: true });
                    if (endsAfterMs !== null) setTimeout(resolve, endsAfterMs);
                });
                if (!state.aborted) yield { type: 'completed', outputText: 'All fine. [[done]]', usage: null };
            })();
            return { ok: true, events };
        };
        return state;
    };
    const withFakeClock = async (test: () => Promise<void>) => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            await test();
        } finally {
            vi.useRealTimers();
        }
    };
    const rigged = () => {
        const sent: CallRow[] = [];
        const notes = createRefusalNotes(Date.now, { sink: async (_botId, _jobId, rows) => (sent.push(...rows), true) });
        return { notes, sent };
    };

    it('stops a turn whose calls were ALL refused for room within about two minutes, records the confirmed fault of ours, and ends the job as ours in plain words', async () => {
        await withFakeClock(async () => {
            const { notes, sent } = rigged();
            const { orbit, seen } = fakeOrbit([]);
            // Hermes would go on for six minutes
            const state = retryingTurn(orbit, (at) => { at(0, () => notes.record(JOB.botId, JOB.jobId, poolRefusal)); at(20_000, () => notes.record(JOB.botId, JOB.jobId, { ...poolRefusal, callId: 'c2', kind: 'uncertain' })); }, 6 * 60_000);
            const running = runJob(orbit, JOB, RELAY, notes, () => 'run1');
            // not yet given up while the wait is short
            await vi.advanceTimersByTimeAsync(60_000);
            expect(finished(seen)).toEqual([]);
            expect(seen.cancels).toBe(0);
            await vi.advanceTimersByTimeAsync(60_000);
            await running;
            expect(state.aborted).toBe(true);
            expect(seen.cancels).toBe(1);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1], why: POOL_BUSY_WHY }]);
            expect(finishedWithRun(seen)[0].run).toBe('run1');
            expect(POOL_BUSY_WHY).toBe("Computers are busy right now, so we stopped this and you weren't charged.");
            // the confirmed fault of ours, under this turn and run, reached Orbit's record
            await notes.flush(JOB.jobId);
            expect(sent.find((row) => row.callId === 'pool_busy_gave_up_run1_1')).toMatchObject({ kind: 'fault', reason: 'pool_busy', turn: 1, run: 'run1', providerStatus: 503 });
            // no second turn was begun for the agent
            expect(state.turns).toBe(1);
        });
    });

    it('does not give up on a turn whose calls were all refused for their own size (unresolved, not confirmed), and writes no confirmed fault for it', async () => {
        await withFakeClock(async () => {
            const { notes, sent } = rigged();
            const { orbit, seen } = fakeOrbit([]);
            // an older turn had a call taken up: these refusals are for the size of the call, which the relay sends as uncertain
            const state = retryingTurn(orbit, (at) => { at(0, () => notes.record(JOB.botId, JOB.jobId, { ...poolRefusal, kind: 'uncertain' })); at(20_000, () => notes.record(JOB.botId, JOB.jobId, { ...poolRefusal, callId: 'c2', kind: 'uncertain' })); }, 200_000);
            const running = runJob(orbit, JOB, RELAY, notes, () => 'run1');
            await vi.advanceTimersByTimeAsync(210_000);
            await running;
            expect(state.turns).toBe(1);
            expect(seen.cancels).toBe(0);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
            await notes.flush(JOB.jobId);
            expect(sent.some((row) => row.kind === 'fault')).toBe(false);
            expect(sent.map((row) => row.kind)).toEqual(['uncertain', 'uncertain']);
        });
    });

    it('gives up after one confirmed refusal and one for size in the same turn, as for confirmed ones alone', async () => {
        await withFakeClock(async () => {
            const { notes, sent } = rigged();
            const { orbit, seen } = fakeOrbit([]);
            retryingTurn(orbit, (at) => { at(0, () => notes.record(JOB.botId, JOB.jobId, { ...poolRefusal, kind: 'uncertain' })); at(20_000, () => notes.record(JOB.botId, JOB.jobId, { ...poolRefusal, callId: 'c2' })); }, 6 * 60_000);
            const running = runJob(orbit, JOB, RELAY, notes, () => 'run1');
            await vi.advanceTimersByTimeAsync(130_000);
            await running;
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1], why: POOL_BUSY_WHY }]);
            await notes.flush(JOB.jobId);
            expect(sent.find((row) => row.callId === 'pool_busy_gave_up_run1_1')).toMatchObject({ kind: 'fault' });
        });
    });

    /** The shared record of two bot servers, in memory: what each noted (a call arriving, a call taken up) and what the other reads of it. */
    const sharedRecord = () => {
        const called = new Map<string, number>();
        const accepted = new Map<string, number>();
        let fenced = false;
        // The store takes its time to get a command (latency) and then does it as one step: `began` says a close of the turn was sent
        const latency = { ms: 0, began: undefined as (() => void) | undefined };
        const forServer = (id: string) => ({
            noteCalled: async (_jobId: string, at: number) => void called.set(id, Math.max(at, called.get(id) ?? 0)),
            noteUnrecorded: async () => undefined,
            lastCalledByOthers: async () => {
                const others = [...called].filter(([server]) => server !== id).map(([, at]) => at);
                return others.length > 0 ? Math.max(...others) : null;
            },
            // a turn that was given up (fenced) takes no acceptance, and the fence is written only when no other server took one up: one step, as in the store
            noteAccepted: async (_jobId: string, at: number) => {
                if (fenced) return false;
                accepted.set(id, Math.max(at, accepted.get(id) ?? 0));
                return true;
            },
            closeTurn: async (_jobId: string, _turn: unknown, from: number) => {
                latency.began?.();
                if (latency.ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, latency.ms));
                const others = [...accepted].filter(([server]) => server !== id).map(([, at]) => at);
                if (others.length > 0 && Math.max(...others) >= from - 2000) return false;
                fenced = true;
                return true;
            },
            lastAcceptedByOthers: async () => {
                const others = [...accepted].filter(([server]) => server !== id).map(([, at]) => at);
                return others.length > 0 ? Math.max(...others) : null;
            },
        });
        return { forServer, accepted, latency };
    };

    it('does not give up on a turn when the pool took up a call of the job on ANOTHER bot server: only a call taken up nowhere is a pool with no room', async () => {
        await withFakeClock(async () => {
            const record = sharedRecord();
            const sent: CallRow[] = [];
            const sink = async (_botId: string, _jobId: string, rows: CallRow[]) => (sent.push(...rows), true);
            // this server's runner works the job; the machine's calls reach this server (refused for room) and another one (taken up)
            const notes = createRefusalNotes(Date.now, { sink, shared: record.forServer('A') });
            const other = createRefusalNotes(Date.now, { sink, shared: record.forServer('B') });
            const { orbit, seen } = fakeOrbit([]);
            const state = retryingTurn(orbit, (at) => { at(0, () => notes.record(JOB.botId, JOB.jobId, poolRefusal)); at(20_000, () => other.accepted(JOB.jobId)); }, 200_000);
            const running = runJob(orbit, JOB, RELAY, notes, () => 'run1');
            await vi.advanceTimersByTimeAsync(210_000);
            await running;
            // the turn went on to its end: not stopped, the machine not cancelled, nothing written as a fault of ours
            expect(state.turns).toBe(1);
            expect(seen.cancels).toBe(0);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
            await notes.flush(JOB.jobId);
            expect(sent.some((row) => row.callId.startsWith('pool_busy_gave_up'))).toBe(false);
        });
    });

    it('closes the turn on the shared store before it gives it up: a call another server takes up while the close is on its way is seen by the close, and the turn goes on', async () => {
        await withFakeClock(async () => {
            const record = sharedRecord();
            const notes = createRefusalNotes(Date.now, { sink: async () => true, shared: record.forServer('A') });
            const other = createRefusalNotes(Date.now, { sink: async () => true, shared: record.forServer('B') });
            const { orbit, seen } = fakeOrbit([]);
            // the close is sent, takes a second to get there, and is done as one step on arrival; the other server's relay takes a call up half a second after it was sent
            record.latency.ms = 1000;
            let accepting: Promise<unknown> | undefined;
            record.latency.began = () => void setTimeout(() => (accepting = Promise.resolve(other.accepted(JOB.jobId)).then((answer) => (taken = answer))), 500);
            let taken: unknown;
            retryingTurn(orbit, (at) => at(0, () => notes.record(JOB.botId, JOB.jobId, poolRefusal)), 200_000);
            const running = runJob(orbit, JOB, RELAY, notes, () => 'run1');
            await vi.advanceTimersByTimeAsync(210_000);
            await running;
            await accepting;
            // the call was taken up before the close was done: the turn is not given up, nothing is cancelled, the call goes on
            expect(taken).toBe(true);
            expect(seen.cancels).toBe(0);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
        });
    });

    it('closes the turn before it gives it up: a call another server tries to take up after the close is refused (nothing is forwarded), so the turn that is stopped never has a call running', async () => {
        await withFakeClock(async () => {
            const record = sharedRecord();
            const notes = createRefusalNotes(Date.now, { sink: async () => true, shared: record.forServer('A') });
            const other = createRefusalNotes(Date.now, { sink: async () => true, shared: record.forServer('B') });
            const { orbit, seen } = fakeOrbit([]);
            record.latency.ms = 1000;
            let accepting: Promise<unknown> | undefined;
            let taken: unknown = 'not asked';
            // the call is taken up 1.5 s after the close was sent: after it was done
            record.latency.began = () => void setTimeout(() => (accepting = Promise.resolve(other.accepted(JOB.jobId)).then((answer) => (taken = answer))), 1500);
            retryingTurn(orbit, (at) => at(0, () => notes.record(JOB.botId, JOB.jobId, poolRefusal)), 6 * 60_000);
            const running = runJob(orbit, JOB, RELAY, notes, () => 'run1');
            await vi.advanceTimersByTimeAsync(130_000);
            await running;
            await accepting;
            // refused: the other server's relay forwards nothing, and the turn is given up
            expect(taken).toBe(false);
            expect(seen.cancels).toBe(1);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1], why: POOL_BUSY_WHY }]);
        });
    });

    it('does not give the turn up when the close cannot be made (the store cannot be read or does not answer): no call is known to be taken up or not, so nothing is stopped', async () => {
        await withFakeClock(async () => {
            const record = sharedRecord();
            const shared = { ...record.forServer('A'), closeTurn: async () => Promise.reject(new Error('shared store down')) };
            const notes = createRefusalNotes(Date.now, { sink: async () => true, shared });
            const { orbit, seen } = fakeOrbit([]);
            retryingTurn(orbit, (at) => at(0, () => notes.record(JOB.botId, JOB.jobId, poolRefusal)), 200_000);
            const running = runJob(orbit, JOB, RELAY, notes, () => 'run1');
            await vi.advanceTimersByTimeAsync(210_000);
            await running;
            expect(seen.cancels).toBe(0);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
        });
    });

    it('still gives up when no server took up a call, though the other servers have shared notes', async () => {
        await withFakeClock(async () => {
            const record = sharedRecord();
            const sent: CallRow[] = [];
            const notes = createRefusalNotes(Date.now, { sink: async (_botId, _jobId, rows) => (sent.push(...rows), true), shared: record.forServer('A') });
            const { orbit, seen } = fakeOrbit([]);
            retryingTurn(orbit, (at) => { at(0, () => notes.record(JOB.botId, JOB.jobId, poolRefusal)); }, 6 * 60_000);
            const running = runJob(orbit, JOB, RELAY, notes, () => 'run1');
            await vi.advanceTimersByTimeAsync(130_000);
            await running;
            expect(seen.cancels).toBe(1);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1], why: POOL_BUSY_WHY }]);
        });
    });

    it('does not give up on a turn it only reconnected to after a restart: a call taken up before the restart is unknown to it, so the refusals seen since are no proof', async () => {
        await withFakeClock(async () => {
            const { notes, sent } = rigged();
            const { orbit, seen } = fakeOrbit([]);
            // the bot server restarted: the job has a turn already going, taken up with orbit.stream, and the notes begin empty
            orbit.running = async () => [{ ...JOB, hasTurn: true }];
            const events = (): AsyncGenerator<RunnerEvent> => (async function* () {
                yield { type: 'created', id: 'r', sessionId: 's' };
                notes.record(JOB.botId, JOB.jobId, poolRefusal);
                await new Promise<void>((resolve) => setTimeout(resolve, 200_000));
                yield { type: 'completed', outputText: 'All fine. [[done]]', usage: null };
            })();
            orbit.stream = async () => ({ ok: true, events: events() });
            const running = runJob(orbit, { ...JOB, hasTurn: true }, RELAY, notes, () => 'run1');
            await vi.advanceTimersByTimeAsync(210_000);
            await running;
            expect(seen.cancels).toBe(0);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
            await notes.flush(JOB.jobId);
            expect(sent.some((row) => row.callId.startsWith('pool_busy_gave_up'))).toBe(false);
        });
    });

    it('still gives up on a turn it started itself in a job it took up after a restart', async () => {
        await withFakeClock(async () => {
            const { notes, sent } = rigged();
            const { orbit, seen } = fakeOrbit([]);
            // the first turn is only reconnected to (and ends well); the next one is started here and met a pool with no room
            let turns = 0;
            orbit.stream = async () => ({ ok: true, events: (async function* (): AsyncGenerator<RunnerEvent> { yield { type: 'completed', outputText: 'Still on it.', usage: null }; })() });
            retryingTurn(orbit, (at) => { at(0, () => notes.record(JOB.botId, JOB.jobId, poolRefusal)); turns += 1; }, 6 * 60_000);
            const running = runJob(orbit, { ...JOB, hasTurn: true }, RELAY, notes, () => 'run1');
            await vi.advanceTimersByTimeAsync(130_000);
            await running;
            expect(turns).toBe(1);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [2], why: POOL_BUSY_WHY }]);
            await notes.flush(JOB.jobId);
            expect(sent.find((row) => row.callId === 'pool_busy_gave_up_run1_2')).toMatchObject({ kind: 'fault', turn: 2 });
        });
    });

    it('does not give up on a turn in which the person’s allowance or a rule of theirs also refused a call: a spending limit stopped it too', async () => {
        await withFakeClock(async () => {
            const { notes } = rigged();
            const { orbit, seen } = fakeOrbit([]);
            retryingTurn(orbit, (at) => {
                at(0, () => notes.record(JOB.botId, JOB.jobId, poolRefusal));
                at(10_000, () => notes.record(JOB.botId, JOB.jobId, { callId: 'c-allowance', kind: 'not_ours', reason: 'allowance', source: 'universe-ai', route: 'universe-ai:p', providerStatus: 429 }));
            }, 200_000);
            const running = runJob(orbit, JOB, RELAY, notes, () => 'run1');
            await vi.advanceTimersByTimeAsync(210_000);
            await running;
            expect(seen.cancels).toBe(0);
            expect(finished(seen).every((one) => one.action === 'finish' && one.why !== POOL_BUSY_WHY)).toBe(true);
        });
    });

    it('leaves a turn alone when one of its calls was taken up, whether before or after the refusals', async () => {
        for (const order of ['before', 'after'] as const) {
            await withFakeClock(async () => {
                const { notes } = rigged();
                const { orbit, seen } = fakeOrbit([]);
                retryingTurn(
                    orbit,
                    (at) => {
                        if (order === 'before') at(0, () => notes.accepted(JOB.jobId));
                        at(1_000, () => notes.record(JOB.botId, JOB.jobId, poolRefusal));
                        if (order === 'after') at(30_000, () => notes.accepted(JOB.jobId));
                    },
                    200_000
                );
                const running = runJob(orbit, JOB, RELAY, notes, () => 'run1');
                await vi.advanceTimersByTimeAsync(210_000);
                await running;
                expect(seen.cancels, order).toBe(0);
                expect(finished(seen), order).toEqual([{ action: 'finish', outcome: 'done' }]);
            });
        }
    });

    it('does not give up on a turn with no refusal for room at all, however long it goes on', async () => {
        await withFakeClock(async () => {
            const { notes } = rigged();
            const { orbit, seen } = fakeOrbit([]);
            retryingTurn(orbit, () => undefined, 300_000);
            const running = runJob(orbit, JOB, RELAY, notes, () => 'run1');
            await vi.advanceTimersByTimeAsync(310_000);
            await running;
            expect(seen.cancels).toBe(0);
            expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
        });
    });
});

describe('a turn stopped while its stream is being opened', () => {
    const poolRefusal = { callId: 'c1', kind: 'fault', reason: 'pool_busy', source: 'universe-ai', route: 'universe-ai:p', providerStatus: 503 } as const;
    const aborted = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    /** A sleep that ends when its signal does, as the real one does. */
    const sleeping = (ms: number, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
            if (signal.aborted) return resolve();
            const timer = setTimeout(resolve, ms);
            signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
        });
    /** Opening with a signal that has already ended fails with the abort itself, as `fetch` does. */
    const opening = (events: () => AsyncGenerator<RunnerEvent>) => async (_jobId: string, ...rest: unknown[]): Promise<TurnOpened> => {
        const signal = rest[rest.length - 1] as AbortSignal;
        if (signal.aborted) throw aborted();
        return { ok: true, events: events() };
    };
    const rigged = (reconnectMs: number[] = [200_000]) => {
        const rows: CallRow[] = [];
        const notes = createRefusalNotes(Date.now, { sink: async (_botId, _jobId, sent) => (rows.push(...sent), true) });
        const warn = vi.fn();
        const { orbit, seen } = fakeOrbit([]);
        const runner = createComputerRunner({ orbit, relayUrl: RELAY, sleep: sleeping, log: { warn, error: vi.fn(), info: vi.fn() }, refusals: notes, runId: () => 'run1', timing: { waitMs: 0, progressMs: 0, reconnectMs, prepareMs: [0] } });
        orbit.running = async () => [JOB];
        return { orbit, seen, notes, rows, warn, runner };
    };
    const withFakeClock = async (test: () => Promise<void>) => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            await test();
        } finally {
            vi.useRealTimers();
        }
    };
    /** A turn that opens, then its stream breaks after a second: the runner waits to reconnect. */
    const breaking = async function* (): AsyncGenerator<RunnerEvent> {
        yield { type: 'created', id: 'r', sessionId: 's' };
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        throw new Error('terminated');
    };
    /** What the runner logs when an error left a turn and ended the worker: the job is then picked up again on the next look. */
    const escaped = (rig: ReturnType<typeof rigged>) => rig.warn.mock.calls.filter((call) => String(call[0]).includes('stopped on an error'));
    const poolBusyEnd = (rig: ReturnType<typeof rigged>) => {
        expect(finished(rig.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'ours', turns: [1], why: POOL_BUSY_WHY }]);
        expect(rig.seen.cancels).toBe(1);
        expect(rig.rows.filter((row) => row.callId === 'pool_busy_gave_up_run1_1')).toHaveLength(1);
        // nothing left the turn as an error to be picked up again
        expect(escaped(rig)).toEqual([]);
    };

    it('ends the job as pool_busy, once, when the give-up comes while the runner waits to reconnect', async () => {
        await withFakeClock(async () => {
            const rig = rigged();
            rig.orbit.turn = async (_jobId, _input, signal) => (rig.notes.record(JOB.botId, JOB.jobId, poolRefusal), opening(breaking)('', signal));
            rig.orbit.stream = opening(breaking);
            const running = rig.runner.tick().then(() => rig.runner.idle());
            await vi.advanceTimersByTimeAsync(130_000);
            await running;
            poolBusyEnd(rig);
        });
    });

    it('ends the job as pool_busy, once, when the give-up comes before the first stream has opened', async () => {
        await withFakeClock(async () => {
            const rig = rigged();
            rig.orbit.turn = (_jobId, _input, signal) =>
                new Promise((_resolve, reject) => {
                    rig.notes.record(JOB.botId, JOB.jobId, poolRefusal);
                    // opening is slow, and fails with the abort when the turn is stopped
                    signal.addEventListener('abort', () => reject(aborted()), { once: true });
                });
            const running = rig.runner.tick().then(() => rig.runner.idle());
            await vi.advanceTimersByTimeAsync(130_000);
            await running;
            poolBusyEnd(rig);
        });
    });

    /** A turn whose stream gives no event for `after` ms and then ends with its own terminal event; its last report to Orbit is slow. */
    const endingAt = (rig: ReturnType<typeof rigged>, after: number) => {
        rig.orbit.turn = async (_jobId, _input, signal) => {
            rig.notes.record(JOB.botId, JOB.jobId, poolRefusal);
            return opening(async function* (): AsyncGenerator<RunnerEvent> {
                yield { type: 'created', id: 'r', sessionId: 's' };
                await new Promise<void>((resolve) => setTimeout(resolve, after));
                yield { type: 'completed', outputText: 'Done. [[done]]', usage: null };
            })('', signal);
        };
        const original = rig.orbit.action;
        // the report that follows the end of the turn takes a long time to be answered
        rig.orbit.action = async (botId, jobId, body) => (body.action === 'progress' ? new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 200_000)) : original(botId, jobId, body));
    };

    it('gives up nothing on a turn that has ended by its own terminal event, even when the report that follows it is slow and the pool is still full: the give-up timer is put down at the event', async () => {
        await withFakeClock(async () => {
            const rig = rigged();
            endingAt(rig, 40_000);
            const running = rig.runner.tick().then(() => rig.runner.idle());
            // well past the give-up (95 s after the first check)
            await vi.advanceTimersByTimeAsync(260_000);
            await running;
            expect(rig.seen.cancels).toBe(0);
            expect(finished(rig.seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
        });
    });

    it('ends the job as pool_busy, once, when the pool watchdog gives the turn up while the report after a broken stream on the LAST reconnect is still pending: no ordinary failed turn, no new turn', async () => {
        await withFakeClock(async () => {
            // no reconnect is left: the stream that breaks is the last one
            const rig = rigged([]);
            let turnsStarted = 0;
            rig.orbit.turn = async (_jobId, _input, signal) => {
                turnsStarted += 1;
                rig.notes.record(JOB.botId, JOB.jobId, poolRefusal);
                return opening(async function* (): AsyncGenerator<RunnerEvent> {
                    yield { type: 'created', id: 'r', sessionId: 's' };
                    await new Promise<void>((resolve) => setTimeout(resolve, 90_000));
                    throw new Error('terminated');
                })('', signal);
            };
            const original = rig.orbit.action;
            // the report that follows the break takes 20 s: the pool gives the turn up (95 s) while it is pending
            rig.orbit.action = async (botId, jobId, body) => (body.action === 'progress' ? new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 20_000)) : original(botId, jobId, body));
            const running = rig.runner.tick().then(() => rig.runner.idle());
            await vi.advanceTimersByTimeAsync(130_000);
            await running;
            poolBusyEnd(rig);
            // and the turn was not started again
            expect(turnsStarted).toBe(1);
        });
    });

    it('gives up nothing when the turn ends by its terminal event while the shared pool read is pending: it is looked at again after the read, before the job is cancelled', async () => {
        await withFakeClock(async () => {
            const rig = rigged();
            endingAt(rig, 100_000);
            // the read of what the other servers took up begins at the give-up (95 s) and answers "none" at 115 s: the turn ended at 100 s
            const runner = createComputerRunner({
                orbit: rig.orbit,
                relayUrl: RELAY,
                sleep: sleeping,
                log: { warn: rig.warn, error: vi.fn(), info: vi.fn() },
                refusals: { ...rig.notes, closeTurn: () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 20_000)) },
                runId: () => 'run1',
                timing: { waitMs: 0, progressMs: 0, reconnectMs: [200_000], prepareMs: [0] },
            });
            const running = runner.tick().then(() => runner.idle());
            await vi.advanceTimersByTimeAsync(320_000);
            await running;
            expect(rig.seen.cancels).toBe(0);
            expect(finished(rig.seen)).toEqual([{ action: 'finish', outcome: 'done' }]);
        });
    });

    it('still gives the turn up when it is still going and the pool is busy: a turn that never ends is cancelled as before', async () => {
        await withFakeClock(async () => {
            const rig = rigged();
            rig.orbit.turn = async (_jobId, _input, signal) => (rig.notes.record(JOB.botId, JOB.jobId, poolRefusal), opening(breaking)('', signal));
            rig.orbit.stream = opening(breaking);
            const running = rig.runner.tick().then(() => rig.runner.idle());
            await vi.advanceTimersByTimeAsync(130_000);
            await running;
            poolBusyEnd(rig);
        });
    });

    /** The agent gives up in its own words; the refusal flush that comes before the failure is sent is the part under test. */
    const failingTurn = (rig: ReturnType<typeof rigged>) => {
        rig.orbit.turn = opening(async function* (): AsyncGenerator<RunnerEvent> {
            yield { type: 'completed', outputText: 'The site is down. [[failed]]', usage: null };
        });
    };
    const withFlush = (rig: ReturnType<typeof rigged>, flush: () => Promise<boolean>) =>
        createComputerRunner({
            orbit: rig.orbit,
            relayUrl: RELAY,
            sleep: sleeping,
            log: { warn: rig.warn, error: vi.fn(), info: vi.fn() },
            refusals: { ...rig.notes, flush },
            runId: () => 'run1',
            timing: { waitMs: 0, progressMs: 0, reconnectMs: [200_000], prepareMs: [0] },
        });

    it('sends no finish for a worker that was stopped while the refusal flush was going: the job is not ended for whoever has it now', async () => {
        const rig = rigged();
        failingTurn(rig);
        let release!: () => void;
        let entered!: () => void;
        const inFlush = new Promise<void>((resolve) => (entered = resolve));
        const runner = withFlush(rig, () => new Promise<boolean>((resolve) => ((entered(), (release = () => resolve(true))))));
        const running = runner.tick().then(() => runner.idle());
        await inFlush;
        runner.stop();
        release();
        await running;
        expect(finished(rig.seen)).toEqual([]);
        expect(escaped(rig)).toEqual([]);
    });

    it('still sends the failure when the flush failed (it did not send its rows) and the worker is active: the cause stays Orbit’s only hint', async () => {
        const rig = rigged();
        failingTurn(rig);
        const runner = withFlush(rig, async () => false);
        await runner.tick().then(() => runner.idle());
        expect(finished(rig.seen)).toEqual([{ action: 'finish', outcome: 'failed', cause: 'agent', why: 'The site is down.' }]);
        // and one whose flush throws
        const again = rigged();
        failingTurn(again);
        const second = withFlush(again, () => Promise.reject(new Error('Orbit away')));
        await second.tick().then(() => second.idle());
        expect(finished(again.seen)).toHaveLength(1);
    });

    it('does not begin a turn before it is told to the other bot servers: the turn is sent to the machine only after the publication has settled, and a stop during it begins nothing', async () => {
        const rig = rigged();
        failingTurn(rig);
        let sent = 0;
        const original = rig.orbit.turn;
        rig.orbit.turn = async (...args) => (sent++, original(...args));
        let publish!: () => void;
        const told: number[] = [];
        const runner = createComputerRunner({
            orbit: rig.orbit,
            relayUrl: RELAY,
            sleep: sleeping,
            log: { warn: rig.warn, error: vi.fn(), info: vi.fn() },
            refusals: {
                ...rig.notes,
                turn: (jobId, turn, run) => (told.push(turn), rig.notes.turn(jobId, turn, run)),
                turnPublished: () => new Promise<void>((resolve) => (publish = resolve)),
            },
            runId: () => 'run1',
            timing: { waitMs: 0, progressMs: 0, reconnectMs: [200_000], prepareMs: [0] },
        });
        const running = runner.tick().then(() => runner.idle());
        await vi.waitFor(() => expect(told).toEqual([1]));
        await new Promise((resolve) => setTimeout(resolve, 30));
        // the publication is still going: no turn was sent
        expect(sent).toBe(0);
        publish();
        await running;
        expect(sent).toBe(1);
        // a stop while the publication is going: nothing is begun
        const stoppedRig = rigged();
        failingTurn(stoppedRig);
        let began = 0;
        const first = stoppedRig.orbit.turn;
        stoppedRig.orbit.turn = async (...args) => (began++, first(...args));
        let late!: () => void;
        const stopping = createComputerRunner({
            orbit: stoppedRig.orbit,
            relayUrl: RELAY,
            sleep: sleeping,
            log: { warn: stoppedRig.warn, error: vi.fn(), info: vi.fn() },
            refusals: { ...stoppedRig.notes, turnPublished: () => new Promise<void>((resolve) => (late = resolve)) },
            runId: () => 'run1',
            timing: { waitMs: 0, progressMs: 0, reconnectMs: [200_000], prepareMs: [0] },
        });
        const stoppedRun = stopping.tick().then(() => stopping.idle());
        await vi.waitFor(() => expect(late).toBeTypeOf('function'));
        stopping.stop();
        late();
        await stoppedRun;
        expect(began).toBe(0);
        expect(finished(stoppedRig.seen)).toEqual([]);
    });

    it('ends as stopped, with no finish and no error, when the runner is stopped in the same window (waiting to reconnect, or opening)', async () => {
        for (const window of ['reconnect', 'opening'] as const) {
            await withFakeClock(async () => {
                const rig = rigged();
                if (window === 'reconnect') {
                    rig.orbit.turn = opening(breaking);
                    rig.orbit.stream = opening(breaking);
                } else {
                    rig.orbit.turn = (_jobId, _input, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(aborted()), { once: true }));
                }
                const running = rig.runner.tick().then(() => rig.runner.idle());
                await vi.advanceTimersByTimeAsync(10_000);
                rig.runner.stop();
                await vi.advanceTimersByTimeAsync(10_000);
                await running;
                expect(finished(rig.seen), window).toEqual([]);
                expect(escaped(rig), window).toEqual([]);
            });
        }
    });

    it('ends as a turn that was stopped (told to look again), with no error, when Orbit refuses a renewal while the stream is being reopened', async () => {
        await withFakeClock(async () => {
            const rig = rigged([200_000]);
            let renewals = 0;
            const original = rig.orbit.action;
            rig.orbit.action = async (botId, jobId, body) => {
                if (body.action === 'renew') {
                    // the first renewal is granted for five seconds; the next is refused while the runner waits to reconnect
                    if (renewals++ === 0) return { ok: true, renewInSeconds: 5 };
                    throw Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } });
                }
                return original(botId, jobId, body);
            };
            let streams = 0;
            rig.orbit.turn = opening(breaking);
            rig.orbit.stream = async (_jobId, signal) => {
                if (signal.aborted) throw aborted();
                return streams++ === 0 ? { ok: true, events: (async function* (): AsyncGenerator<RunnerEvent> { yield { type: 'completed', outputText: 'All fine. [[done]]', usage: null }; })() } : { ok: true, events: (async function* () {})() };
            };
            const running = rig.runner.tick().then(() => rig.runner.idle());
            await vi.advanceTimersByTimeAsync(20_000);
            // the job is read again (it is over for Orbit then), and no error left the turn
            rig.runner.stop();
            await vi.advanceTimersByTimeAsync(10_000);
            await running;
            expect(escaped(rig)).toEqual([]);
            expect(rig.seen.cancels).toBeGreaterThanOrEqual(1);
        });
    });
});
