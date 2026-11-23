/**
 * "Try again" carries on (piece 8 of the computer controls), on the bot server: the game asks Orbit to carry on an ended job ONLY when the person's words ask for it (or this is their first message
 * since Brick told them how that job ended), names exactly the job Orbit named, says it in the approved resume words, and the runner starts the new try in the same conversation with words that say so.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), request: vi.fn(), isAxiosError: () => false }, isAxiosError: () => false }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import axios from 'axios';
import { AdminApiService, COMPUTER_CONTINUES_HEADER, cannotContinueOf } from '../server/AdminApiService';
import { CANNOT_CONTINUE_NOTE, START_NEW_JOB_LABEL, START_REFUSAL_WORDS, TRY_AGAIN_WORDS, cannotContinue } from '../ai/ComputerTryAgainWords';
import { AIService } from '../ai/AIService';
import { ConfirmationQueue, computerToolDefinitions, runComputerTool, startKeyFor, type ComputerToolContext } from '../ai/ComputerTools';
import { asksToTryAgain, offersTryAgain, retryJobOf, tryAgainNote, type RetryJob } from '../ai/ComputerTryAgain';
import { jobLine, quotedTitle } from '../ai/JobStatusLine';
import { CONTROL_WORDS } from '../ai/ComputerControlWords';
import { startPayloadOf } from '../server/ComputerStartKeys';
import { continuePrompt, jobPrompt, outputFolderOf } from '../server/ComputerRunner';
import { runDelivered } from './helpers/deliveredComputerTool';

const BRICK = '0b7c1d2e-1111-4222-8333-944455556666';
const OLD = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const request = axios.request as unknown as ReturnType<typeof vi.fn>;

const retry = (over: Partial<RetryJob> = {}): RetryJob => ({ id: OLD, title: 'Visa form', how: 'error', toldAt: Date.parse('2026-11-23T08:00:00Z'), ...over });

afterEach(() => {
    vi.clearAllMocks();
});

describe('the words that ask to try again', () => {
    it.each(['try again', 'Try again please!', 'yes, try it again', 'give it another go', 'retry', 'carry on', 'continue', 'keep going', 'pick it up from where you left off', 'حاول مرة ثانية', 'جرب مره ثانيه', 'كمل', 'أكملها لو سمحت', 'عيدها'])('"%s" asks for it', (said) => {
        expect(asksToTryAgain(said)).toBe(true);
    });

    it.each(['what is the weather', 'book a taxi', 'try the other website for a hotel', 'thanks', 'yes', 'no', 'stop', 'cancel it', '', 'continued', 'retrying is pointless? no, book a flight'])('"%s" does not', (said) => {
        expect(asksToTryAgain(said)).toBe(false);
    });

    it('is offered when the words ask, or on the first message since Brick told them how it ended; a later message with other words is a fresh ask', () => {
        const told = retry();
        expect(offersTryAgain(told, 'try again', Date.parse('2026-11-23T09:00:00Z'))).toBe(true);
        // "yes" to "Want me to try again?": the first message since the report
        expect(offersTryAgain(told, 'yes', Date.parse('2026-11-23T07:00:00Z'))).toBe(true);
        expect(offersTryAgain(told, 'yes', undefined)).toBe(true);
        // they wrote since the report: a "yes" now is about something else
        expect(offersTryAgain(told, 'yes', Date.parse('2026-11-23T08:30:00Z'))).toBe(false);
        // not told yet: only the words offer it
        expect(offersTryAgain(retry({ toldAt: null }), 'yes', undefined)).toBe(false);
        expect(offersTryAgain(retry({ toldAt: null }), 'try again', undefined)).toBe(true);
        // nothing named by Orbit: never
        expect(offersTryAgain(null, 'try again', undefined)).toBe(false);
    });

    it('the line for the model names the job and how it ended, never a price or a number, and says how to ask', () => {
        const note = tryAgainNote(retry({ title: 'Visa "form"' }));
        expect(note).toContain(`"Visa 'form'"`);
        expect(note).toContain('try_again true');
        expect(note).toContain('could not finish');
        expect(note).not.toMatch(/\$|\d/);
        expect(tryAgainNote(retry({ how: 'unanswered' }))).toContain('stopped waiting for them');
    });

    it('Orbit’s `retry` is read only when it is whole', () => {
        expect(retryJobOf({ id: OLD, title: 'Visa form', how: 'error', toldAt: '2026-11-23T08:00:00.000Z' })).toEqual(retry());
        expect(retryJobOf({ id: OLD, title: 'Visa form', how: 'error', toldAt: null })).toEqual(retry({ toldAt: null }));
        expect(retryJobOf(null)).toBeNull();
        expect(retryJobOf({ id: 'bad id!', title: 'x', how: 'error' })).toBeNull();
        expect(retryJobOf({ id: OLD, title: '  ', how: 'error' })).toBeNull();
    });
});

describe('use_computer with try_again', () => {
    const asking = (answer: unknown) => ({ startComputerJob: vi.fn().mockResolvedValue(answer) });
    const context = (admin: ReturnType<typeof asking>, over: Partial<ComputerToolContext> = {}): ComputerToolContext => ({ admin: admin as never, botId: BRICK, userId: 'uuid-alice', ...over });

    it('is offered as a choice of the tool', () => {
        const params = computerToolDefinitions()[0].function.parameters as { properties: Record<string, unknown> };
        expect(params.properties.try_again).toMatchObject({ type: 'boolean' });
    });

    it('names the job Orbit named for this turn, under its own title, and says it carries on in the approved resume words', async () => {
        const admin = asking({ ok: true, job: { id: 'new-1', status: 'running', queuedFor: null }, restoredFrom: null, continued: true });
        const queue = new ConfirmationQueue();
        const answer = await runComputerTool({ job: 'Visa application', try_again: true, details: 'same as before' }, context(admin, { retry: { id: OLD, title: 'Visa form' }, confirmations: queue }));
        expect(admin.startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', expect.objectContaining({ title: 'Visa form', continuesJobId: OLD, brief: 'same as before' }));
        expect(answer.note).toContain('carrying on from where it stopped');
        expect(queue.tell()).toEqual([CONTROL_WORDS.resumedNow.titled(quotedTitle('Visa form'))]);
    });

    it('a continuation that waits next in line, or for a free computer, says so in the approved resume words', () => {
        expect(jobLine({ state: 'queued', queuedFor: 'turn', continued: true, title: 'Visa form' })).toBe(CONTROL_WORDS.resumedNext.titled(quotedTitle('Visa form')));
        expect(jobLine({ state: 'queued', queuedFor: 'busy', continued: true, title: 'Visa form' })).toBe(CONTROL_WORDS.resumedWaiting.titled(quotedTitle('Visa form')));
        expect(jobLine({ state: 'queued', queuedFor: 'pool', continued: true })).toBe(CONTROL_WORDS.resumedWaiting.plain);
        // the month used up: said as any job waiting for it
        expect(jobLine({ state: 'queued', queuedFor: 'allowance', continued: true, title: 'Visa form' })).toBe(jobLine({ state: 'queued', queuedFor: 'allowance', title: 'Visa form' }));
        // a fresh job keeps its own words
        expect(jobLine({ state: 'started', title: 'Visa form' })).not.toBe(CONTROL_WORDS.resumedNow.titled(quotedTitle('Visa form')));
    });

    it('when Orbit made a fresh job instead (it did not qualify), it is said as a fresh start', async () => {
        const admin = asking({ ok: true, job: { id: 'new-2', status: 'running', queuedFor: null }, restoredFrom: null });
        const queue = new ConfirmationQueue();
        await runComputerTool({ job: 'Visa form', try_again: true }, context(admin, { retry: { id: OLD, title: 'Visa form' }, confirmations: queue }));
        expect(queue.tell()).toEqual([jobLine({ state: 'started', title: 'Visa form' })]);
    });

    it('without try_again, or with nothing named for this turn, nothing is carried on', async () => {
        const fresh = asking({ ok: true, job: { id: 'j', status: 'running', queuedFor: null }, restoredFrom: null });
        await runDelivered({ job: 'Visa form' }, context(fresh, { retry: { id: OLD, title: 'Visa form' } }));
        expect(fresh.startComputerJob.mock.calls[0][2]).not.toHaveProperty('continuesJobId');
        // GPT seventh note, E: `try_again` with nothing named for this turn is NEVER a fresh paid start (it used to be one)
        const unnamed = { ...asking({ ok: true, job: { id: 'j', status: 'running', queuedFor: null }, restoredFrom: null }), computerEndedJobs: vi.fn().mockResolvedValue([]) };
        await runDelivered({ job: 'Visa form', try_again: true }, context(unnamed));
        expect(unnamed.startComputerJob).not.toHaveBeenCalled();
    });

    it('a job carried on is never turned to a connected app: it goes on where it stopped, on the computer (a fresh ask of the same words still is)', async () => {
        const admin = asking({ ok: true, job: { id: 'new-1', status: 'running', queuedFor: null }, restoredFrom: null, continued: true });
        await runDelivered({ job: 'Visa form', try_again: true, details: 'in Gmail' }, context(admin, { retry: { id: OLD, title: 'Visa form' }, apps: ['Gmail'] }));
        expect(admin.startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', expect.objectContaining({ continuesJobId: OLD }));
        const fresh = asking({ ok: true, job: { id: 'j', status: 'running', queuedFor: null }, restoredFrom: null });
        await runDelivered({ job: 'Visa form', details: 'in Gmail' }, context(fresh, { apps: ['Gmail'] }));
        expect(fresh.startComputerJob).not.toHaveBeenCalled();
    });

    it('a "yes" delivered again (the same inbound event) sends the same continuation under the same event key: one job', async () => {
        const inbound = { roomId: '!room:example.test', eventId: '$yes-1' };
        const keys: string[] = [];
        for (let delivery = 0; delivery < 2; delivery++) {
            const admin = asking({ ok: true, job: { id: 'new-1', status: 'running', queuedFor: null }, restoredFrom: null, continued: true });
            await runDelivered({ job: 'Visa form', try_again: true }, context(admin, { retry: { id: OLD, title: 'Visa form' }, inbound, confirmations: new ConfirmationQueue() }));
            const sent = admin.startComputerJob.mock.calls[0][2] as { startKey: string; continuesJobId?: string };
            expect(sent.continuesJobId).toBe(OLD);
            keys.push(sent.startKey);
        }
        expect(keys[0]).toBe(startKeyFor(BRICK, inbound.roomId, inbound.eventId, 0));
        expect(keys[1]).toBe(keys[0]);
    });

    it('the line for the model says how a failure the agent itself gave ended', () => {
        expect(tryAgainNote(retry({ how: 'agent' }))).toContain('could not get past');
    });

    it('the same ask again in the turn sends the same continuation under the same key: one job', async () => {
        const admin = asking({ ok: false, reason: 'unknown' });
        const startKeys = new Map();
        const ctx = context(admin, { retry: { id: OLD, title: 'Visa form' }, startKeys });
        await runDelivered({ job: 'Visa form', try_again: true }, ctx);
        await runDelivered({ job: 'Visa form', try_again: true }, ctx);
        const calls = admin.startComputerJob.mock.calls.map((call) => call[2] as { startKey: string; continuesJobId?: string });
        expect(calls.length).toBeGreaterThanOrEqual(1);
        expect(new Set(calls.map((call) => call.startKey)).size).toBe(1);
        expect(calls.every((call) => call.continuesJobId === OLD)).toBe(true);
    });

    it('the stored start keeps which job it carries on, and a damaged one is not read', () => {
        expect(startPayloadOf({ title: 'Visa form', continues: OLD })).toEqual({ title: 'Visa form', continues: OLD });
        expect(startPayloadOf({ title: 'Visa form', continues: 'not an id!' })).toBeUndefined();
        expect(startPayloadOf({ title: 'Visa form', continues: 7 })).toBeUndefined();
    });
});

describe('asking Orbit', () => {
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

    it('a start that carries on names the job in its own header (the body stays as it was), and Orbit’s `continued` is read', async () => {
        process.env.BOT_SERVICE_TOKEN = 'secret';
        request.mockResolvedValueOnce({ data: { ok: true, job: { id: 'new-1', status: 'running', queuedFor: null }, restoredFrom: null, continued: true } });
        const answer = await service().startComputerJob(BRICK, 'uuid-alice', { title: 'Visa form', continuesJobId: OLD, startKey: 'k_0123456789abcdef' });
        expect(answer).toMatchObject({ ok: true, continued: true });
        const sent = request.mock.calls[0][0] as { headers: Record<string, string>; data: Record<string, unknown> };
        expect(sent.headers[COMPUTER_CONTINUES_HEADER]).toBe(OLD);
        expect(sent.data).not.toHaveProperty('continuesJobId');
        // An ordinary start sends no such header, and an answer without `continued` is a fresh job
        request.mockResolvedValueOnce({ data: { ok: true, job: { id: 'new-2', status: 'running', queuedFor: null }, restoredFrom: null } });
        const plain = await service().startComputerJob(BRICK, 'uuid-alice', { title: 'Shop', startKey: 'k_0123456789abcdeg' });
        expect(plain).not.toHaveProperty('continued');
        expect((request.mock.calls[1][0] as { headers: Record<string, string> }).headers).not.toHaveProperty(COMPUTER_CONTINUES_HEADER);
        // A job named in a shape that is no id is never sent: the start is an ordinary one
        request.mockResolvedValueOnce({ data: { ok: true, job: { id: 'new-3', status: 'running', queuedFor: null }, restoredFrom: null } });
        await service().startComputerJob(BRICK, 'uuid-alice', { title: 'Shop', continuesJobId: 'not an id!', startKey: 'k_0123456789abcdeh' });
        expect((request.mock.calls[2][0] as { headers: Record<string, string> }).headers).not.toHaveProperty(COMPUTER_CONTINUES_HEADER);
    });

    it('the computer read asks for the job "try again" would carry on, and an Orbit that does not say names none', async () => {
        process.env.BOT_SERVICE_TOKEN = 'secret';
        request.mockResolvedValueOnce({ data: { available: true, on: true, busy: false, retry: { id: OLD, title: 'Visa form', how: 'error', endedAt: null, toldAt: '2026-11-23T08:00:00.000Z' } } });
        expect(await service().computerState(BRICK, 'uuid-alice')).toEqual({ on: true, retry: retry() });
        expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'get', params: { userId: 'uuid-alice', retry: '1' } }));
        request.mockResolvedValueOnce({ data: { available: true, on: true, busy: false } });
        expect(await service().computerState(BRICK, 'uuid-alice')).toEqual({ on: true, retry: null });
        request.mockResolvedValueOnce({ data: { available: true, on: false, retry: { id: OLD, title: 'Visa form', how: 'error' } } });
        expect(await service().computerState(BRICK, 'uuid-alice')).toEqual({ on: false, retry: null });
    });
});

describe('Brick is told about "try again" only when the person asks for it', () => {
    type Ai = {
        noteBrick: AIService['noteBrick'];
        computerOnFor(botId: string, playerId: number, admin?: unknown): Promise<boolean>;
        tryAgainNoteFor(botId: string, playerId: number, admin?: unknown): Promise<string>;
        runComputerToolCall(args: Record<string, unknown>, where: { adminApiService?: unknown; botId?: string; playerId?: number }): Promise<Record<string, unknown>>;
    };
    function service(admin: Record<string, unknown>, lines: Array<{ message: string; at: number }>) {
        const memory: Record<string, unknown> = { userUuid: 'uuid-alice', conversationHistory: lines.map((line) => ({ message: line.message, sender: 'person', timestamp: line.at })) };
        const ai = Object.create(AIService.prototype) as AIService;
        Object.assign(ai, {
            helperBricks: new Set<string>(),
            ownBricks: new Set<string>(),
            knownBricks: new Set<string>(),
            brickOwners: new Map<string, string>(),
            computerOnCache: new Map(),
            adminApiService: { isConfigured: () => true, ...admin },
            conversationMemory: { getMemory: () => memory },
        });
        return { ai: ai as unknown as Ai, memory };
    }
    const TOLD = Date.parse('2026-11-23T08:00:00Z');
    const named = { on: true, retry: retry({ toldAt: TOLD }) };

    it('words that ask: the line names the job, and the start of this turn carries it on', async () => {
        const startComputerJob = vi.fn().mockResolvedValue({ ok: true, job: { id: 'new-1', status: 'running', queuedFor: null }, restoredFrom: null, continued: true });
        const { ai, memory } = service({ computerState: vi.fn().mockResolvedValue(named), startComputerJob }, [{ message: 'book it', at: TOLD + 60_000 }, { message: 'please try again', at: TOLD + 120_000 }]);
        ai.noteBrick(BRICK, { isDefault: false });
        expect(await ai.computerOnFor(BRICK, 1)).toBe(true);
        expect(await ai.tryAgainNoteFor(BRICK, 1)).toContain('"Visa form"');
        expect(memory.computerRetry).toEqual({ id: OLD, title: 'Visa form' });
        await ai.runComputerToolCall({ job: 'Visa form', try_again: true }, { botId: BRICK, playerId: 1 });
        expect(startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', expect.objectContaining({ continuesJobId: OLD }));
    });

    it('a plain "yes" as the first message since the report counts; the same "yes" after they wrote again does not', async () => {
        const first = service({ computerState: vi.fn().mockResolvedValue(named) }, [{ message: 'do the visa form', at: TOLD - 600_000 }, { message: 'yes', at: TOLD + 30_000 }]);
        first.ai.noteBrick(BRICK, { isDefault: false });
        await first.ai.computerOnFor(BRICK, 1);
        expect(await first.ai.tryAgainNoteFor(BRICK, 1)).not.toBe('');
        const later = service({ computerState: vi.fn().mockResolvedValue(named) }, [{ message: 'thanks', at: TOLD + 30_000 }, { message: 'yes', at: TOLD + 90_000 }]);
        later.ai.noteBrick(BRICK, { isDefault: false });
        await later.ai.computerOnFor(BRICK, 1);
        expect(await later.ai.tryAgainNoteFor(BRICK, 1)).toBe('');
        expect(later.memory.computerRetry).toBeUndefined();
    });

    it('other words, or no job named by Orbit, say nothing and carry nothing on; a turn without the line forgets the last one', async () => {
        const startComputerJob = vi.fn().mockResolvedValue({ ok: true, job: { id: 'j', status: 'running', queuedFor: null }, restoredFrom: null });
        const { ai, memory } = service({ computerState: vi.fn().mockResolvedValue(named), startComputerJob }, [{ message: 'hello', at: TOLD + 60_000 }, { message: 'book a taxi', at: TOLD + 120_000 }]);
        ai.noteBrick(BRICK, { isDefault: false });
        await ai.computerOnFor(BRICK, 1);
        memory.computerRetry = { id: OLD, title: 'Visa form' };
        expect(await ai.tryAgainNoteFor(BRICK, 1)).toBe('');
        expect(memory.computerRetry).toBeUndefined();
        await ai.runComputerToolCall({ job: 'Taxi', try_again: true }, { botId: BRICK, playerId: 1 });
        // GPT seventh note, E: `try_again` with no job named for this turn starts nothing (it used to start a fresh paid job)
        expect(startComputerJob).not.toHaveBeenCalled();
        const none = service({ computerState: vi.fn().mockResolvedValue({ on: true, retry: null }) }, [{ message: 'try again', at: TOLD }]);
        none.ai.noteBrick(BRICK, { isDefault: false });
        await none.ai.computerOnFor(BRICK, 1);
        expect(await none.ai.tryAgainNoteFor(BRICK, 1)).toBe('');
    });

    // GPT's sixth answer, finding 6
    it('a tap on "Start a new job" is offered nothing to carry on, and Orbit is not asked at all', async () => {
        const computerState = vi.fn().mockResolvedValue(named);
        const { ai, memory } = service({ computerState }, [{ message: 'Start a new job', at: TOLD + 60_000 }]);
        ai.noteBrick(BRICK, { isDefault: false });
        await ai.computerOnFor(BRICK, 1);
        computerState.mockClear();
        memory.newJobAsked = { title: 'Visa form' };
        expect(await ai.tryAgainNoteFor(BRICK, 1)).toBe('');
        expect(memory.computerRetry).toBeUndefined();
        expect(computerState).not.toHaveBeenCalled();
        // It lasts the whole turn (a second look in the same turn, such as the retry when nothing was saved, finds it too); the next turn's start clears or sets it afresh
        expect(memory.newJobAsked).toEqual({ title: 'Visa form' });
        expect(await ai.tryAgainNoteFor(BRICK, 1)).toBe('');
        expect(computerState).not.toHaveBeenCalled();
    });

    it('words that ask, with nothing named in the short-lived read, read Orbit again once (the job may have ended a moment ago)', async () => {
        const computerState = vi.fn().mockResolvedValueOnce({ on: true, retry: null }).mockResolvedValueOnce(named);
        const { ai } = service({ computerState }, [{ message: 'try again', at: TOLD + 60_000 }]);
        ai.noteBrick(BRICK, { isDefault: false });
        await ai.computerOnFor(BRICK, 1);
        expect(await ai.tryAgainNoteFor(BRICK, 1)).toContain('Visa form');
        expect(computerState).toHaveBeenCalledTimes(2);
    });
});

describe('the runner starts the new try in the same conversation', () => {
    it('its first words say it is a new try, to look first, not to redo, and to move a kept file into ITS folder; then the job as always', () => {
        const job = { jobId: 'new-1', title: 'Visa form', brief: 'the same form', writes: true, continuesJobId: OLD };
        const said = continuePrompt(job);
        expect(said).toContain('new try');
        expect(said).toContain('Do not redo');
        expect(said).toContain(outputFolderOf(OLD));
        expect(said).toContain(outputFolderOf('new-1'));
        expect(said.endsWith(jobPrompt(job))).toBe(true);
        // A job that only looks has no files to move
        expect(continuePrompt({ ...job, writes: false })).not.toContain(outputFolderOf(OLD));
    });
});

describe('CodeRabbit N7: another chat of the same person starts with none of the active chat\'s turn state', () => {
    it('a cloned memory keeps the conversation but not the controls, the retry choice or the confirmations', async () => {
        const { PersistentMemory } = await import('../memory/PersistentMemory');
        const { newControlState } = await import('../ai/ComputerControlTools');
        // typed loosely on purpose: the clone is the private step `setUserUuid` takes when the same person opens another chat
        const memory: any = new PersistentMemory({});
        memory.addMessage('brick-1', 7, 'cancel the visa one', 'person', 'dm');
        const live = memory.getMemory('brick-1', 7);
        const controls = newControlState();
        controls.asks.set('cancel|job-visa', { kind: 'cancel', jobIds: ['job-visa'], titles: ['Visa form'], told: true, answerable: true });
        live.computerControls = controls;
        live.computerRetry = { id: 'job-old', title: 'Visa form' };
        live.computerConfirmations = new ConfirmationQueue();
        const copy = memory.cloneMemory(live);
        // what the person said is there; the turn's own state is not, and the controls object is never shared
        expect(copy.conversationHistory.map((one: { message: string }) => one.message)).toEqual(live.conversationHistory.map((one: { message: string }) => one.message));
        expect(copy.conversationHistory).not.toBe(live.conversationHistory);
        expect(copy.computerControls).toBeUndefined();
        expect(copy.computerRetry).toBeUndefined();
        expect(copy.computerConfirmations).toBeUndefined();
        // the question in the active chat is untouched by anything the copy does
        expect(live.computerControls.asks.size).toBe(1);
    });
});

/**
 * GPT's sixth answer, finding 6: Orbit refuses to carry a job on (`cannot_continue`) and MAKES NOTHING. The game says why in Fable's approved words, word for word, starts nothing
 * in its place, and offers "Start a new job" as a separate choice where that is a sensible next step. The tap is an ordinary start, with a key of its own.
 */
