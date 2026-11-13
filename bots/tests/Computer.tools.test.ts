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
import { COMPUTER_TOOL, computerToolDefinitions, computerToolsNote, isComputerTool, runComputerTool } from '../ai/ComputerTools';
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
        expect(admin.startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', { title: 'Visa form', writes: false });
        expect(result).toMatchObject({ started: true });
        expect(started).toHaveBeenCalledWith('j1');
        expect(JSON.stringify(result)).not.toMatch(/\$|credit|\d+ ?%|machine|provider/i);
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
        expect(String((await run(asking({ ok: false, reason: 'broken_start' }))).note)).toMatch(/isn't starting right now/);
        expect(String((await run(asking({ ok: false, reason: 'off' }))).note)).toMatch(/is off/);
        expect(String((await run(asking({ ok: false, reason: 'not_owner' }))).note)).toMatch(/can't be done/);
        const down = { startComputerJob: vi.fn().mockRejectedValue(new Error('offline')) };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await run(down)).toMatchObject({ started: false });
        warn.mockRestore();
        expect(await run(asking({}), {})).toEqual({ error: 'Say in a few words what the job is.' });
    });

    it('marks a job that did not start as a failed step, and a job that is running or waiting its turn as one that worked', async () => {
        const down = { startComputerJob: vi.fn().mockRejectedValue(new Error('offline')) };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const refused = ['off', 'broken_start', 'not_owner', 'not_open', 'not_set', 'something_new'];
        expect(resultOf('c1', await run(down))).toMatchObject({ ok: false });
        warn.mockRestore();
        for (const reason of refused) {
            expect(resultOf('c1', await run(asking({ ok: false, reason })))).toMatchObject({ ok: false });
        }
        expect(resultOf('c1', await run(asking({ ok: true, job: job(), restoredFrom: null })))).toMatchObject({ ok: true });
        expect(resultOf('c1', await run(asking({ ok: true, job: job({ status: 'queued', queuedFor: 'turn' }), restoredFrom: null })))).toMatchObject({ ok: true });
    });

    it('shows as one step on the steps line', () => {
        expect(describeStep({ id: 'c1', name: COMPUTER_TOOL, arguments: { job: 'Visa form' } })).toMatchObject({ doing: 'Working on its computer', done: 'Worked on its computer', detail: 'Visa form', kind: 'write' });
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
    function service(admin: Record<string, unknown>, userUuid: string | null = 'uuid-alice') {
        const ai = Object.create(AIService.prototype) as AIService;
        Object.assign(ai, {
            helperBricks: new Set<string>(),
            ownBricks: new Set<string>(),
            computerOnCache: new Map(),
            adminApiService: { isConfigured: () => true, ...admin },
            conversationMemory: { getMemory: () => ({ userUuid: userUuid ?? undefined }) },
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
        expect(startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', { title: 'Taxi booking', writes: undefined });
    });
});
