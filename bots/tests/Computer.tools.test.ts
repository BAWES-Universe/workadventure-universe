/**
 * A Brick's computer in its owner's chat (game #2000), on the bot server: the tool is the last way, only offered while the computer is
 * on, says one true thing for each way a start can go, and never lets a count, a price or a machine name reach the model. The pretend
 * runner (development only) walks a job through its steps with the same calls the real runner will make.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), request: vi.fn(), isAxiosError: () => false }, isAxiosError: () => false }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import axios from 'axios';
import { AdminApiService } from '../server/AdminApiService';
import { AIService } from '../ai/AIService';
import { COMPUTER_TOOL, computerToolDefinitions, computerToolsNote, ConfirmationQueue, forgetSettledStarts, isComputerTool, OPEN_START_KEEP_MS, OPEN_START_SLOT, runComputerTool, type StartKeyEntry } from '../ai/ComputerTools';
import { deliverTold, runDelivered } from './helpers/deliveredComputerTool';
import type { StartKeyStore, StoredStartKey } from '../server/ComputerStartKeys';
import { PRETEND_STEPS, pretendRunnerOn, runPretendJob } from '../ai/ComputerPretendRunner';
import { describeStep, resultOf } from '../ai/ToolSteps';

const BRICK = '0b7c1d2e-1111-4222-8333-944455556666';
const request = axios.request as unknown as ReturnType<typeof vi.fn>;

const job = (over: Record<string, unknown> = {}) => ({ id: 'j1', status: 'running', queuedFor: null, ...over });
const asking = (answer: unknown) => ({ startComputerJob: vi.fn().mockResolvedValue(answer) });
const run = (admin: ReturnType<typeof asking>, args: Record<string, unknown> = { job: 'Visa form' }, onStarted?: (id: string) => void) =>
    runDelivered(args, { admin, botId: BRICK, userId: 'uuid-alice', onStarted });

/** A chat with no fixed line under the reply (a room): the model is the one that says it, so the note carries the words. */
const runBare = (admin: ReturnType<typeof asking>, args: Record<string, unknown> = { job: 'Visa form' }, onStarted?: (id: string) => void) =>
    runComputerTool(args, { admin: admin as never, botId: BRICK, userId: 'uuid-alice', onStarted }) as Promise<Record<string, unknown>>;

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
        expect(computerToolsNote()).toMatch(/answer yourself, then an App you have, then the computer/);
        expect(computerToolsNote()).toMatch(/without hesitation/);
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
        const turn = await runBare(asking({ ok: true, job: job({ status: 'queued', queuedFor: 'turn' }), restoredFrom: null }));
        expect(turn).toMatchObject({ started: false, queued: true });
        expect(String(turn.note)).toMatch(/one job at a time/);
        const allowance = await runBare(asking({ ok: true, job: job({ status: 'queued', queuedFor: 'allowance' }), restoredFrom: null }));
        expect(String(allowance.note)).toMatch(/Ask for more/);
        expect(String(allowance.note)).toMatch(/Never give a number or a price/);
        const busy = await runBare(asking({ ok: true, job: job({ status: 'queued', queuedFor: 'busy' }), restoredFrom: null }));
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
        expect(String(unknown.note)).toContain("I couldn't check whether this job has started. I'll use the same request when you check again.");
        expect(String(unknown.note)).toMatch(/look at the bar above this chat/);
        expect(String(unknown.note)).toMatch(/Do not say it failed or that it started/);
    });

    it('says the job was found and has already ended (not a connection failure, not running) when a slow start was matched to a job that failed or was stopped', async () => {
        const ended = await runBare(asking({ ok: false, reason: 'ended' }));
        expect(ended).toMatchObject({ started: false, ended: true });
        expect(ended).not.toHaveProperty('success');
        expect(String(ended.note)).toMatch(/already ended/);
        expect(String(ended.note)).toMatch(/bar above this chat/);
        // the generic connection failure says the computer could not be reached: this one must not
        expect(String(ended.note)).toMatch(/Do not say your computer could not be reached/);
        expect(String(ended.note)).not.toMatch(/could not be reached just now/);
    });

    it('says the job was found and has finished when Orbit tells the ask is over (`done`): a job that ran is never told as running or starting, and is not started again', async () => {
        const done = await runBare(asking({ ok: false, reason: 'done' }));
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
        const found = await runBare(asking({ ok: false, reason: 'starting' }));
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
        runDelivered(args, { admin, botId: BRICK, userId: 'uuid-alice', startKeys, ...(origin ? { origin } : {}) });

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

    it('a start that is SETTLED keeps its key for its own title in this turn only: another title or another chat is another ask, and words the model changes when it asks again (the details) are not', async () => {
        const admin = asking({ ok: true, job: job(), restoredFrom: null });
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

    it('keeps the open start across turns with NO time limit short of its safety life, whatever the title, and a new message clears only what is settled (GPT round 4, R1)', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
        for (const reason of ['unknown', 'starting']) {
            const kept = new Map<string, StartKeyEntry>();
            const open = asking({ ok: false, reason });
            await withKeys(open, kept, { job: 'Unknown one' });
            // the next message from the person
            forgetSettledStarts(kept);
            expect(kept.size, reason).toBe(1);
            // asked again eleven minutes on, then twenty-three hours on, reworded: the same start every time
            vi.setSystemTime(new Date('2026-11-22T10:11:00Z'));
            await withKeys(open, kept, { job: 'Unknown one' });
            vi.setSystemTime(new Date('2026-11-23T09:00:00Z'));
            forgetSettledStarts(kept);
            await withKeys(open, kept, { job: 'Something else entirely' });
            const [first, second, third] = keysOf(open);
            expect(second, reason).toBe(first);
            expect(third, reason).toBe(first);
            vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
        }
        // a start that is settled keeps its key for the turn only
        const kept = new Map<string, StartKeyEntry>();
        const worked = asking({ ok: true, job: job(), restoredFrom: null });
        const over = asking({ ok: false, reason: 'ended' });
        await withKeys(worked, kept, { job: 'Worked one' });
        await withKeys(over, kept, { job: 'Ended one' });
        expect([...kept.values()].map((entry) => entry.open)).toEqual([false, false]);
        forgetSettledStarts(kept);
        expect(kept.size).toBe(0);
        // only the safety life ends an open start nobody could resolve: a day on, it is forgotten and the ask is a new one
        const stale = new Map<string, StartKeyEntry>();
        const unknown = asking({ ok: false, reason: 'unknown' });
        await withKeys(unknown, stale, { job: 'Unknown one' });
        vi.setSystemTime(new Date('2026-11-22T10:00:00Z').getTime() + OPEN_START_KEEP_MS + 1000);
        forgetSettledStarts(stale);
        expect(stale.size).toBe(0);
    });

    it('does not send a key older than the safety life even when no new message cleared it (a very long turn), and sends the key of an open start of 23 hours', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
        const kept = new Map<string, StartKeyEntry>();
        const unknown = asking({ ok: false, reason: 'unknown' });
        await withKeys(unknown, kept);
        vi.setSystemTime(new Date('2026-11-23T09:00:00Z'));
        await withKeys(unknown, kept);
        vi.setSystemTime(new Date('2026-11-23T10:00:01Z'));
        await withKeys(unknown, kept);
        const [first, second, third] = keysOf(unknown);
        expect(second).toBe(first);
        expect(third).not.toBe(first);
        expect([...kept.values()].map((entry) => entry.key)).toEqual([third]);
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

    it('an entry that a successful or ended call settled stays settled when a later call of the same ask (they share one entry) comes back unknown: the next message removes it', async () => {
        const kept = new Map<string, StartKeyEntry>();
        await withKeys(asking({ ok: false, reason: 'unknown' }), kept);
        expect([...kept.values()][0].open).toBe(true);
        await withKeys(asking({ ok: true, job: job(), restoredFrom: null }), kept);
        expect([...kept.values()][0].open).toBe(false);
        const entry = [...kept.values()][0];
        // the second call of the same ask finds the same entry: its unknown answer does not open it again
        await withKeys(asking({ ok: false, reason: 'unknown' }), kept);
        expect([...kept.values()]).toEqual([entry]);
        expect(entry.open).toBe(false);
        // the same when it ended
        await withKeys(asking({ ok: false, reason: 'starting' }), kept);
        expect(entry.open).toBe(false);
        forgetSettledStarts(kept);
        expect(kept.size).toBe(0);
        // an entry nothing has settled keeps its unknown outcome open (no regression)
        const open = new Map<string, StartKeyEntry>();
        await withKeys(asking({ ok: false, reason: 'unknown' }), open);
        await withKeys(asking({ ok: false, reason: 'starting' }), open);
        expect([...open.values()][0].open).toBe(true);
        forgetSettledStarts(open);
        expect(open.size).toBe(1);
    });

    it('two asks made at the same moment (parallel tool calls) are never in flight beside each other: the second waits for the first and then sees how it ended, so one key goes out', async () => {
        const kept = new Map<string, StartKeyEntry>();
        let release: (value: StoredStartKey) => void = () => undefined;
        const claims: StoredStartKey[] = [];
        const store: StartKeyStore = {
            claim: vi.fn((_scope: string, entry: StoredStartKey) => {
                claims.push(entry);
                return new Promise<StoredStartKey>((resolve) => {
                    release = resolve;
                });
            }),
            delete: vi.fn().mockResolvedValue(undefined),
        };
        const admin = asking({ ok: false, reason: 'unknown' });
        const ask = (title: string) => runDelivered({ job: title }, { admin: admin as never, botId: BRICK, userId: 'uuid-alice', startKeys: kept, startKeyStore: store });
        // two asks with DIFFERENT titles: one open start per person and Brick, so the second is that start too
        const both = Promise.all([ask('Visa form'), ask('Hotel booking')]);
        // the first is waiting for the store and the ask is already in the chat's memory under one entry; the second waits behind it
        await new Promise((resolve) => setImmediate(resolve));
        expect(kept.size).toBe(1);
        expect(store.claim).toHaveBeenCalledTimes(1);
        // another server's key won: the first sends THAT key, the entry follows it, and the second (asked after the first ended) sends it again
        release({ key: 'held-by-another-01', at: Date.now() - 2000, payload: { title: 'Visa form' } });
        await new Promise((resolve) => setImmediate(resolve));
        release({ key: 'held-by-another-01', at: Date.now() - 2000, payload: { title: 'Visa form' } });
        await both;
        expect(keysOf(admin)).toEqual(['held-by-another-01', 'held-by-another-01']);
        expect([...kept.values()].map((entry) => entry.key)).toEqual(['held-by-another-01']);
    });

    it('two starts at the same moment, no key known and the store silent: neither sends anything, and both are told the ask could not be checked', async () => {
        const store: StartKeyStore = { claim: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };
        const kept = new Map<string, StartKeyEntry>();
        const admin = asking({ ok: true, job: job(), restoredFrom: null });
        const told = await Promise.all([1, 2].map(() => runDelivered({ job: 'Visa form' }, { admin: admin as never, botId: BRICK, userId: 'uuid-alice', startKeys: kept, startKeyStore: store })));
        expect(admin.startComputerJob).not.toHaveBeenCalled();
        expect(told).toEqual([expect.objectContaining({ unconfirmed: true }), expect.objectContaining({ unconfirmed: true })]);
        expect(kept.size).toBe(0);
    });

    it('tells the person a job that is already waiting for them needs them, and never that it is running', async () => {
        const started: string[] = [];
        const result = (await runBare(asking({ ok: true, job: job({ status: 'waiting' }), restoredFrom: null }), { job: 'Visa form' }, (id) => started.push(id))) as { started: boolean; waiting?: boolean; note: string };
        expect(started).toEqual(['j1']);
        expect(result).toMatchObject({ started: true, waiting: true });
        expect(result.note).toMatch(/waiting for them/);
        expect(result.note).toMatch(/needs them/);
        expect(result.note).toMatch(/Do not say it is running/);
        const running = (await runBare(asking({ ok: true, job: job(), restoredFrom: null }))) as { waiting?: boolean; note: string };
        expect(running.waiting).toBeUndefined();
        expect(running.note).toMatch(/running/);
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

    it('a no from Orbit to a LATER send of an open start does not end the start: a start that may have gone out before is not answered by it (the key stays, open)', async () => {
        const kept = new Map<string, StartKeyEntry>();
        await withKeys(asking({ ok: false, reason: 'unknown' }), kept, { job: 'Hotel booking' });
        const before = [...kept.values()].map((entry) => entry.key);
        const later = asking({ ok: false, reason: 'off' });
        await withKeys(later, kept, { job: 'Visa form' });
        // the second ask is that start (one open start per person and Brick): its key was sent again, and kept
        expect(keysOf(later)).toEqual(before);
        expect([...kept.values()].map((entry) => entry.key)).toEqual(before);
        expect([...kept.values()][0].open).toBe(true);
        // a thrown error (Orbit's own 400, nothing made by this send) keeps it as well
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await withKeys({ startComputerJob: vi.fn().mockRejectedValue(new Error('refused')) } as unknown as ReturnType<typeof asking>, kept, { job: 'Visa form' });
        warn.mockRestore();
        expect([...kept.values()].map((entry) => entry.key)).toEqual(before);
    });
});

describe('the key of an ask survives a restart of the server (Opus ruling on GPT round 3, finding 3): kept in the shared store while the outcome is open', () => {
    const KEY = /^[A-Za-z0-9_-]{8,64}$/;
    /** The shared store, as a map that remembers every call made to it. `claim` is one step, as the store's script is: the key held while it is good, else the caller's. */
    function sharedStore() {
        const held = new Map<string, StoredStartKey & { keepMs: number }>();
        const log: string[] = [];
        const store: StartKeyStore = {
            claim: vi.fn(async (scope: string, entry: StoredStartKey, keepMs: number, lifeMs: number) => {
                log.push('claim');
                const old = held.get(scope);
                if (old && old.at >= Date.now() - lifeMs) return { key: old.key, at: old.at, ...(old.payload ? { payload: old.payload } : {}) };
                held.set(scope, { ...entry, keepMs });
                return { key: entry.key, at: entry.at, ...(entry.payload ? { payload: entry.payload } : {}) };
            }),
            delete: vi.fn(async (scope: string, key: string) => {
                log.push('delete');
                if (held.get(scope)?.key === key) held.delete(scope);
            }),
        };
        return { store, held, log };
    }
    /** An ask as a server that has just started makes it: no key in its own memory, only the store. */
    const asAfterRestart = (admin: unknown, store: StartKeyStore, args: Record<string, unknown> = { job: 'Visa form' }, over: Record<string, unknown> = {}) =>
        runDelivered(args, { admin: admin as never, botId: BRICK, userId: 'uuid-alice', startKeys: new Map(), startKeyStore: store, ...over });
    const keysOf = (admin: ReturnType<typeof asking>) => admin.startComputerJob.mock.calls.map((one) => (one[2] as { startKey: string }).startKey);

    it('keeps the key in the store BEFORE the start is sent, with the whole safety life (a day), and nothing else of the ask (no title, no chat)', async () => {
        const { store, held } = sharedStore();
        let heldWhenSent: string[] = [];
        const admin = { startComputerJob: vi.fn(async () => { heldWhenSent = [...held.values()].map((entry) => entry.key); return { ok: false, reason: 'unknown' }; }) };
        await asAfterRestart(admin, store);
        const [[scope, entry]] = [...held.entries()];
        expect(heldWhenSent).toEqual([entry.key]);
        expect(entry.key).toMatch(KEY);
        expect(entry.keepMs).toBe(OPEN_START_KEEP_MS);
        expect(scope).toContain(BRICK);
        expect(scope).toContain('uuid-alice');
        // the key, when it was first sent, and what that start said (the words that go again under it): nothing else
        expect(Object.keys(entry).sort()).toEqual(['at', 'keepMs', 'key', 'payload']);
        expect(entry.payload).toEqual({ title: 'Visa form' });
        expect((admin.startComputerJob.mock.calls as unknown[][])[0][2]).toMatchObject({ startKey: entry.key });
    });

    it('sends the SAME key after a restart while the outcome is open (unknown, starting): a fresh memory and the same store', async () => {
        for (const reason of ['unknown', 'starting']) {
            const { store } = sharedStore();
            const admin = asking({ ok: false, reason });
            await asAfterRestart(admin, store);
            // the server restarted: another memory, the same store
            await asAfterRestart(admin, store);
            await asAfterRestart(admin, store);
            const [first, second, third] = keysOf(admin);
            expect(second, reason).toBe(first);
            expect(third, reason).toBe(first);
        }
    });

    it('keeps the life of the FIRST send: a key put back after the store lost it keeps only what is left of its safety life, never a new one, and one the store holds is left as it is', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
        const { store, held } = sharedStore();
        const admin = asking({ ok: false, reason: 'unknown' });
        const memory = new Map<string, StartKeyEntry>();
        const ask = () => runDelivered({ job: 'Visa form' }, { admin: admin as never, botId: BRICK, userId: 'uuid-alice', startKeys: memory, startKeyStore: store });
        await ask();
        expect([...held.values()][0].keepMs).toBe(OPEN_START_KEEP_MS);
        vi.setSystemTime(new Date('2026-11-21T10:04:00Z'));
        // the store still holds it: left exactly as it was
        await ask();
        expect([...held.values()][0]).toMatchObject({ at: new Date('2026-11-21T10:00:00Z').getTime(), keepMs: OPEN_START_KEEP_MS });
        // the store lost it: put back under the moment of the first send, for what is left
        held.clear();
        await ask();
        const [entry] = [...held.values()];
        expect(entry.at).toBe(new Date('2026-11-21T10:00:00Z').getTime());
        expect(entry.keepMs).toBe(OPEN_START_KEEP_MS - 4 * 60_000);
        expect(new Set(keysOf(admin)).size).toBe(1);
    });

    it('sends a new key only when the stored one is older than the safety life (the store did not expire it yet), and keeps the new one; a key of 23 hours is still the key', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
        const { store, held } = sharedStore();
        const admin = asking({ ok: false, reason: 'unknown' });
        await asAfterRestart(admin, store);
        // eleven minutes and twenty-three hours on, from a fresh process each time: the same key
        vi.setSystemTime(new Date('2026-11-22T10:11:00Z'));
        await asAfterRestart(admin, store);
        vi.setSystemTime(new Date('2026-11-23T09:00:00Z'));
        await asAfterRestart(admin, store, { job: 'A reworded ask' });
        expect(new Set(keysOf(admin)).size).toBe(1);
        vi.setSystemTime(new Date('2026-11-23T10:00:01Z'));
        await asAfterRestart(admin, store);
        const [first, , , fourth] = keysOf(admin);
        expect(fourth).not.toBe(first);
        expect([...held.values()].map((entry) => entry.key)).toEqual([fourth]);
        expect([...held.values()][0].keepMs).toBe(OPEN_START_KEEP_MS);
    });

    it('deletes the stored key when the outcome is final, so the next ask of the same thing is a new job: a job that worked, ended or finished, and every refusal', async () => {
        const settled: unknown[] = [{ ok: true, job: job(), restoredFrom: null }, { ok: false, reason: 'ended' }, { ok: false, reason: 'done' }, ...['off', 'paused', 'broken_start', 'not_owner', 'cheaper_route', 'something_new'].map((reason) => ({ ok: false, reason }))];
        for (const answer of settled) {
            const { store, held } = sharedStore();
            const admin = asking(answer);
            await asAfterRestart(admin, store);
            expect(held.size, JSON.stringify(answer)).toBe(0);
            await asAfterRestart(admin, store);
            expect(keysOf(admin)[1], JSON.stringify(answer)).not.toBe(keysOf(admin)[0]);
        }
    });

    it('deletes it when the start fails with an answer that made nothing (a thrown error)', async () => {
        const { store, held } = sharedStore();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const admin = { startComputerJob: vi.fn().mockRejectedValue(new Error('offline')) };
        await asAfterRestart(admin, store);
        warn.mockRestore();
        expect(held.size).toBe(0);
    });

    it('takes back an open key once the same ask comes back settled: the key of the start that made the job is not kept past the job', async () => {
        const { store, held } = sharedStore();
        await asAfterRestart(asking({ ok: false, reason: 'unknown' }), store);
        expect(held.size).toBe(1);
        await asAfterRestart(asking({ ok: false, reason: 'done' }), store);
        expect(held.size).toBe(0);
    });

    it('does not touch the key of another person or Brick: each is its own entry; the title and the chat are not part of it (one open start per person and Brick)', async () => {
        const { store, held } = sharedStore();
        const open = asking({ ok: false, reason: 'unknown' });
        await asAfterRestart(open, store, { job: 'Hotel booking' });
        await asAfterRestart(open, store, { job: 'Visa form' });
        await asAfterRestart(open, store, { job: 'Visa form' }, { origin: { kind: 'dm', ref: '!room:chat.test' } });
        expect(held.size).toBe(1);
        expect(new Set(keysOf(open)).size).toBe(1);
        await asAfterRestart(open, store, { job: 'Visa form' }, { userId: 'uuid-bob' });
        await asAfterRestart(open, store, { job: 'Visa form' }, { botId: '0b7c1d2e-9999-4222-8333-944455556666' });
        expect(held.size).toBe(3);
        expect(new Set(keysOf(open)).size).toBe(3);
        const before = [...held.values()].map((entry) => entry.key);
        // a no to a later send of one start does not take it back, and never touches the others
        await asAfterRestart(asking({ ok: false, reason: 'off' }), store, { job: 'Visa form' });
        expect([...held.values()].map((entry) => entry.key)).toEqual(before);
        // settled: only that person's and Brick's key is taken back
        await asAfterRestart(asking({ ok: false, reason: 'done' }), store, { job: 'Visa form' });
        expect(held.size).toBe(2);
        expect([...held.values()].map((entry) => entry.key).every((key) => before.includes(key))).toBe(true);
    });

    it('keeps the key in the chat\'s memory while the start is in flight, so a new message of the person that arrives meanwhile does not clear it (the same ask then is the same start), and settles it once the answer is a final one', async () => {
        const { store } = sharedStore();
        const memory = new Map<string, StartKeyEntry>();
        let during: number | undefined;
        const admin = {
            startComputerJob: vi.fn(async () => {
                forgetSettledStarts(memory);
                during = memory.size;
                return { ok: true, job: job(), restoredFrom: null };
            }),
        };
        await runDelivered({ job: 'Visa form' }, { admin: admin as never, botId: BRICK, userId: 'uuid-alice', startKeys: memory, startKeyStore: store });
        expect(during).toBe(1);
        expect([...memory.values()][0].open).toBe(false);
        // the same, found again after a restart: a key found in the store is in flight too
        const fresh = new Map<string, StartKeyEntry>();
        const { store: other, held } = sharedStore();
        const open = asking({ ok: false, reason: 'unknown' });
        await runDelivered({ job: 'Visa form' }, { admin: open as never, botId: BRICK, userId: 'uuid-alice', startKeys: new Map(), startKeyStore: other });
        const duringStored = { startComputerJob: vi.fn(async () => { forgetSettledStarts(fresh); return { ok: false, reason: 'unknown' }; }) };
        await runDelivered({ job: 'Visa form' }, { admin: duringStored as never, botId: BRICK, userId: 'uuid-alice', startKeys: fresh, startKeyStore: other });
        expect(fresh.size).toBe(1);
        expect(held.size).toBe(1);
    });

    it('sends the key of the process\'s own memory when the store holds none or the same, and claims it in the store each time so another server finds it', async () => {
        const { store, held } = sharedStore();
        const admin = asking({ ok: false, reason: 'unknown' });
        const memory = new Map<string, StartKeyEntry>();
        const ask = () => runDelivered({ job: 'Visa form' }, { admin: admin as never, botId: BRICK, userId: 'uuid-alice', startKeys: memory, startKeyStore: store });
        await ask();
        await ask();
        expect(store.claim).toHaveBeenCalledTimes(2);
        expect(keysOf(admin)[1]).toBe(keysOf(admin)[0]);
        // the store lost it (flushed): the memory's key is put back, with what was left of its ten minutes, never a new key
        held.clear();
        await ask();
        expect(keysOf(admin)[2]).toBe(keysOf(admin)[0]);
        expect([...held.values()].map((entry) => entry.key)).toEqual([keysOf(admin)[0]]);
    });

    it('sends the key the store holds, not its own, when another server claimed it first: the first key of an ask wins, and the memory follows it', async () => {
        const { store, held } = sharedStore();
        const scope = `${BRICK}|uuid-alice`;
        const first = { key: 'first-server-key', at: Date.now() - 1000, payload: { title: 'Visa form' } };
        held.set(scope, { ...first, keepMs: OPEN_START_KEEP_MS });
        const admin = asking({ ok: false, reason: 'unknown' });
        const memory = new Map<string, StartKeyEntry>();
        memory.set(OPEN_START_SLOT, { key: 'my-own-old-key-1', at: Date.now() - 60_000, open: true, payload: { title: 'Visa form' } });
        await runDelivered({ job: 'Visa form' }, { admin: admin as never, botId: BRICK, userId: 'uuid-alice', startKeys: memory, startKeyStore: store });
        expect(keysOf(admin)).toEqual(['first-server-key']);
        expect([...memory.values()]).toEqual([{ key: 'first-server-key', at: first.at, open: true, sent: true, payload: { title: 'Visa form' } }]);
        // settled: the key the store gave is the one taken back
        await runDelivered({ job: 'Visa form' }, { admin: asking({ ok: true, job: job(), restoredFrom: null }) as never, botId: BRICK, userId: 'uuid-alice', startKeys: memory, startKeyStore: store });
        expect(held.size).toBe(0);
    });

    it('two servers handling the same ask at the same moment, each with an empty memory, send the SAME key: one job, never two', async () => {
        const { store, held } = sharedStore();
        const one = asking({ ok: false, reason: 'unknown' });
        const two = asking({ ok: false, reason: 'unknown' });
        await Promise.all([asAfterRestart(one, store), asAfterRestart(two, store), asAfterRestart(one, store)]);
        const keys = [...keysOf(one), ...keysOf(two)];
        expect(keys).toHaveLength(3);
        expect(new Set(keys).size).toBe(1);
        expect(held.size).toBe(1);
    });

    it('works with the store alone (no memory of the chat), and with the memory alone (no store)', async () => {
        const { store } = sharedStore();
        const admin = asking({ ok: false, reason: 'unknown' });
        const ask = () => runDelivered({ job: 'Visa form' }, { admin: admin as never, botId: BRICK, userId: 'uuid-alice', startKeyStore: store });
        await ask();
        await ask();
        expect(keysOf(admin)[1]).toBe(keysOf(admin)[0]);
        const noStore = asking({ ok: false, reason: 'unknown' });
        const memory = new Map<string, StartKeyEntry>();
        await withMemory(noStore, memory);
        await withMemory(noStore, memory);
        expect(keysOf(noStore)[1]).toBe(keysOf(noStore)[0]);
        function withMemory(target: ReturnType<typeof asking>, startKeys: Map<string, StartKeyEntry>) {
            return runDelivered({ job: 'Visa form' }, { admin: target as never, botId: BRICK, userId: 'uuid-alice', startKeys });
        }
    });

    it('goes on with the memory\'s key when the store fails at any call or does not answer, and still sends the start (the store never holds a tool call)', async () => {
        const failing: StartKeyStore = {
            claim: vi.fn().mockRejectedValue(new Error('down')),
            delete: vi.fn().mockRejectedValue(new Error('down')),
        };
        // this process already knows the key of the ask (an attempt it made itself): the store's silence changes nothing
        const memory = new Map<string, StartKeyEntry>([[OPEN_START_SLOT, { key: 'my-own-key-0001', at: Date.now() - 1000, open: true, payload: { title: 'Visa form' } }]]);
        const admin = asking({ ok: false, reason: 'unknown' });
        const ask = () => runDelivered({ job: 'Visa form' }, { admin: admin as never, botId: BRICK, userId: 'uuid-alice', startKeys: memory, startKeyStore: failing });
        expect(await ask()).toBeTruthy();
        expect(await ask()).toBeTruthy();
        expect(admin.startComputerJob).toHaveBeenCalledTimes(2);
        expect(keysOf(admin)).toEqual(['my-own-key-0001', 'my-own-key-0001']);
        // a store that is not expected to hold anything (one machine, no shared store) never stops an ask, known key or not
        const alone: StartKeyStore = { ...failing, expected: () => false };
        const settled = asking({ ok: true, job: job(), restoredFrom: null });
        await runDelivered({ job: 'Another' }, { admin: settled as never, botId: BRICK, userId: 'uuid-alice', startKeyStore: alone });
        const refused = asking({ ok: false, reason: 'off' });
        await runDelivered({ job: 'Another again' }, { admin: refused as never, botId: BRICK, userId: 'uuid-alice', startKeyStore: alone });
        expect(alone.delete).toHaveBeenCalled();
        expect(settled.startComputerJob).toHaveBeenCalledTimes(1);
        expect(refused.startComputerJob).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['fails', () => vi.fn().mockRejectedValue(new Error('down'))],
        ['answers nothing', () => vi.fn().mockResolvedValue(undefined)],
    ])('sends NOTHING when this process knows no key of the ask and the shared store %s: a key of an attempt a restart forgot may be held there, and a new key would make a second job beside it (a second charge); the ask is told as one that could not be checked, and nothing is kept for it', async (_name, claim) => {
        const failing: StartKeyStore = { claim: claim(), delete: vi.fn().mockResolvedValue(undefined) };
        const memory = new Map<string, StartKeyEntry>();
        const admin = asking({ ok: true, job: job(), restoredFrom: null });
        const told = await runDelivered({ job: 'Visa form' }, { admin: admin as never, botId: BRICK, userId: 'uuid-alice', startKeys: memory, startKeyStore: failing });
        expect(admin.startComputerJob).not.toHaveBeenCalled();
        expect(told).toMatchObject({ started: false, unconfirmed: true });
        expect(String((told as { note: string }).note)).toContain("I couldn't check whether this job has started. I'll use the same request when you check again.");
        expect(String((told as { note: string }).note)).toMatch(/do not say it failed or that it started/i);
        expect(memory.size).toBe(0);
    });

    it('goes on with the key the store holds when it answers in time, with no key known here (the held attempt\'s key, never a new one)', async () => {
        const { store, held } = sharedStore();
        const scope = `${BRICK}|uuid-alice`;
        held.set(scope, { key: 'held-by-restart-1', at: Date.now() - 5000, payload: { title: 'Visa form' }, keepMs: OPEN_START_KEEP_MS });
        const admin = asking({ ok: false, reason: 'unknown' });
        await asAfterRestart(admin, store);
        expect(keysOf(admin)).toEqual(['held-by-restart-1']);
    });

    it('two starts of one ask made at the same moment send the same key when the store keeps ours, and when there is no store at all', async () => {
        const { store, held } = sharedStore();
        const kept = new Map<string, StartKeyEntry>();
        const admin = asking({ ok: false, reason: 'unknown' });
        await Promise.all([1, 2, 3].map(() => runDelivered({ job: 'Visa form' }, { admin: admin as never, botId: BRICK, userId: 'uuid-alice', startKeys: kept, startKeyStore: store })));
        expect(new Set(keysOf(admin)).size).toBe(1);
        // (one at a time: each ask claims for itself after the one before it ended)
        expect(store.claim).toHaveBeenCalledTimes(3);
        expect(held.size).toBe(1);
        const alone = asking({ ok: false, reason: 'unknown' });
        const memory = new Map<string, StartKeyEntry>();
        await Promise.all([1, 2].map(() => runDelivered({ job: 'Visa form' }, { admin: alone as never, botId: BRICK, userId: 'uuid-alice', startKeys: memory })));
        expect(new Set(keysOf(alone)).size).toBe(1);
    });

    describe('an answer that comes late for an attempt the shared entry has left (CodeRabbit on cb0aebad; GPT round 4 made it impossible)', () => {
        const scopeOf = `${BRICK}|uuid-alice`;
        // No timers: a call is entered when its mock says so, and "has not gone out" is read after every pending step of the other call has run (many turns of the microtask queue)
        const deferred = () => {
            let resolve!: () => void;
            const promise = new Promise<void>((done) => (resolve = done));
            return { promise, resolve };
        };
        const settle = async () => {
            for (let step = 0; step < 100; step++) await Promise.resolve();
        };

        it('a second ask never goes out while the first is in flight: it waits and sees how it ended, so an answer cannot come late for a key the entry has left', async () => {
            const { store, held } = sharedStore();
            const memory = new Map<string, StartKeyEntry>();
            let answerFirst!: () => void;
            const entered = deferred();
            const first = { startComputerJob: vi.fn(async () => { entered.resolve(); await new Promise<void>((resolve) => (answerFirst = resolve)); return { ok: true, job: job(), restoredFrom: null }; }) };
            const retry = asking({ ok: false, reason: 'unknown' });
            const ask = (admin: unknown, title = 'Visa form') => runDelivered({ job: title }, { admin: admin as never, botId: BRICK, userId: 'uuid-alice', startKeys: memory, startKeyStore: store });
            const one = ask(first);
            await entered.promise;
            const k1 = keysOf(first as never)[0];
            // another server settles K1 and holds K2 for the next ask while the first is still waiting for its answer
            held.clear();
            held.set(scopeOf, { key: 'second-attempt-02', at: Date.now(), payload: { title: 'Visa form' }, keepMs: OPEN_START_KEEP_MS });
            const two = ask(retry, 'Another job');
            await settle();
            // the retry has NOT gone out: it waits for the first
            expect(retry.startComputerJob).not.toHaveBeenCalled();
            answerFirst();
            await one;
            await two;
            // the first settled its own entry (a job was made under K1); the retry then went on as a new ask of its own, never as K1
            expect(keysOf(first as never)).toEqual([k1]);
            expect(retry.startComputerJob).toHaveBeenCalledTimes(1);
            expect(keysOf(retry)).toEqual(['second-attempt-02']);
            // (the first's settled entry serves its own title for this turn; the open start is K2)
            expect([...memory.values()].map((entry) => [entry.key, entry.open])).toEqual([[k1, false], ['second-attempt-02', true]]);
            expect([...held.values()].map((entry) => entry.key)).toEqual(['second-attempt-02']);
        });

        it('a first ask that throws (a start that made nothing) leaves the next one a clean ask: it was waiting, and now sends a key of its own', async () => {
            const { store } = sharedStore();
            const memory = new Map<string, StartKeyEntry>();
            let fail!: () => void;
            const entered = deferred();
            const first = { startComputerJob: vi.fn(async () => { entered.resolve(); await new Promise<void>((_resolve, reject) => (fail = () => reject(new Error('nothing sent')))); }) };
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const ask = (admin: unknown) => runDelivered({ job: 'Visa form' }, { admin: admin as never, botId: BRICK, userId: 'uuid-alice', startKeys: memory, startKeyStore: store });
            const one = ask(first);
            await entered.promise;
            const retry = asking({ ok: false, reason: 'unknown' });
            const two = ask(retry);
            await settle();
            expect(retry.startComputerJob).not.toHaveBeenCalled();
            fail();
            await one;
            await two;
            warn.mockRestore();
            expect(keysOf(retry)).toHaveLength(1);
            expect(keysOf(retry)[0]).not.toBe(keysOf(first as never)[0]);
        });

        it('the same attempt still settles its own entry, and a late unknown still cannot reopen it', async () => {
            const { store, held } = sharedStore();
            const memory = new Map<string, StartKeyEntry>();
            await runDelivered({ job: 'Visa form' }, { admin: asking({ ok: true, job: job(), restoredFrom: null }) as never, botId: BRICK, userId: 'uuid-alice', startKeys: memory, startKeyStore: store });
            expect([...memory.values()][0].open).toBe(false);
            expect(held.size).toBe(0);
            await runDelivered({ job: 'Visa form' }, { admin: asking({ ok: false, reason: 'unknown' }) as never, botId: BRICK, userId: 'uuid-alice', startKeys: memory, startKeyStore: store });
            expect([...memory.values()][0].open).toBe(false);
        });
    });

    it('judges a stored key by the moment it was first sent, never by the time it is read: one sent twenty-three hours and fifty-nine minutes ago is still the key', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-22T09:59:00Z'));
        const { store, held } = sharedStore();
        const scope = `${BRICK}|uuid-alice`;
        held.set(scope, { key: 'stored-key-00001', at: new Date('2026-11-21T10:00:00Z').getTime(), payload: { title: 'Visa form' }, keepMs: 1000 });
        const admin = asking({ ok: false, reason: 'unknown' });
        await asAfterRestart(admin, store);
        expect(keysOf(admin)[0]).toBe('stored-key-00001');
    });

    it('end to end: a start that timed out before its answer, a restart (a new AdminApiService and an empty memory), the same ask again: the SAME key in the header of the start, so Orbit answers with the job the first made', async () => {
        const token = process.env.BOT_SERVICE_TOKEN;
        process.env.BOT_SERVICE_TOKEN = 'secret';
        try {
            const { store, held } = sharedStore();
            const orbit = () => {
                const admin = new AdminApiService('http://orbit.test');
                vi.spyOn(admin, 'isConfigured').mockReturnValue(true);
                return admin;
            };
            const keyOfPost = (index: number) => {
                const posts = request.mock.calls.filter((one) => (one[0] as { method: string; headers?: Record<string, string> }).method === 'post' && (one[0] as { headers?: Record<string, string> }).headers?.['X-Computer-Start-Attempt']);
                return ((posts[index][0] as { headers: Record<string, string> }).headers['X-Computer-Start-Attempt']);
            };
            const timeout = () => Object.assign(new Error('timeout of 480000ms exceeded'), { isAxiosError: true, code: 'ECONNABORTED' });
            request.mockReset();
            // first server: the start times out, and the look-up of the job fails too: outcome not known
            request.mockRejectedValueOnce(timeout());
            request.mockRejectedValueOnce(new Error('down'));
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const first = await runDelivered({ job: 'Visa form' }, { admin: orbit(), botId: BRICK, userId: 'uuid-alice', startKeys: new Map(), startKeyStore: store });
            expect(first).toMatchObject({ started: false });
            expect(held.size).toBe(1);
            // the server restarts. The start is open, so it is looked up by its key BEFORE anything is sent: Orbit has no job of that key yet, so the SAME key is sent (the title may be
            // reworded: Orbit makes one job of one key), and Orbit answers with the job
            const key = [...held.values()][0].key;
            request.mockImplementationOnce(async () => ({ data: { started: null } }));
            // the title is worded another way, so the game asks Orbit to retire the old key: an Orbit that cannot say (`start-retire` unknown to it) changes nothing, the old words go again
            request.mockImplementationOnce(async () => ({ data: { ok: false, reason: 'unknown_action' } }));
            request.mockImplementationOnce(async () => ({ data: { ok: true, job: { id: 'j-made', status: 'running', queuedFor: null }, restoredFrom: null } }));
            const second = await runDelivered({ job: 'Visa application, worded another way' }, { admin: orbit(), botId: BRICK, userId: 'uuid-alice', startKeys: new Map(), startKeyStore: store });
            warn.mockRestore();
            expect(second).toMatchObject({ started: true });
            expect(keyOfPost(0)).toMatch(KEY);
            expect(keyOfPost(0)).toBe(key);
            expect(keyOfPost(1)).toBe(keyOfPost(0));
            // the job is made: nothing is kept, a third ask is a new job
            expect(held.size).toBe(0);
        } finally {
            if (token === undefined) delete process.env.BOT_SERVICE_TOKEN;
            else process.env.BOT_SERVICE_TOKEN = token;
        }
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
        // the first two asks are not known to have started; the one after them works (the start with the key of the first, sent with the first one's words)
        const startComputerJob = vi.fn().mockImplementation(async (_botId: string, _user: string) => (startComputerJob.mock.calls.length <= 2 ? { ok: false, reason: 'unknown' } : { ok: true, job: job(), restoredFrom: null }));
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
        expect(keysOf('Taxi booking')[1]).toBe(keysOf('Taxi booking')[0]);
        // the reply begun again for the same message (a retry) keeps all of it
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const retried = chat.generateBotResponseStream(BRICK, 1, 'a message', '', 'none', 'matrix-dm', '', ...([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true] as never[]));
        await retried.next();
        await retried.return(undefined);
        expect((memory.computerStarts as Map<string, unknown>).size).toBe(1);
        // a new answer being begun (a newer message, or this one asked again) drops the confirmations the earlier answer queued, and has a queue of its own
        const oldQueue = new ConfirmationQueue();
        const confirmedOld: string[] = [];
        // a job it names (a note), so it would be told and confirmed by the delivery if the queue were not dropped
        oldQueue.add('old-key-0001', async () => void confirmedOld.push('old'), { state: 'started', title: 'Taxi booking' });
        memory.computerConfirmations = oldQueue;
        const replaced = chat.generateBotResponseStream(BRICK, 1, 'a replacing message', '', 'none', 'matrix-dm', '');
        await replaced.next();
        await replaced.return(undefined);
        expect(memory.computerConfirmations).toBeInstanceOf(ConfirmationQueue);
        expect(memory.computerConfirmations).not.toBe(oldQueue);
        await deliverTold(oldQueue);
        expect(confirmedOld).toEqual([]);
        // a new message from the person: what is open (not known whether it started) stays, so asking again, reworded, is still the same job
        const next = chat.generateBotResponseStream(BRICK, 1, 'a new message', '', 'none', 'matrix-dm', '');
        await next.next();
        await next.return(undefined);
        expect((memory.computerStarts as Map<string, unknown>).size).toBe(1);
        await ask('A cab for tomorrow');
        expect(startComputerJob.mock.calls).toHaveLength(3);
        expect((startComputerJob.mock.calls[2][2] as { startKey: string }).startKey).toBe(keysOf('Taxi booking')[0]);
        // the words that go under the key are the words of the ask that FIRST sent it, never the words of the reworded ask (the key is that start's identity at Orbit)
        expect((startComputerJob.mock.calls[2][2] as { title: string }).title).toBe('Taxi booking');
        // that ask worked (the job was made under the key): settled, so the next message clears it and a deliberate second job has a key of its own
        const clean = chat.generateBotResponseStream(BRICK, 1, 'yet another message', '', 'none', 'matrix-dm', '');
        await clean.next();
        await clean.return(undefined);
        expect((memory.computerStarts as Map<string, unknown>).size).toBe(0);
        await ask('A cab for tomorrow');
        expect((startComputerJob.mock.calls[3][2] as { startKey: string }).startKey).not.toBe(keysOf('Taxi booking')[0]);
    });

    it('names a job into the chat\'s confirmation queue (the reply being written) and confirms nothing itself: Orbit hears of it only when that reply is delivered', async () => {
        const startComputerJob = vi.fn().mockResolvedValue({ ok: true, job: job(), restoredFrom: null });
        const ackComputerStart = vi.fn().mockResolvedValue(true);
        const queue = new ConfirmationQueue();
        const memory: Record<string, unknown> = { userUuid: 'uuid-alice', computerConfirmations: queue };
        const ai = Object.create(AIService.prototype) as AIService;
        Object.assign(ai, {
            helperBricks: new Set<string>(),
            ownBricks: new Set<string>(),
            knownBricks: new Set<string>(),
            brickOwners: new Map<string, string>(),
            computerOnCache: new Map(),
            botLimits: new Map(),
            adminApiService: { isConfigured: () => true, startComputerJob, ackComputerStart },
            conversationMemory: { getMemory: () => memory },
        });
        const chat = ai as unknown as Ai;
        chat.noteBrick(BRICK, { isDefault: false });
        expect(await chat.runComputerToolCall({ job: 'Taxi booking' }, { botId: BRICK, playerId: 1 })).toMatchObject({ started: true });
        expect(ackComputerStart).not.toHaveBeenCalled();
        expect(queue.size).toBe(1);
        await deliverTold(queue);
        expect(ackComputerStart).toHaveBeenCalledTimes(1);
        expect(ackComputerStart.mock.calls[0][2]).toMatchObject({ attempt: (startComputerJob.mock.calls[0][2] as { startKey: string }).startKey });
    });

    it('sends the key to the shared store the server gave it (setComputerStartKeys), so a restart finds it: the same ask on a fresh service with the same store is the same start', async () => {
        const held = new Map<string, StoredStartKey>();
        const store: StartKeyStore = {
            claim: async (scope, entry) => {
                const old = held.get(scope);
                if (old) return old;
                held.set(scope, entry);
                return entry;
            },
            delete: async (scope, key) => void (held.get(scope)?.key === key && held.delete(scope)),
        };
        const startComputerJob = vi.fn().mockResolvedValue({ ok: false, reason: 'unknown' });
        const ask = async () => {
            const ai = service({ startComputerJob }) as Ai & { setComputerStartKeys(store: StartKeyStore | undefined): void };
            ai.setComputerStartKeys(store);
            ai.noteBrick(BRICK, { isDefault: false });
            await ai.runComputerToolCall({ job: 'Taxi booking' }, { botId: BRICK, playerId: 1 });
        };
        await ask();
        await ask();
        const [first, second] = startComputerJob.mock.calls.map((one) => (one[2] as { startKey: string }).startKey);
        expect(second).toBe(first);
        expect(held.size).toBe(1);
        // no store given: the process's own memory only, and a fresh service makes a new key
        startComputerJob.mockClear();
        const bare = service({ startComputerJob });
        bare.noteBrick(BRICK, { isDefault: false });
        await bare.runComputerToolCall({ job: 'Taxi booking' }, { botId: BRICK, playerId: 1 });
        const other = service({ startComputerJob });
        other.noteBrick(BRICK, { isDefault: false });
        await other.runComputerToolCall({ job: 'Taxi booking' }, { botId: BRICK, playerId: 1 });
        const [a, b] = startComputerJob.mock.calls.map((one) => (one[2] as { startKey: string }).startKey);
        expect(b).not.toBe(a);
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

describe('CodeRabbit: the confirmations of an accepted event are sent once each, whatever a newer answer does meanwhile', () => {
    it('a newer answer drops the queue while the first confirmation is being sent: the second job this event named is still confirmed', async () => {
        const queue = new ConfirmationQueue();
        const sent: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        queue.add('key-one-0001', async () => {
            await gate;
            sent.push('one');
        }, { state: 'started', title: 'Visa form' });
        queue.add('key-two-0002', async () => void sent.push('two'), { state: 'started', title: 'Taxi booking' });
        queue.tell();
        const delivering = queue.deliver('$event');
        await new Promise((resolve) => setTimeout(resolve, 0));
        queue.drop();
        release();
        await delivering;
        expect(sent).toEqual(['one', 'two']);
    });

    // CodeRabbit on #2114: a newer turn can begin (and drop this queue) while the reply that carries these lines is being SENT
    it('a newer turn that drops the queue while the reply is being sent does not take away what that reply told: the event Matrix then accepts still confirms it and asks its questions', async () => {
        const queue = new ConfirmationQueue();
        const sent: string[] = [];
        const asked: string[] = [];
        queue.add('key-told-0001', async () => void sent.push('told'), { state: 'started', title: 'Visa form' });
        queue.say('Cancel “Visa form”?', () => void asked.push('told question'));
        // the reply is built: its text carries these lines
        queue.tell();
        // something the reply did NOT carry (added after its text was built) goes with a drop
        queue.add('key-late-0002', async () => void sent.push('late'), { state: 'started', title: 'Taxi booking' });
        queue.say('Cancel “Taxi booking”?', () => void asked.push('late question'));
        // the person's next message begins its turn while the send is awaited
        queue.drop();
        // nothing more is added to a replaced queue, not even before its reply's event comes back
        queue.add('key-after-0003', async () => void sent.push('after'), { state: 'started', title: 'Hotel' });
        queue.say('Cancel “Hotel”?', () => void asked.push('after question'));
        // what a reply built from it now would carry is only what was there when it was dropped and had been put into a reply
        expect(queue.tell().join('\n')).not.toMatch(/Hotel/);
        expect(queue.tell().join('\n')).not.toMatch(/Taxi/);
        await queue.deliver('$event');
        expect(sent).toEqual(['told']);
        expect(asked).toEqual(['told question']);
    });

    it('a replaced queue whose reply was never delivered confirms and asks nothing', async () => {
        const queue = new ConfirmationQueue();
        const sent: string[] = [];
        queue.add('key-told-0001', async () => void sent.push('told'), { state: 'started', title: 'Visa form' });
        queue.tell();
        queue.drop();
        // no event came back for it: nothing calls deliver, and an event with no id confirms nothing either
        await queue.deliver(undefined);
        expect(sent).toEqual([]);
    });
});
