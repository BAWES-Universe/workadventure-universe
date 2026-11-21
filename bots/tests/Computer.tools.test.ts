/**
 * A Brick's computer in its owner's chat (game #2000), on the bot server: the tool is the last way, only offered while the computer is
 * on, says one true thing for each way a start can go, and never lets a count, a price or a machine name reach the model. The pretend
 * runner (development only) walks a job through its steps with the same calls the real runner will make.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), request: vi.fn(), isAxiosError: () => false }, isAxiosError: () => false }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));
vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import axios from 'axios';
import { AdminApiService } from '../server/AdminApiService';
import { AIService } from '../ai/AIService';
import { COMPUTER_TOOL, computerToolDefinitions, computerToolsNote, forgetSettledStarts, isComputerTool, runComputerTool, type StartKeyEntry } from '../ai/ComputerTools';
import { PRETEND_STEPS, pretendRunnerOn, runPretendJob } from '../ai/ComputerPretendRunner';
import { describeStep, resultOf } from '../ai/ToolSteps';

const BRICK = '0b7c1d2e-1111-4222-8333-944455556666';
const request = axios.request as unknown as ReturnType<typeof vi.fn>;

const job = (over: Record<string, unknown> = {}) => ({ id: 'j1', status: 'running', queuedFor: null, ...over });
const asking = (answer: unknown) => ({ startComputerJob: vi.fn().mockResolvedValue(answer) });
const run = (admin: ReturnType<typeof asking>, args: Record<string, unknown> = { job: 'Visa form' }, onStarted?: (id: string) => void) =>
    runComputerTool(args, { admin, botId: BRICK, userId: 'uuid-alice', onStarted });

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    delete process.env.COMPUTER_PRETEND_RUNNER;
});

describe('use_computer (#2000)', () => {
    it('is one tool, for a job nothing else can do, and says that paying and details are never its own', () => {
        const [tool] = computerToolDefinitions();
        expect(computerToolDefinitions()).toHaveLength(1);
        expect(tool.function.name).toBe(COMPUTER_TOOL);
        expect(isComputerTool(COMPUTER_TOOL)).toBe(true);
        expect(isComputerTool('make_brick')).toBe(false);
        expect(tool.function.description).toMatch(/nothing else can do/);
        expect(tool.function.description).toMatch(/Never when an app/);
        expect(computerToolsNote()).toMatch(/answer yourself, then an app you have, and only then the computer/);
        expect(computerToolsNote()).toMatch(/Paying/);
    });

    it('starts the job for the person and says it is running, starting the pretend runner only when asked to', async () => {
        const admin = asking({ ok: true, job: job(), restoredFrom: null });
        const started = vi.fn();
        const result = await run(admin, { job: '  Visa   form ', reads_only: true }, started);
        expect(admin.startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', { title: 'Visa form', writes: false, startKey: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) });
        expect(result).toMatchObject({ started: true });
        expect(started).toHaveBeenCalledWith('j1');
        expect(JSON.stringify(result)).not.toMatch(/\$|credit|\d+ ?%|machine|provider/i);
    });

    it('hands the computer the person’s words as the job’s details, cleaned and cut, and nothing when there are none', async () => {
        const admin = asking({ ok: true, job: job(), restoredFrom: null });
        await run(admin, { job: 'Visa form', details: '  Two people\u0000, the Kuwait visa site  ' });
        expect(admin.startComputerJob).toHaveBeenLastCalledWith(BRICK, 'uuid-alice', { title: 'Visa form', brief: 'Two people , the Kuwait visa site', writes: undefined, startKey: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) });
        await run(admin, { job: 'Visa form', details: 'x'.repeat(9000) });
        expect((admin.startComputerJob.mock.calls.at(-1)?.[2] as { brief: string }).brief).toHaveLength(4000);
        await run(admin, { job: 'Visa form', details: '   ' });
        expect(admin.startComputerJob.mock.calls.at(-1)?.[2]).not.toHaveProperty('brief');
        expect((computerToolDefinitions()[0].function.parameters as { properties: Record<string, unknown> }).properties).toHaveProperty('details');
    });

    it('says a restored computer came back from the copy of that day', async () => {
        const result = await run(asking({ ok: true, job: job(), restoredFrom: '2026-11-09T23:00:00.000Z' }));
        expect(String(result.note)).toMatch(/copy of/);
        expect(String(result.note)).toMatch(/make it again/);
    });

    it('says a second job waits its turn, a used-up month waits with "Ask for more", and a busy server waits in line', async () => {
        const turn = await run(asking({ ok: true, job: job({ status: 'queued', queuedFor: 'turn' }), restoredFrom: null }));
        expect(turn).toMatchObject({ started: false, queued: true });
        expect(String(turn.note)).toMatch(/one job at a time/);
        const allowance = await run(asking({ ok: true, job: job({ status: 'queued', queuedFor: 'allowance' }), restoredFrom: null }));
        expect(String(allowance.note)).toMatch(/Ask for more/);
        expect(String(allowance.note)).toMatch(/Never give a number or a price/);
        const busy = await run(asking({ ok: true, job: job({ status: 'queued', queuedFor: 'busy' }), restoredFrom: null }));
        expect(String(busy.note)).toMatch(/nothing needs asking for/);
    });

    it('starts no pretend job for one that is only waiting', async () => {
        const started = vi.fn();
        await run(asking({ ok: true, job: job({ status: 'queued', queuedFor: 'turn' }), restoredFrom: null }), { job: 'x' }, started);
        expect(started).not.toHaveBeenCalled();
    });

    it('tells a broken start, an off computer and a refusal each in one plain way, and never throws', async () => {
        const broken = String((await run(asking({ ok: false, reason: 'broken_start' }))).note);
        expect(broken).toMatch(/isn't starting right now/);
        // Nothing sends a message when the computer is back, so the note must not promise one
        expect(broken).not.toMatch(/you'll tell them/);
        expect(broken).toMatch(/Do not promise to tell them/);
        expect(String((await run(asking({ ok: false, reason: 'off' }))).note)).toMatch(/is off/);
        expect(String((await run(asking({ ok: false, reason: 'not_owner' }))).note)).toMatch(/can't be done/);
        // The team paused computers: said kindly, nothing is lost, and no price or reason is offered
        const paused = String((await run(asking({ ok: false, reason: 'paused' }))).note);
        expect(paused).toMatch(/paused for a while/);
        expect(paused).toMatch(/nothing is lost/i);
        expect(paused).toMatch(/Do not offer a price or a reason/);
        // No message is sent when computers are back, so the note must not promise one
        expect(paused).not.toMatch(/you'll tell them/);
        expect(paused).toMatch(/Do not promise to tell them/);
        const down = { startComputerJob: vi.fn().mockRejectedValue(new Error('offline')) };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await run(down)).toMatchObject({ started: false });
        warn.mockRestore();
        expect(await run(asking({}), {})).toEqual({ error: 'Say in a few words what the job is.' });
    });

    it('says it is not known whether a job started when the start was slow and Orbit could not say: not a failure, not a start, and to look before asking again', async () => {
        const unknown = await run(asking({ ok: false, reason: 'unknown' }));
        expect(unknown).toMatchObject({ started: false, unknown: true });
        expect(unknown).not.toHaveProperty('success');
        expect(unknown).not.toHaveProperty('starting');
        expect(String(unknown.note)).toMatch(/not known whether this job started/);
        expect(String(unknown.note)).toMatch(/couldn't confirm it/);
        expect(String(unknown.note)).toMatch(/look at the bar above this chat before asking again/);
        expect(String(unknown.note)).toMatch(/Do not say it failed or that it started/);
    });

    it('says the job was found and has already ended (not a connection failure, not running) when a slow start was matched to a job that failed or was stopped', async () => {
        const ended = await run(asking({ ok: false, reason: 'ended' }));
        expect(ended).toMatchObject({ started: false, ended: true });
        expect(ended).not.toHaveProperty('success');
        expect(String(ended.note)).toMatch(/already ended/);
        expect(String(ended.note)).toMatch(/bar above this chat/);
        // the generic connection failure says the computer could not be reached: this one must not
        expect(String(ended.note)).toMatch(/Do not say your computer could not be reached/);
        expect(String(ended.note)).not.toMatch(/could not be reached just now/);
    });

    it('says the job was found and has finished when Orbit tells the ask is over (`done`): a job that ran is never told as running or starting, and is not started again', async () => {
        const done = await run(asking({ ok: false, reason: 'done' }));
        expect(done).toMatchObject({ started: false, done: true });
        expect(done).not.toHaveProperty('success');
        expect(done).not.toHaveProperty('starting');
        const note = String(done.note);
        expect(note).toMatch(/Orbit found this job and it has finished/);
        expect(note).toMatch(/result and receipt are with this chat and in \[Usage\]\(#usage\)/);
        expect(note).toMatch(/Do not say it is running or starting/);
        expect(note).not.toMatch(/bar above this chat/);
        expect(note).not.toMatch(/could not be reached/);
        expect(resultOf('c1', done)).toMatchObject({ ok: true });
    });

    it('says that Orbit found the job, not that the computer is starting, when a slow start was matched to a queued, waiting or running job', async () => {
        const found = await run(asking({ ok: false, reason: 'starting' }));
        expect(found).toMatchObject({ started: false, found: true });
        expect(found).not.toHaveProperty('success');
        expect(found).not.toHaveProperty('starting');
        const note = String(found.note);
        expect(note).toMatch(/Orbit found this job/);
        expect(note).toMatch(/bar above this chat/);
        // nothing about the machine is claimed: only that the job exists and where its state shows
        expect(note).toMatch(/Do not say your computer is starting, that the job has begun, or will begin by itself/);
        expect(note).not.toMatch(/Your computer is starting/);
        expect(note).not.toMatch(/ask you again/);
        expect(note).not.toMatch(/could not be reached/);
        expect(resultOf('c1', found)).toMatchObject({ ok: true });
    });

    it('marks a job that did not start as a failed step, and a job that is running or waiting its turn as one that worked', async () => {
        const down = { startComputerJob: vi.fn().mockRejectedValue(new Error('offline')) };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const refused = ['off', 'broken_start', 'not_owner', 'not_open', 'not_set', 'paused', 'something_new'];
        expect(resultOf('c1', await run(down))).toMatchObject({ ok: false });
        warn.mockRestore();
        for (const reason of refused) {
            expect(resultOf('c1', await run(asking({ ok: false, reason })))).toMatchObject({ ok: false });
        }
        expect(resultOf('c1', await run(asking({ ok: true, job: job(), restoredFrom: null })))).toMatchObject({ ok: true });
        expect(resultOf('c1', await run(asking({ ok: true, job: job({ status: 'queued', queuedFor: 'turn' }), restoredFrom: null })))).toMatchObject({ ok: true });
    });

    it('shows as one step on the steps line', () => {
        expect(describeStep({ id: 'c1', name: COMPUTER_TOOL, arguments: { job: 'Visa form' } })).toMatchObject({ doing: 'Starting its computer, this takes a minute', done: 'Worked on its computer', detail: 'Visa form', kind: 'write' });
    });
});

describe('the key of an ask (GPT round 3, finding 3): the same ask is the same start for as long as its outcome is open, a second job is its own', () => {
    const KEY = /^[A-Za-z0-9_-]{8,64}$/;
    const keysOf = (admin: ReturnType<typeof asking>) => admin.startComputerJob.mock.calls.map((one) => (one[2] as { startKey: string }).startKey);
    const withKeys = (admin: ReturnType<typeof asking>, startKeys: Map<string, StartKeyEntry>, args: Record<string, unknown> = { job: 'Visa form' }, origin?: { kind: 'dm'; ref: string }) =>
        runComputerTool(args, { admin, botId: BRICK, userId: 'uuid-alice', startKeys, ...(origin ? { origin } : {}) });

    it('sends a key of the shape Orbit takes, a new one for each ask when nothing is kept', async () => {
        const admin = asking({ ok: true, job: job(), restoredFrom: null });
        await run(admin);
        await run(admin);
        const [first, second] = keysOf(admin);
        expect(first).toMatch(KEY);
        expect(second).toMatch(KEY);
        expect(first).not.toBe(second);
    });

    it('sends the SAME key when the same ask is made again (an automatic retry, a reconnect, the person asking again) after an answer that left it open or settled in the turn', async () => {
        for (const reason of ['unknown', 'starting', 'ended', 'done']) {
            const admin = asking({ ok: false, reason });
            const kept = new Map<string, StartKeyEntry>();
            await withKeys(admin, kept);
            await withKeys(admin, kept);
            const [first, second] = keysOf(admin);
            expect(second, reason).toBe(first);
            expect(kept.size).toBe(1);
        }
    });

    it('keeps the key for a whole success too, for the turn: the same ask again finds the same job, never a second one', async () => {
        const admin = asking({ ok: true, job: job(), restoredFrom: null });
        const kept = new Map<string, StartKeyEntry>();
        await withKeys(admin, kept);
        await withKeys(admin, kept);
        expect(keysOf(admin)[1]).toBe(keysOf(admin)[0]);
    });

    it('goes by the title and the chat: another title or another chat is another ask, and words the model changes when it asks again (the details) are not', async () => {
        const admin = asking({ ok: false, reason: 'unknown' });
        const kept = new Map<string, StartKeyEntry>();
        const here = { kind: 'dm' as const, ref: '!a:chat.test' };
        await withKeys(admin, kept, { job: 'Visa form' }, here);
        await withKeys(admin, kept, { job: 'Hotel booking' }, here);
        await withKeys(admin, kept, { job: 'Visa form' }, { kind: 'dm', ref: '!b:chat.test' });
        await withKeys(admin, kept, { job: 'Visa form' });
        await withKeys(admin, kept, { job: '  visa   FORM ', details: 'worded another way', reads_only: true }, here);
        const keys = keysOf(admin);
        expect(new Set(keys.slice(0, 4)).size).toBe(4);
        expect(keys[4]).toBe(keys[0]);
    });

    it('keeps the key of an ask whose outcome is open (unknown, starting) for ten minutes across turns, and a new message clears only what is settled', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
        const kept = new Map<string, StartKeyEntry>();
        const unknown = asking({ ok: false, reason: 'unknown' });
        const starting = asking({ ok: false, reason: 'starting' });
        const worked = asking({ ok: true, job: job(), restoredFrom: null });
        const over = asking({ ok: false, reason: 'ended' });
        await withKeys(unknown, kept, { job: 'Unknown one' });
        await withKeys(starting, kept, { job: 'Starting one' });
        await withKeys(worked, kept, { job: 'Worked one' });
        await withKeys(over, kept, { job: 'Ended one' });
        expect([...kept.values()].map((entry) => entry.open)).toEqual([true, true, false, false]);
        // the next message from the person
        forgetSettledStarts(kept);
        expect(kept.size).toBe(2);
        // asked again nine minutes on: the same job
        vi.setSystemTime(new Date('2026-11-21T10:09:00Z'));
        await withKeys(unknown, kept, { job: 'Unknown one' });
        await withKeys(worked, kept, { job: 'Worked one' });
        expect(unknown.startComputerJob.mock.calls[1][2]).toMatchObject({ startKey: (unknown.startComputerJob.mock.calls[0][2] as { startKey: string }).startKey });
        expect(worked.startComputerJob.mock.calls[1][2]).not.toMatchObject({ startKey: (worked.startComputerJob.mock.calls[0][2] as { startKey: string }).startKey });
        // after the ten minutes the ask is a new one, and a new message forgets what has run out
        vi.setSystemTime(new Date('2026-11-21T10:10:01Z'));
        forgetSettledStarts(kept);
        expect([...kept.keys()].some((asked) => asked.includes('starting one'))).toBe(false);
        await withKeys(unknown, kept, { job: 'Unknown one' });
        expect(unknown.startComputerJob.mock.calls[2][2]).not.toMatchObject({ startKey: (unknown.startComputerJob.mock.calls[0][2] as { startKey: string }).startKey });
    });

    it('does not send an old key for an ask made again after its ten minutes even when no new message cleared it (a long turn)', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
        const kept = new Map<string, StartKeyEntry>();
        const unknown = asking({ ok: false, reason: 'unknown' });
        await withKeys(unknown, kept);
        vi.setSystemTime(new Date('2026-11-21T10:10:01Z'));
        await withKeys(unknown, kept);
        const [first, second] = keysOf(unknown);
        expect(second).not.toBe(first);
        expect([...kept.values()].map((entry) => entry.key)).toEqual([second]);
    });

    it('settles the key once an ask that was open comes back over or done: a new message then starts clean', async () => {
        const kept = new Map<string, StartKeyEntry>();
        await withKeys(asking({ ok: false, reason: 'unknown' }), kept);
        expect([...kept.values()][0].open).toBe(true);
        await withKeys(asking({ ok: false, reason: 'done' }), kept);
        expect([...kept.values()][0].open).toBe(false);
        forgetSettledStarts(kept);
        expect(kept.size).toBe(0);
        forgetSettledStarts(undefined);
    });

    it('takes the key back when Orbit said no before it made anything (a refusal that is final, or a failure that made nothing): asking again is a new ask', async () => {
        for (const reason of ['off', 'paused', 'broken_start', 'not_owner', 'cheaper_route', 'something_new']) {
            const admin = asking({ ok: false, reason });
            const kept = new Map<string, StartKeyEntry>();
            await withKeys(admin, kept);
            expect(kept.size, reason).toBe(0);
            await withKeys(admin, kept);
            const [first, second] = keysOf(admin);
            expect(second, reason).not.toBe(first);
        }
        const down = { startComputerJob: vi.fn().mockRejectedValue(new Error('offline')) };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const kept = new Map<string, StartKeyEntry>();
        await withKeys(down as unknown as ReturnType<typeof asking>, kept);
        warn.mockRestore();
        expect(kept.size).toBe(0);
    });

    it('does not touch a key another ask made when this one is over', async () => {
        const kept = new Map<string, StartKeyEntry>();
        await withKeys(asking({ ok: false, reason: 'unknown' }), kept, { job: 'Hotel booking' });
        const before = [...kept.values()].map((entry) => entry.key);
        await withKeys(asking({ ok: false, reason: 'off' }), kept, { job: 'Visa form' });
        expect([...kept.values()].map((entry) => entry.key)).toEqual(before);
    });
});

describe('asking Orbit for a computer (#2000)', () => {
    const service = () => {
        const admin = new AdminApiService('http://orbit.test');
        vi.spyOn(admin, 'isConfigured').mockReturnValue(true);
        return admin;
    };
    const token = process.env.BOT_SERVICE_TOKEN;
    afterEach(() => {
        if (token === undefined) delete process.env.BOT_SERVICE_TOKEN;
        else process.env.BOT_SERVICE_TOKEN = token;
    });

    it('reads whether it is on, and a failure is off', async () => {
        process.env.BOT_SERVICE_TOKEN = 'secret';
        request.mockResolvedValueOnce({ data: { available: true, on: true, busy: false } });
        expect(await service().computerIsOn(BRICK, 'uuid-alice')).toBe(true);
        expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'get', params: { userId: 'uuid-alice' } }));
        request.mockResolvedValueOnce({ data: { available: false, on: true } });
        expect(await service().computerIsOn(BRICK, 'uuid-alice')).toBe(false);
        request.mockRejectedValueOnce(new Error('down'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await service().computerIsOn(BRICK, 'uuid-alice')).toBe(false);
        warn.mockRestore();
    });

    it('starts a job and reads Orbit’s answer without trusting its shape', async () => {
        process.env.BOT_SERVICE_TOKEN = 'secret';
        request.mockResolvedValueOnce({ data: { ok: true, job: { id: 'j1', status: 'queued', queuedFor: 'turn' }, restoredFrom: null } });
        expect(await service().startComputerJob(BRICK, 'uuid-alice', { title: 'Visa form' })).toEqual({ ok: true, job: { id: 'j1', status: 'queued', queuedFor: 'turn' }, restoredFrom: null });
        request.mockResolvedValueOnce({ data: { ok: false, reason: 'off' } });
        expect(await service().startComputerJob(BRICK, 'uuid-alice', { title: 'x' })).toEqual({ ok: false, reason: 'off' });
        request.mockResolvedValueOnce({ data: { ok: true, job: {} } });
        expect(await service().startComputerJob(BRICK, 'uuid-alice', { title: 'x' })).toEqual({ ok: false, reason: 'unknown' });
    });

    it('sends the plan Brick weighed with the start, and gives back the app Orbit says to use when it is the cheaper way', async () => {
        process.env.BOT_SERVICE_TOKEN = 'secret';
        request.mockResolvedValueOnce({ data: { ok: false, reason: 'cheaper_route', app: 'Notion' } });
        expect(await service().startComputerJob(BRICK, 'uuid-alice', { title: 'Add a page', plan: { app: 'Notion', steps: 3 } })).toEqual({ ok: false, reason: 'cheaper_route', app: 'Notion' });
        expect(JSON.stringify(request.mock.calls.at(-1))).toContain('"plan":{"app":"Notion","steps":3}');
        request.mockResolvedValueOnce({ data: { ok: true, job: { id: 'j1', status: 'queued', queuedFor: null } } });
        await service().startComputerJob(BRICK, 'uuid-alice', { title: 'x' });
        expect(JSON.stringify(request.mock.calls.at(-1))).not.toContain('plan');
    });

    it('throws when Orbit itself answers with a failure status (its own 400 or 401 shape), since every refusal comes as a 200 with a reason', async () => {
        process.env.BOT_SERVICE_TOKEN = 'secret';
        request.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 401'), { isAxiosError: true, response: { status: 401, data: { error: 'Unauthorized' } } }));
        await expect(service().startComputerJob(BRICK, 'uuid-alice', { title: 'x' })).rejects.toThrow(/401/);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('looks for the job of the start after a JSON 403 or 429 that is not Orbit\'s own shape (a gateway or a limiter in front of it may have answered, and the job made behind it)', async () => {
        process.env.BOT_SERVICE_TOKEN = 'secret';
        for (const status of [403, 429]) {
            request.mockReset();
            request.mockRejectedValueOnce(Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, response: { status, data: { error: 'Not allowed' } } }));
            request.mockImplementationOnce(async (config: { params?: { attempt?: string } }) => ({ data: { started: { id: 'j-made', status: 'running', attempt: config.params?.attempt } } }));
            expect(await service().startComputerJob(BRICK, 'uuid-alice', { title: 'x' }), String(status)).toEqual({ ok: false, reason: 'starting' });
            expect(request).toHaveBeenCalledTimes(2);
        }
    });

    it('looks for the job of the start after a 5xx (the answer may be a gateway\u2019s, and the job made behind it), and does not throw: the person is not told it failed', async () => {
        process.env.BOT_SERVICE_TOKEN = 'secret';
        request.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 500'), { isAxiosError: true, response: { status: 500 } }));
        request.mockImplementationOnce(async (config: { params?: { attempt?: string } }) => ({ data: { started: { id: 'j-made', status: 'running', attempt: config.params?.attempt } } }));
        expect(await service().startComputerJob(BRICK, 'uuid-alice', { title: 'x' })).toEqual({ ok: false, reason: 'starting' });
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('sweeps without ever throwing', async () => {
        process.env.BOT_SERVICE_TOKEN = 'secret';
        request.mockRejectedValueOnce(new Error('down'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await expect(service().sweepComputers()).resolves.toBeUndefined();
        warn.mockRestore();
        expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'post', data: {} }));
    });
});

describe('the pretend runner (development only)', () => {
    const calls = (status: () => string) => {
        const actions: Record<string, unknown>[] = [];
        return {
            actions,
            admin: {
                getComputerJob: vi.fn(async () => ({ id: 'j1', status: status(), control: 'brick' })),
                computerJobAction: vi.fn(async (_botId: string, _jobId: string, body: Record<string, unknown>) => {
                    actions.push(body);
                    return body.action === 'renew' ? { ok: true } : {};
                }),
            },
        };
    };

    it('is off unless asked for by name', () => {
        expect(pretendRunnerOn()).toBe(false);
        process.env.COMPUTER_PRETEND_RUNNER = 'yes';
        expect(pretendRunnerOn()).toBe(true);
    });

    it('walks the steps, renewing its room, and finishes', async () => {
        vi.useFakeTimers();
        const { admin, actions } = calls(() => 'running');
        runPretendJob(admin, BRICK, 'j1', 1000);
        await vi.advanceTimersByTimeAsync(10_000);
        const progress = actions.filter((one) => one.action === 'progress');
        expect(progress.map((one) => one.label)).toEqual([...PRETEND_STEPS]);
        expect(actions.some((one) => one.action === 'renew')).toBe(true);
        expect(actions.at(-1)).toEqual({ action: 'finish', outcome: 'done' });
    });

    it('waits while the person has taken over, and stops when the job is over', async () => {
        vi.useFakeTimers();
        let status = 'waiting';
        const { admin, actions } = calls(() => status);
        runPretendJob(admin, BRICK, 'j1', 1000);
        await vi.advanceTimersByTimeAsync(5000);
        expect(actions).toEqual([]);
        status = 'stopped';
        await vi.advanceTimersByTimeAsync(5000);
        expect(actions).toEqual([]);
        const polled = admin.getComputerJob.mock.calls.length;
        await vi.advanceTimersByTimeAsync(10_000);
        expect(admin.getComputerJob.mock.calls.length).toBe(polled);
    });

    it('stops when Orbit says its room is gone', async () => {
        vi.useFakeTimers();
        const { admin, actions } = calls(() => 'running');
        admin.computerJobAction.mockImplementation(async (_b: string, _j: string, body: Record<string, unknown>) => {
            actions.push(body);
            return body.action === 'renew' ? { ok: false, reason: 'allowance' } : {};
        });
        runPretendJob(admin, BRICK, 'j1', 1000);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(actions).toEqual([{ action: 'renew' }]);
    });
});

describe('who has the computer in a chat (#2000)', () => {
    type Ai = {
        noteBrick: AIService['noteBrick'];
        computerOnFor(botId: string, playerId: number, admin?: unknown): Promise<boolean>;
        runComputerToolCall(args: Record<string, unknown>, where: { adminApiService?: unknown; botId?: string; playerId?: number }): Promise<Record<string, unknown>>;
    };
    function service(admin: Record<string, unknown>, userUuid: string | null = 'uuid-alice', isGuest?: boolean) {
        const ai = Object.create(AIService.prototype) as AIService;
        Object.assign(ai, {
            helperBricks: new Set<string>(),
            ownBricks: new Set<string>(),
            knownBricks: new Set<string>(),
            brickOwners: new Map<string, string>(),
            computerOnCache: new Map(),
            adminApiService: { isConfigured: () => true, ...admin },
            conversationMemory: { getMemory: () => ({ userUuid: userUuid ?? undefined, ...(isGuest === undefined ? {} : { isGuest }) }) },
        });
        return ai as unknown as Ai;
    }

    it('asks Orbit only for a Brick of the person’s own, keeps the answer a moment, and a room bot or deleted Brick has none', async () => {
        const computerIsOn = vi.fn().mockResolvedValue(true);
        const ai = service({ computerIsOn });
        expect(await ai.computerOnFor(BRICK, 1)).toBe(false);
        expect(computerIsOn).not.toHaveBeenCalled();
        ai.noteBrick(BRICK, { isDefault: false });
        expect(await ai.computerOnFor(BRICK, 1)).toBe(true);
        expect(await ai.computerOnFor(BRICK, 1)).toBe(true);
        expect(computerIsOn).toHaveBeenCalledTimes(1);
        ai.noteBrick(BRICK, { isDefault: false, deleted: true });
        expect(await ai.computerOnFor(BRICK, 1)).toBe(false);
        ai.noteBrick(BRICK, undefined);
        expect(await ai.computerOnFor(BRICK, 1)).toBe(false);
    });

    it('says off when Orbit cannot be asked or the person is not known', async () => {
        const down = service({ computerIsOn: vi.fn().mockRejectedValue(new Error('down')) });
        down.noteBrick(BRICK, { isDefault: true });
        expect(await down.computerOnFor(BRICK, 1)).toBe(false);
        const nobody = service({ computerIsOn: vi.fn().mockResolvedValue(true) }, null);
        nobody.noteBrick(BRICK, { isDefault: true });
        expect(await nobody.computerOnFor(BRICK, 1)).toBe(false);
    });

    it('starts a job only from a Brick of their own, for the person who is in the chat', async () => {
        const startComputerJob = vi.fn().mockResolvedValue({ ok: true, job: { id: 'j1', status: 'queued', queuedFor: 'turn' }, restoredFrom: null });
        const ai = service({ startComputerJob });
        expect(await ai.runComputerToolCall({ job: 'x' }, { botId: BRICK, playerId: 1 })).toEqual({ error: "That can't be done in this chat right now." });
        ai.noteBrick(BRICK, { isDefault: false });
        expect(await ai.runComputerToolCall({ job: 'Taxi booking' }, { botId: BRICK, playerId: 1 })).toMatchObject({ queued: true });
        expect(startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', { title: 'Taxi booking', writes: undefined, startKey: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) });
    });

    it('keeps the key of an ask in the chat\'s memory: the same ask again sends it, a retried reply keeps all, and a new message from the person clears the settled and keeps the open', async () => {
        const startComputerJob = vi.fn().mockImplementation(async (_botId: string, _user: string, ask: { title: string }) => (ask.title === 'Taxi booking' ? { ok: false, reason: 'unknown' } : { ok: true, job: job(), restoredFrom: null }));
        const memory: Record<string, unknown> = { userUuid: 'uuid-alice' };
        const ai = Object.create(AIService.prototype) as AIService;
        Object.assign(ai, {
            helperBricks: new Set<string>(),
            ownBricks: new Set<string>(),
            knownBricks: new Set<string>(),
            brickOwners: new Map<string, string>(),
            computerOnCache: new Map(),
            botLimits: new Map(),
            adminApiService: { isConfigured: () => true, startComputerJob },
            conversationMemory: { getMemory: () => memory },
        });
        const chat = ai as unknown as Ai & { generateBotResponseStream: AIService['generateBotResponseStream'] };
        chat.noteBrick(BRICK, { isDefault: false });
        const keysOf = (title: string) => startComputerJob.mock.calls.filter((one) => (one[2] as { title: string }).title === title).map((one) => (one[2] as { startKey: string }).startKey);
        const ask = (job: string) => chat.runComputerToolCall({ job }, { botId: BRICK, playerId: 1 });
        await ask('Taxi booking');
        await ask('Taxi booking');
        await ask('Visa form');
        await ask('Visa form');
        expect(keysOf('Taxi booking')[1]).toBe(keysOf('Taxi booking')[0]);
        expect(keysOf('Visa form')[1]).toBe(keysOf('Visa form')[0]);
        // the reply begun again for the same message (a retry) keeps all of it
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const retried = chat.generateBotResponseStream(BRICK, 1, 'a message', '', 'none', 'matrix-dm', '', ...([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true] as never[]));
        await retried.next();
        await retried.return(undefined);
        expect((memory.computerStarts as Map<string, unknown>).size).toBe(2);
        // a new message from the person: what is settled goes, what is open (not known whether it started) stays, so asking again is still the same job
        const next = chat.generateBotResponseStream(BRICK, 1, 'a new message', '', 'none', 'matrix-dm', '');
        await next.next();
        await next.return(undefined);
        expect((memory.computerStarts as Map<string, unknown>).size).toBe(1);
        await ask('Taxi booking');
        await ask('Visa form');
        expect(keysOf('Taxi booking')[2]).toBe(keysOf('Taxi booking')[0]);
        expect(keysOf('Visa form')[2]).not.toBe(keysOf('Visa form')[0]);
    });

    it('sends the speaker\'s guest status from the chat\'s own memory with the job', async () => {
        for (const isGuest of [false, true]) {
            const startComputerJob = vi.fn().mockResolvedValue({ ok: true, job: { id: 'j1', status: 'queued', queuedFor: 'turn' }, restoredFrom: null });
            const ai = service({ startComputerJob }, 'uuid-alice', isGuest);
            ai.noteBrick(BRICK, { isDefault: false });
            await ai.runComputerToolCall({ job: 'Taxi booking' }, { botId: BRICK, playerId: 1 });
            expect(startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', { title: 'Taxi booking', isGuest, writes: undefined, startKey: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) });
        }
    });
});