describe('finding 6: a continuation Orbit refuses never becomes a fresh paid job', () => {
    const orbitService = (): AdminApiService => {
        process.env.BOT_SERVICE_TOKEN = 'secret';
        const admin = new AdminApiService('http://orbit.test');
        vi.spyOn(admin, 'isConfigured').mockReturnValue(true);
        return admin;
    };
    // Orbit sends its own refusals as a successful answer with a reason (GPT round 4, R1), so that is what is answered here
    const refusing = (why: string, more: Record<string, unknown> = {}) => ({ data: { ok: false, reason: 'cannot_continue', why, ...more } });

    const start = async (why: string, more: Record<string, unknown> = {}) => {
        request.mockResolvedValue(refusing(why, more));
        const service = orbitService();
        const queue = new ConfirmationQueue();
        const offered: string[] = [];
        const answer = await runComputerTool(
            { job: 'Visa form', try_again: true },
            { admin: service, botId: BRICK, userId: 'uuid-alice', retry: { id: OLD, title: 'Visa form' }, confirmations: queue, offerNewJob: (title) => offered.push(title) }
        );
        return { answer, lines: queue.tell(), offered };
    };

    it('says the approved words for every reason Orbit gives, and starts NOTHING', async () => {
        const name = quotedTitle('Visa form');
        for (const [why, more, line, button] of [
            ['not_continuable', { endedBy: 'person' }, TRY_AGAIN_WORDS.endedByPerson.titled(name), true],
            ['not_continuable', { endedBy: 'off' }, TRY_AGAIN_WORDS.endedByOff.titled(name), true],
            ['not_continuable', { status: 'done' }, TRY_AGAIN_WORDS.alreadyFinished.titled(name), true],
            ['no_conversation', {}, TRY_AGAIN_WORDS.noConversation.titled(name), true],
            ['live', {}, TRY_AGAIN_WORDS.stillLive.titled(name), false],
            ['not_found', {}, TRY_AGAIN_WORDS.noSuchJob.plain, false],
            ['not_theirs', {}, TRY_AGAIN_WORDS.noSuchJob.plain, false],
            // Orbit named no reason at all: the line names none either (DRAFT wording, flagged for Fable)
            ['not_continuable', {}, TRY_AGAIN_WORDS.cannotCarryOn.titled(name), true],
        ] as const) {
            const { answer, lines, offered } = await start(why, more as Record<string, unknown>);
            expect(answer).toMatchObject({ started: false, success: false, reason: 'cannot_continue' });
            expect(lines).toEqual([line]);
            expect(offered).toEqual(button ? ['Visa form'] : []);
            // Nothing but the one refused start went to Orbit: no fresh job, no second request
            expect(request).toHaveBeenCalledTimes(1);
            request.mockClear();
        }
    });

    it('tells the model the line is already under the reply, and not to word it itself', async () => {
        const { answer } = await start('not_continuable', { endedBy: 'person' });
        expect(String(answer.note)).toBe(CANNOT_CONTINUE_NOTE);
        expect(String(answer.note)).toMatch(/do not say it again and do not reword it/);
        expect(String(answer.note)).toMatch(/NOTHING was started/);
    });

    it('gives the model the exact words to say where there is no fixed line (not a direct chat)', async () => {
        request.mockResolvedValue(refusing('not_continuable', { endedBy: 'off' }));
        const service = orbitService();
        const answer = await runComputerTool({ job: 'Visa form', try_again: true }, { admin: service, botId: BRICK, userId: 'uuid-alice', retry: { id: OLD, title: 'Visa form' } });
        expect(String(answer.note)).toContain(TRY_AGAIN_WORDS.endedByOff.titled(quotedTitle('Visa form')));
        expect(String(answer.note)).toMatch(/in these words, and nothing more about it/);
    });

    it('reads what Orbit said, and a reason it does not know is read as the one that says least', () => {
        expect(cannotContinueOf({ why: 'live' })).toEqual({ why: 'live' });
        expect(cannotContinueOf({ why: 'not_continuable', endedBy: 'person' })).toEqual({ why: 'not_continuable', endedBy: 'person' });
        expect(cannotContinueOf({ why: 'not_continuable', status: 'done' })).toEqual({ why: 'not_continuable', status: 'done' });
        expect(cannotContinueOf({})).toEqual({ why: 'not_continuable' });
        expect(cannotContinueOf({ why: 'something new', endedBy: 'someone' })).toEqual({ why: 'not_continuable' });
        // Orbit sends what it says about the job under `job` ({ title, status, endedBy }, Orbit B's contract of 23 Nov): read the same there
        expect(cannotContinueOf({ why: 'not_continuable', job: { title: 'Visa form', endedBy: 'person', status: 'stopped' } })).toEqual({ why: 'not_continuable', endedBy: 'person', status: 'stopped' });
        expect(cannotContinueOf({ why: 'not_continuable', job: { title: 'Visa form', status: 'done' } })).toEqual({ why: 'not_continuable', status: 'done' });
        // What the refusal itself names wins, and a `job` that says nothing of the kind leaves the line to name no reason
        expect(cannotContinueOf({ why: 'not_continuable', endedBy: 'off', job: { endedBy: 'person' } })).toEqual({ why: 'not_continuable', endedBy: 'off' });
        expect(cannotContinueOf({ why: 'not_continuable', job: { title: 'Visa form' } })).toEqual({ why: 'not_continuable' });
        expect(cannotContinueOf({ why: 'not_continuable', job: 'Visa form' })).toEqual({ why: 'not_continuable' });
    });

    // Orbit B's contract of 23 Nov: the words are the same whichever shape the refusal comes in
    it('says the approved words when Orbit names the job under `job`', async () => {
        const name = quotedTitle('Visa form');
        for (const [more, line] of [
            [{ job: { title: 'Visa form', endedBy: 'person', status: 'stopped' } }, TRY_AGAIN_WORDS.endedByPerson.titled(name)],
            [{ job: { title: 'Visa form', status: 'done' } }, TRY_AGAIN_WORDS.alreadyFinished.titled(name)],
            [{ job: { title: 'Visa form', endedBy: 'off' } }, TRY_AGAIN_WORDS.endedByOff.titled(name)],
        ] as const) {
            const { answer, lines, offered } = await start('not_continuable', more as Record<string, unknown>);
            expect(answer).toMatchObject({ started: false, reason: 'cannot_continue' });
            expect(lines).toEqual([line]);
            expect(offered).toEqual(['Visa form']);
            request.mockClear();
        }
    });

    it('names no title when there is none to name, and the words stand on their own', () => {
        expect(cannotContinue('not_continuable', undefined, { endedBy: 'person' })).toEqual({ line: TRY_AGAIN_WORDS.endedByPerson.plain, startNewJob: true });
        expect(cannotContinue('live', '   ')).toEqual({ line: TRY_AGAIN_WORDS.stillLive.plain, startNewJob: false });
        // The same words for a job that is not there and one that is not theirs: nothing is learned from which it was
        expect(cannotContinue('not_found', 'Visa form').line).toBe(cannotContinue('not_theirs', 'Visa form').line);
    });

    // Fable's final line for a refusal Orbit gives no reason for (23 Nov, brick-four-job-lines), checked against the exact text and never against the constant
    it('says the approved words, word for word, when Orbit names no reason', () => {
        expect(TRY_AGAIN_WORDS.cannotCarryOn.titled('\u201cVisa form\u201d')).toBe('\u201cVisa form\u201d has ended and can\'t carry on. I can start it again as a new job, from the beginning.');
        expect(TRY_AGAIN_WORDS.cannotCarryOn.plain).toBe('That job has ended and can\'t carry on. I can start it again as a new job, from the beginning.');
    });

    it('the button label is the approved one', () => {
        expect(START_NEW_JOB_LABEL).toBe('Start a new job');
    });
});

