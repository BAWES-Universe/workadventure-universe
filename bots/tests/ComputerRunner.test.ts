import { AdminApiService } from '../server/AdminApiService';
import { describe, expect, it, vi } from 'vitest';
import {
    CONTINUE_PROMPT,
    RESUME_PROMPT,
    RUNNER_GUARDS,
    createComputerRunner,
    endingOf,
    jobPrompt,
    relayUrlFromEnv,
    runnerOrbitFor,
    type RunnableJob,
    type RunnerEvent,
    type RunnerOrbit,
    type TurnOpened,
} from '../server/ComputerRunner';
import { readRunnerEvents, runnerEventOf } from '../server/ComputerTurnStream';

const JOB: RunnableJob = { jobId: 'job-1', botId: 'brick-1', title: 'Visa form', brief: 'Two people, Kuwait', writes: true, hasTurn: false };
const RELAY = 'https://bot-server.example.test';
const quiet = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
const instantly = async () => undefined;

const done = (words: string): RunnerEvent[] => [{ type: 'created', id: 'r', sessionId: 's' }, { type: 'text', text: words }, { type: 'completed', outputText: words, usage: null }];
const stream = (events: RunnerEvent[]): TurnOpened => ({ ok: true, events: (async function* () { for (const event of events) yield event; })() });

/** A scripted Orbit: each turn answers with the next script, and `look` says how the job stands each time the runner asks. */
function fakeOrbit(scripts: Array<RunnerEvent[] | TurnOpened | ((input: string) => RunnerEvent[] | TurnOpened)>, look: () => { status: string; control: string } | null = () => ({ status: 'running', control: 'brick' })) {
    const seen = { turns: [] as string[], streams: 0, prepares: [] as string[], actions: [] as Array<Record<string, unknown>>, cancels: 0, looks: 0 };
    let renewAnswer: (n: number) => Record<string, unknown> = () => ({ ok: true, renewInSeconds: 240 });
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
            return body.action === 'renew' ? renewAnswer(seen.actions.filter((a) => a.action === 'renew').length) : { ok: true };
        },
        prepare: async (_jobId, relay) => {
            seen.prepares.push(relay);
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
    return { orbit, seen, setRenew: (fn: typeof renewAnswer) => (renewAnswer = fn), setPrepare: (fn: typeof prepareAnswer) => (prepareAnswer = fn) };
}

const runJob = async (orbit: RunnerOrbit, job: RunnableJob = JOB, relayUrl: string | null = RELAY) => {
    const runner = createComputerRunner({ orbit, relayUrl, sleep: instantly, log: quiet, timing: { waitMs: 0, progressMs: 0, reconnectMs: [0, 0], prepareMs: [0, 0] } });
    orbit.running = async () => [job];
    await runner.tick();
    await runner.idle();
    return runner;
};
const finished = (seen: { actions: Array<Record<string, unknown>> }) => seen.actions.filter((a) => a.action === 'finish');

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
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed' }]);
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
        expect(finished(a.seen)).toEqual([{ action: 'finish', outcome: 'failed' }]);

        const b = fakeOrbit(Array.from({ length: RUNNER_GUARDS.maxTurns + 5 }, () => done('still on it')));
        await runJob(b.orbit);
        expect(b.seen.turns).toHaveLength(RUNNER_GUARDS.maxTurns);
        expect(finished(b.seen)).toEqual([{ action: 'finish', outcome: 'failed' }]);
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
        expect(finished(seen)).toEqual([{ action: 'finish', outcome: 'failed' }]);
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

describe('the person’s part', () => {
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
        expect(finished(a.seen)).toEqual([{ action: 'finish', outcome: 'failed' }]);

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
            computerBroker: vi.fn(async (_id: string, step: string) => (step === 'prepare' ? { status: 409, data: { ok: false, reason: 'person_has_it' } } : { status: 200, data: {} })),
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
        // Else the play server's public https address implies it, the first name replaced; an internal or bare address implies nothing
        expect(relayUrlFromEnv({ PUSHER_URL: 'https://play.example.test' } as never)).toBe('https://bot-server.example.test');
        expect(relayUrlFromEnv({ WORKADVENTURE_URL: 'https://play.dev.example.test:8443/' } as never)).toBe('https://bot-server.dev.example.test:8443');
        expect(relayUrlFromEnv({ PUSHER_URL: 'http://pusher:8080' } as never)).toBeNull();
        expect(relayUrlFromEnv({ PUSHER_URL: 'http://play.example.test' } as never)).toBeNull();
        expect(relayUrlFromEnv({ PUSHER_URL: 'https://10.0.0.5' } as never)).toBeNull();
        expect(relayUrlFromEnv({ PUSHER_URL: 'nonsense' } as never)).toBeNull();
    });
});