// GPT seventh note, E (Fable's final words, /mnt/project-files/brick-which-job/strings.txt): `try_again` with no job to carry on for the turn asks which job, or offers a new one. Nothing is started.
describe('try_again with no job named for this turn', () => {
    const VISA = { id: OLD, title: 'Visa form' };
    const TAXI = { id: '8d0f7780-8536-51ef-955c-f18gd2g01bf8', title: 'Taxi booking' };
    const FLIGHT = { id: '9e1f8891-9647-62fg-a66d-g29he3h12cg9', title: 'Flight search' };
    const started = { ok: true, job: { id: 'new-1', status: 'running', queuedFor: null }, restoredFrom: null, continued: true };
    const world = (ended: unknown, answer: unknown = started) => ({ startComputerJob: vi.fn().mockResolvedValue(answer), computerEndedJobs: vi.fn().mockResolvedValue(ended) });
    const ctx = (admin: ReturnType<typeof world>, over: Partial<ComputerToolContext> = {}): ComputerToolContext => ({ admin: admin as never, botId: BRICK, userId: 'uuid-alice', ...over });

    it('two or more ended jobs: asks which, newest first, a repeated title once, at most three; nothing is started', async () => {
        const admin = world([TAXI, { ...TAXI, id: 'dup-dup-dup-dup' }, VISA, FLIGHT, { id: 'zzzz-zzzz-zzzz', title: 'Fourth one' }]);
        const queue = new ConfirmationQueue();
        const answer = await runComputerTool({ job: 'try again', try_again: true }, ctx(admin, { confirmations: queue }));
        expect(queue.tell()).toEqual(['Which job do you mean: “Taxi booking”, “Visa form” or “Flight search”?']);
        expect(admin.startComputerJob).not.toHaveBeenCalled();
        expect(answer).toMatchObject({ started: false, asked: 'which' });
        expect(String(answer.note)).toMatch(/NOTHING was started/);
    });

    it('one ended job the words do not name: "Do you mean “Visa form”?"', async () => {
        const admin = world([VISA]);
        const queue = new ConfirmationQueue();
        await runComputerTool({ job: 'the thing from before', try_again: true }, ctx(admin, { confirmations: queue }));
        expect(queue.tell()).toEqual(['Do you mean “Visa form”?']);
        expect(admin.startComputerJob).not.toHaveBeenCalled();
    });

    it('the words name exactly one ended job: that job carries on (Orbit decides), under its own id', async () => {
        const admin = world([TAXI, VISA]);
        const queue = new ConfirmationQueue();
        await runDelivered({ job: 'visa  FORM', try_again: true }, ctx(admin, { confirmations: queue }));
        expect(admin.startComputerJob).toHaveBeenCalledTimes(1);
        expect(admin.startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', expect.objectContaining({ title: 'Visa form', continuesJobId: OLD }));
    });

    it('two ended jobs of one title: the newest stands for both, and it carries on', async () => {
        const admin = world([{ id: 'newest-newest-1', title: 'Visa form' }, { id: 'older-older-123', title: 'visa form' }]);
        await runDelivered({ job: 'Visa form', try_again: true }, ctx(admin));
        expect(admin.startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', expect.objectContaining({ continuesJobId: 'newest-newest-1' }));
    });

    it('titles in Arabic are told apart (a different title is a different job)', async () => {
        const admin = world([{ id: 'job-visa-0000', title: 'طلب التأشيرة' }, { id: 'job-taxi-0000', title: 'حجز التاكسي' }]);
        await runDelivered({ job: 'حجز التاكسي', try_again: true }, ctx(admin));
        expect(admin.startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', expect.objectContaining({ continuesJobId: 'job-taxi-0000' }));
        const other = world([{ id: 'job-visa-0000', title: 'طلب التأشيرة' }, { id: 'job-taxi-0000', title: 'حجز التاكسي' }]);
        const queue = new ConfirmationQueue();
        await runComputerTool({ job: 'حجز الفندق', try_again: true }, ctx(other, { confirmations: queue }));
        expect(other.startComputerJob).not.toHaveBeenCalled();
        expect(queue.tell()[0]).toContain('Which job do you mean');
    });

    it('no ended job at all, and the Brick has a title: the offer to start it as a new job, with the existing card; nothing is started', async () => {
        const admin = world([]);
        const queue = new ConfirmationQueue();
        const offered: string[] = [];
        const answer = await runComputerTool({ job: 'Visa form', try_again: true }, ctx(admin, { confirmations: queue, offerNewJob: (title) => void offered.push(title) }));
        expect(queue.tell()).toEqual(["I can't find a job of yours to carry on. I can start “Visa form” as a new job, from the beginning."]);
        expect(offered).toEqual(['Visa form']);
        expect(admin.startComputerJob).not.toHaveBeenCalled();
        expect(String(answer.note)).toMatch(/NOTHING was started/);
    });

    it('no ended job and no title: the approved noSuchJob line, no card', async () => {
        const admin = world([]);
        const queue = new ConfirmationQueue();
        const offered: string[] = [];
        await runComputerTool({ try_again: true }, ctx(admin, { confirmations: queue, offerNewJob: (title) => void offered.push(title) }));
        expect(queue.tell()).toEqual([TRY_AGAIN_WORDS.noSuchJob.plain]);
        expect(offered).toEqual([]);
        expect(admin.startComputerJob).not.toHaveBeenCalled();
    });

    it('Orbit cannot be asked (or the computer is off): nothing is started and nothing is offered', async () => {
        for (const ended of [null, undefined]) {
            const admin = world(ended);
            const queue = new ConfirmationQueue();
            const answer = await runComputerTool({ job: 'Visa form', try_again: true }, ctx(admin, { confirmations: queue }));
            expect(admin.startComputerJob).not.toHaveBeenCalled();
            expect(queue.tell()).toEqual([]);
            expect(answer).toMatchObject({ started: false });
        }
        const throws = { startComputerJob: vi.fn(), computerEndedJobs: vi.fn().mockRejectedValue(new Error('down')) };
        expect(await runComputerTool({ job: 'Visa form', try_again: true }, ctx(throws as never))).toMatchObject({ started: false });
        expect(throws.startComputerJob).not.toHaveBeenCalled();
    });

    it('in a chat with no fixed line the model is given the exact words to say, and the same call again says nothing twice', async () => {
        const admin = world([VISA, TAXI]);
        const answer = await runComputerTool({ job: 'x', try_again: true }, ctx(admin));
        expect(String(answer.note)).toContain('Which job do you mean: “Visa form” or “Taxi booking”?');
        const queue = new ConfirmationQueue();
        await runComputerTool({ job: 'x', try_again: true }, ctx(admin, { confirmations: queue }));
        await runComputerTool({ job: 'x', try_again: true }, ctx(admin, { confirmations: queue }));
        expect(queue.tell()).toHaveLength(1);
    });

    it('the person\'s yes after the offer is an ordinary new start: no continuation, a key of its own', async () => {
        const admin = world([], { ok: true, job: { id: 'j', status: 'running', queuedFor: null }, restoredFrom: null });
        await runDelivered({ job: 'Visa form' }, ctx(admin));
        expect(admin.startComputerJob.mock.calls[0][2]).not.toHaveProperty('continuesJobId');
        expect(admin.computerEndedJobs).not.toHaveBeenCalled();
    });

    it('Orbit\'s list: `ended` and the one `retry` job, read together, nothing else', async () => {
        const call = vi.fn().mockResolvedValue({ data: { available: true, on: true, ended: [{ id: OLD, title: 'Visa form' }, { id: 'bad id', title: 'x' }, 'junk'], retry: { id: TAXI.id, title: 'Taxi booking', how: 'error' } } });
        const service = new AdminApiService('http://orbit.test');
        vi.spyOn(service, 'isConfigured').mockReturnValue(true);
        (service as unknown as { brickCall: unknown }).brickCall = call;
        expect(await service.computerEndedJobs(BRICK, 'uuid-alice')).toEqual([{ id: OLD, title: 'Visa form' }, { id: TAXI.id, title: 'Taxi booking' }]);
        expect(call.mock.calls[0][3]).toEqual({ userId: 'uuid-alice', retry: '1', ended: '3' });
        (service as unknown as { brickCall: unknown }).brickCall = vi.fn().mockResolvedValue({ data: { available: true, on: false } });
        expect(await service.computerEndedJobs(BRICK, 'uuid-alice')).toBeNull();
        (service as unknown as { brickCall: unknown }).brickCall = vi.fn().mockRejectedValue(new Error('down'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await service.computerEndedJobs(BRICK, 'uuid-alice')).toBeNull();
        warn.mockRestore();
    });
});

// GPT seventh note, A2 (Fable's final lines, /mnt/project-files/brick-three-job-lines/strings.txt): Orbit's `retired` and `stale_consent` answers to a start
describe('a start Orbit answers with retired or stale_consent', () => {
    const run = (reason: string) => ({ startComputerJob: vi.fn().mockResolvedValue({ ok: false, reason }) });
    const ctx = (admin: ReturnType<typeof run>, over: Partial<ComputerToolContext> = {}): ComputerToolContext => ({ admin: admin as never, botId: BRICK, userId: 'uuid-alice', ...over });

    it('retired: the fixed line (no title, no card), nothing started, and every later ask of the turn gets the same answer without sending', async () => {
        const admin = run('retired');
        const queue = new ConfirmationQueue();
        const offered: string[] = [];
        const memory = new Map();
        const over = { confirmations: queue, startKeys: memory, offerNewJob: (title: string) => void offered.push(title), inbound: { roomId: '!r:test', eventId: '$e1' } };
        const first = await runComputerTool({ job: 'Visa form' }, ctx(admin, over));
        const again = await runComputerTool({ job: 'Visa form' }, ctx(admin, over));
        const other = await runComputerTool({ job: 'Book a taxi' }, ctx(admin, over));
        expect(queue.tell()).toEqual(["I already started a job for that request earlier, so I haven't started another. Tell me if you'd like it done again, and I'll start it as a new job, from the beginning."]);
        expect([first.reason, again.reason, other.reason]).toEqual(['retired', 'retired', 'retired']);
        expect(admin.startComputerJob).toHaveBeenCalledTimes(1);
        expect(offered).toEqual([]);
        expect(String(first.note)).toMatch(/NOTHING was started/);
    });

    it('stale_consent: asks whether they still want it (the title when there is one), nothing started', async () => {
        const admin = run('stale_consent');
        const queue = new ConfirmationQueue();
        const answer = await runComputerTool({ job: 'Visa form' }, ctx(admin, { confirmations: queue, startKeys: new Map() }));
        expect(queue.tell()).toEqual(["You asked for this a while ago, so I'm checking before I start anything. Do you still want “Visa form” done? Say yes, and I'll start it."]);
        expect(answer).toMatchObject({ started: false, reason: 'stale_consent' });
        expect(START_REFUSAL_WORDS.staleConsent.plain).toBe("You asked for this a while ago, so I'm checking before I start anything. Do you still want it done? Say yes, and I'll start it.");
    });

    it('no fixed line (a chat without one): the model is given the exact words', async () => {
        const answer = await runComputerTool({ job: 'Visa form' }, ctx(run('retired'), { startKeys: new Map() }));
        expect(String(answer.note)).toContain("I already started a job for that request earlier");
    });

    it('the next message (a new turn, a new key) is an ordinary new start', async () => {
        const memory = new Map();
        const admin = run('stale_consent');
        await runComputerTool({ job: 'Visa form' }, ctx(admin, { startKeys: memory, confirmations: new ConfirmationQueue(), inbound: { roomId: '!r:test', eventId: '$e1' } }));
        admin.startComputerJob.mockResolvedValue({ ok: true, job: { id: 'j', status: 'running', queuedFor: null }, restoredFrom: null });
        const next = new Map();
        const later = await runComputerTool({ job: 'Visa form' }, ctx(admin, { startKeys: next, confirmations: new ConfirmationQueue(), inbound: { roomId: '!r:test', eventId: '$e2' } }));
        expect(later).toMatchObject({ started: true });
        const keys = admin.startComputerJob.mock.calls.map((call) => (call[2] as { startKey: string }).startKey);
        expect(keys[0]).not.toBe(keys[1]);
    });
});
