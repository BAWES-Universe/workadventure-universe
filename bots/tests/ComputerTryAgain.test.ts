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
import { ConfirmationQueue, computerToolDefinitions, forgetSettledStarts, OPEN_START_SLOT, runComputerTool, TRY_AGAIN_ASKED_SLOT, TRY_AGAIN_HELD_SLOT, TRY_AGAIN_PENDING_SLOT, startKeyFor, type ComputerToolContext, type StartKeyEntry } from '../ai/ComputerTools';
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
        const inbound = { roomId: '!room:example.test', eventId: '$yes-1', ts: 1_700_000_000_000 };
        const keys: string[] = [];
        for (let delivery = 0; delivery < 2; delivery++) {
            const admin = asking({ ok: true, job: { id: 'new-1', status: 'running', queuedFor: null }, restoredFrom: null, continued: true });
            await runDelivered({ job: 'Visa form', try_again: true }, context(admin, { retry: { id: OLD, title: 'Visa form' }, inbound, confirmations: new ConfirmationQueue() }));
            const sent = admin.startComputerJob.mock.calls[0][2] as { startKey: string; continuesJobId?: string };
            expect(sent.continuesJobId).toBe(OLD);
            keys.push(sent.startKey);
        }
        expect(keys[0]).toBe(startKeyFor(BRICK, inbound.roomId, inbound.eventId, 0, inbound.ts));
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

    it('two or more ended jobs: asks which, newest first, at most three, a title shown twice told apart; nothing is started', async () => {
        const admin = world([TAXI, { ...TAXI, id: 'dup-dup-dup-dup' }, VISA, FLIGHT, { id: 'zzzz-zzzz-zzzz', title: 'Fourth one' }]);
        const queue = new ConfirmationQueue();
        const answer = await runComputerTool({ job: 'try again', try_again: true }, ctx(admin, { confirmations: queue }));
        // two jobs share a title and Orbit gave no time: they are told apart by their order (FINAL, 24 Nov)
        expect(queue.tell()).toEqual(['Which job do you mean: “Taxi booking” (newer), “Taxi booking” (older) or “Visa form”?']);
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

    // GPT's eighth note, E2: two jobs with one title are two jobs; the person is asked (a fixed, dated line), or says the latest
    describe('two ended jobs of one title', () => {
        const minutes = (n: number) => Date.now() - n * 60_000;
        const twins = () => [
            { id: 'newest-newest-1', title: 'Visa form', endedAt: minutes(25) },
            { id: 'older-older-123', title: 'visa form', endedAt: minutes(3 * 24 * 60) },
        ];

        it('are never taken for one: nothing carries on, and the question says when each ended', async () => {
            const admin = world(twins());
            const queue = new ConfirmationQueue();
            const answer = await runComputerTool({ job: 'Visa form', try_again: true }, ctx(admin, { confirmations: queue }));
            expect(queue.tell()).toEqual(['Which “Visa form” do you mean: the one that ended 25 minutes ago, or the one that ended 3 days ago?']);
            expect(admin.startComputerJob).not.toHaveBeenCalled();
            expect(answer).toMatchObject({ started: false, asked: 'which' });
            expect(String(answer.note)).toMatch(/pick/);
        });

        it('"the latest" (latest: true) keeps the quick path: the newest carries on, no question', async () => {
            const admin = world(twins());
            const queue = new ConfirmationQueue();
            await runDelivered({ job: 'Visa form', try_again: true, latest: true }, ctx(admin, { confirmations: queue }));
            expect(admin.startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', expect.objectContaining({ continuesJobId: 'newest-newest-1' }));
            expect(queue.tell()).toEqual([]);
        });

        it('the end time decides which is the latest when Orbit lists them in another order', async () => {
            const admin = world([...twins()].reverse());
            await runDelivered({ job: 'Visa form', try_again: true, latest: true }, ctx(admin));
            expect(admin.startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', expect.objectContaining({ continuesJobId: 'newest-newest-1' }));
        });

        it('the answer picks one by its number in the question: that one carries on, and only that one', async () => {
            const admin = world(twins());
            const shown = {};
            const question = new ConfirmationQueue();
            await runComputerTool({ job: 'Visa form', try_again: true }, ctx(admin, { confirmations: question, endedShown: shown, startKeys: new Map() }));
            // the choices are kept once the question was delivered, never before
            expect(shown).toEqual({});
            question.tell();
            await question.deliver('$asked');
            // the next message: a new turn
            await runDelivered({ job: 'Visa form', try_again: true, pick: 2 }, ctx(admin, { endedShown: shown, startKeys: new Map() }));
            expect(admin.startComputerJob).toHaveBeenCalledTimes(1);
            expect(admin.startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', expect.objectContaining({ continuesJobId: 'older-older-123' }));
        });

        it('a number with no question behind it, or one that names no job, picks nothing: they are asked', async () => {
            const admin = world(twins());
            const queue = new ConfirmationQueue();
            await runComputerTool({ job: 'Visa form', try_again: true, pick: 2 }, ctx(admin, { confirmations: queue, endedShown: {} }));
            expect(admin.startComputerJob).not.toHaveBeenCalled();
            expect(queue.tell()).toHaveLength(1);
            const asked = new ConfirmationQueue();
            const shown = {};
            const question = new ConfirmationQueue();
            await runComputerTool({ job: 'Visa form', try_again: true }, ctx(admin, { confirmations: question, endedShown: shown, startKeys: new Map() }));
            question.tell();
            await question.deliver('$asked');
            await runComputerTool({ job: 'Visa form', try_again: true, pick: 5 }, ctx(admin, { confirmations: asked, endedShown: shown, startKeys: new Map() }));
            expect(admin.startComputerJob).not.toHaveBeenCalled();
            expect(asked.tell()).toHaveLength(1);
        });

        it('a picked job Orbit no longer lists is never carried on', async () => {
            const shown = { ids: ['gone-gone-1234'], at: Date.now() };
            const admin = world(twins());
            await runComputerTool({ job: 'Visa form', try_again: true, pick: 1 }, ctx(admin, { confirmations: new ConfirmationQueue(), endedShown: shown }));
            expect(admin.startComputerJob).not.toHaveBeenCalled();
        });

        // Opus review of 5bb3748ca, finding 1: the person turned the NEWER one down; it must never be the one that carries on
        it('a picked older job that left Orbit\'s list never carries on the newer one: they are asked again', async () => {
            const admin = world([twins()[0]]);
            const queue = new ConfirmationQueue();
            await runComputerTool({ job: 'Visa form', try_again: true, pick: 2 }, ctx(admin, { confirmations: queue, endedShown: { ids: ['newest-newest-1', 'older-older-123'], at: Date.now() } }));
            expect(admin.startComputerJob).not.toHaveBeenCalled();
            expect(queue.tell()).toHaveLength(1);
        });

        it('a pick kept from a question about another title never carries on a job of that other title', async () => {
            const admin = world([...twins(), TAXI]);
            const queue = new ConfirmationQueue();
            await runComputerTool({ job: 'Visa form', try_again: true, pick: 1 }, ctx(admin, { confirmations: queue, endedShown: { ids: [TAXI.id], at: Date.now() } }));
            expect(admin.startComputerJob).not.toHaveBeenCalled();
            expect(queue.tell()).toHaveLength(1);
        });

        it('an unresolved pick is not "the latest" either', async () => {
            const admin = world(twins());
            const queue = new ConfirmationQueue();
            await runComputerTool({ job: 'Visa form', try_again: true, pick: 9, latest: true }, ctx(admin, { confirmations: queue, endedShown: { ids: ['gone-gone-1234'], at: Date.now() } }));
            expect(admin.startComputerJob).not.toHaveBeenCalled();
            expect(queue.tell()).toHaveLength(1);
        });

        // CodeRabbit on the round 9 head: the retry Orbit named is the LATEST job; a pick is the person's choice and the retry never overrides it
        it('a pick beside the retry Orbit named is resolved against the question\'s list: the retry job never replaces the one they chose', async () => {
            const admin = world(twins());
            const [newest, older] = twins();
            await runDelivered({ job: 'Visa form', try_again: true, pick: 2 }, ctx(admin, { retry: { id: newest.id, title: newest.title }, endedShown: { ids: [newest.id, older.id], at: Date.now() }, startKeys: new Map() }));
            expect(admin.startComputerJob).toHaveBeenCalledTimes(1);
            expect(admin.startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', expect.objectContaining({ continuesJobId: older.id }));
            // no pick: the retry carries on as before
            const plain = world(twins());
            await runDelivered({ job: 'Visa form', try_again: true }, ctx(plain, { retry: { id: newest.id, title: newest.title }, startKeys: new Map() }));
            expect(plain.startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', expect.objectContaining({ continuesJobId: newest.id }));
        });

        it('a pick that resolves to nothing, beside a retry, asks again and never carries on the retry job', async () => {
            const admin = world(twins());
            const [newest] = twins();
            const queue = new ConfirmationQueue();
            await runComputerTool({ job: 'Visa form', try_again: true, pick: 9 }, ctx(admin, { retry: { id: newest.id, title: newest.title }, confirmations: queue, endedShown: { ids: ['gone-gone-1234'], at: Date.now() }, startKeys: new Map() }));
            expect(admin.startComputerJob).not.toHaveBeenCalled();
            expect(queue.tell()).toHaveLength(1);
        });

        it('a question that was never delivered leaves the choices they were last shown, and one that was delivered replaces them', async () => {
            const admin = world(twins());
            const shown = { ids: ['older-older-123', 'newest-newest-1'], at: Date.now() - 1000 };
            const lost = new ConfirmationQueue();
            await runComputerTool({ job: 'Visa form', try_again: true }, ctx(admin, { confirmations: lost, endedShown: shown, startKeys: new Map() }));
            lost.tell();
            lost.drop();
            await lost.deliver(undefined);
            expect(shown.ids).toEqual(['older-older-123', 'newest-newest-1']);
            const delivered = new ConfirmationQueue();
            await runComputerTool({ job: 'Visa form', try_again: true }, ctx(admin, { confirmations: delivered, endedShown: shown, startKeys: new Map() }));
            delivered.tell();
            await delivered.deliver('$asked');
            expect(shown.ids).toEqual(['newest-newest-1', 'older-older-123']);
        });

        it('two retries that found nothing hold both titles: neither one is started as a new job in this turn', async () => {
            const down = world(null);
            const memory = new Map();
            await runComputerTool({ job: 'Visa form', try_again: true }, ctx(down, { startKeys: memory }));
            await runComputerTool({ job: 'Taxi', try_again: true }, ctx(down, { startKeys: memory }));
            for (const job of ['Visa form', 'Taxi']) {
                const answer = await runComputerTool({ job }, ctx(down, { startKeys: memory }));
                expect(answer).toMatchObject({ started: false, success: false });
            }
            expect(down.startComputerJob).not.toHaveBeenCalled();
            // a title nobody retried is still startable in this turn
            const other = await runComputerTool({ job: 'Flight search' }, ctx(down, { startKeys: memory }));
            expect(String(other.note ?? '')).not.toContain('NOTHING was started');
            forgetSettledStarts(memory);
            expect(memory.size).toBe(0);
        });

        it('a retry that named no title holds every title, even after a titled one', async () => {
            const down = world(null);
            const memory = new Map();
            await runComputerTool({ job: 'Visa form', try_again: true }, ctx(down, { startKeys: memory }));
            await runComputerTool({ try_again: true }, ctx(down, { startKeys: memory }));
            const answer = await runComputerTool({ job: 'Flight search' }, ctx(down, { startKeys: memory }));
            expect(answer).toMatchObject({ started: false, success: false });
            expect(down.startComputerJob).not.toHaveBeenCalled();
        });

        it('a single match is unchanged: it carries on without a question', async () => {
            const admin = world([twins()[0], TAXI]);
            const queue = new ConfirmationQueue();
            await runDelivered({ job: 'Visa form', try_again: true }, ctx(admin, { confirmations: queue }));
            expect(admin.startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', expect.objectContaining({ continuesJobId: 'newest-newest-1' }));
            expect(queue.tell()).toEqual([]);
        });
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

    // The tool's own call after an offer (the model's call once the person has said yes or tapped the card): the reply path of the tap is in Brick.moreBricks.test.ts (the system line, no
    // `try_again`, `newJobAsked` kept for that turn only); a typed yes has no code path of its own, the model calls the tool, and this is that call
    it('a direct use_computer call after the offer (what a yes or a tap leads to) is an ordinary new start: no continuation, no ended-jobs read, a key of its own', async () => {
        const admin = world([], { ok: true, job: { id: 'j', status: 'running', queuedFor: null }, restoredFrom: null });
        await runDelivered({ job: 'Visa form' }, ctx(admin));
        expect(admin.startComputerJob.mock.calls[0][2]).not.toHaveProperty('continuesJobId');
        expect(admin.computerEndedJobs).not.toHaveBeenCalled();
    });

    it('after the question, nothing is started in the same turn, however the model words its next call; the person\'s next message clears it (the guard)', async () => {
        const admin = world([VISA, TAXI]);
        const memory = new Map();
        const over = { startKeys: memory, confirmations: new ConfirmationQueue() };
        await runComputerTool({ job: 'x', try_again: true }, ctx(admin, over));
        // the model turns it into a fresh job by itself, or picks one for the person: both refused
        for (const args of [{ job: 'Visa form' }, { job: 'Visa form', try_again: true }, { job: 'Something new', try_again: false }]) {
            const refused = await runComputerTool(args, ctx(admin, over));
            expect(refused).toMatchObject({ started: false });
            expect(String(refused.note)).toMatch(/NOTHING was started/);
        }
        expect(admin.startComputerJob).not.toHaveBeenCalled();
        // their next message ("start a new one") clears it: an ordinary fresh start goes out
        forgetSettledStarts(memory);
        const fresh = await runDelivered({ job: 'Something new' }, ctx(admin, { startKeys: memory }));
        expect(fresh).toMatchObject({ started: true });
        expect(admin.startComputerJob).toHaveBeenCalledTimes(1);
        expect(admin.startComputerJob.mock.calls[0][2]).not.toHaveProperty('continuesJobId');
    });

    // CodeRabbit on the round 8 head, 3 and 15: the calls of one round run together
    describe('overlapping calls of one round', () => {
        const deferred = <T,>() => {
            let resolve!: (value: T) => void;
            let reject!: (error: Error) => void;
            const promise = new Promise<T>((done, fail) => ((resolve = done), (reject = fail)));
            return { promise, resolve, reject };
        };
        const heldWorld = (hold: Promise<unknown>) => ({ startComputerJob: vi.fn().mockResolvedValue(started), computerEndedJobs: vi.fn().mockReturnValue(hold) });
        /** Lets everything that can run without the held promise run. */
        const settleMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));
        const slowStore = (gate: { promise: Promise<void> }) => ({ expected: () => true, delete: async () => undefined, claim: async (_scope: string, entry: { key: string; at: number; payload?: unknown }) => (await gate.promise, { ...entry, mine: true }) });

        it('a fresh start dispatched while the try_again lookup is still pending WAITS for it, and is refused when the question was asked; so is every call after', async () => {
            const hold = deferred<unknown>();
            const admin = heldWorld(hold.promise);
            const memory = new Map();
            const over = { startKeys: memory, confirmations: new ConfirmationQueue() };
            const asking = runComputerTool({ job: 'x', try_again: true }, ctx(admin as never, over));
            const fresh = runComputerTool({ job: 'Something new' }, ctx(admin as never, over));
            await settleMicrotasks();
            // the lookup has not answered: the fresh call has decided nothing and sent nothing
            expect(admin.startComputerJob).not.toHaveBeenCalled();
            hold.resolve([VISA, TAXI]);
            expect(await asking).toMatchObject({ started: false, asked: 'which' });
            const freshAnswer = await fresh;
            expect(freshAnswer).toMatchObject({ started: false });
            expect(String(freshAnswer.note)).toMatch(/NOTHING was started/);
            expect(await runComputerTool({ job: 'Something new' }, ctx(admin as never, over))).toMatchObject({ started: false });
            expect(admin.startComputerJob).not.toHaveBeenCalled();
        });

        it('a fresh start that began BEFORE the try_again, and was waiting on its own steps, is stopped right before its paid send', async () => {
            const hold = deferred<unknown>();
            const admin = heldWorld(hold.promise);
            const gate = deferred<void>();
            // the shared store answers late (as a slow Redis does): the fresh call is waiting on it when the try_again begins
            const store = { expected: () => true, delete: async () => undefined, claim: async (_scope: string, entry: { key: string; at: number; payload?: unknown }) => (await gate.promise, { ...entry, mine: true }) };
            const over = { startKeys: new Map(), confirmations: new ConfirmationQueue(), startKeyStore: store as never };
            // dispatched in the order of the model's calls, neither awaited yet
            const fresh = runComputerTool({ job: 'Something new' }, ctx(admin as never, over));
            const asking = runComputerTool({ job: 'x', try_again: true }, ctx(admin as never, over));
            hold.resolve([VISA, TAXI]);
            await asking;
            gate.resolve();
            expect(await fresh).toMatchObject({ started: false });
            expect(admin.startComputerJob).not.toHaveBeenCalled();
        });

        it('a fresh start that began BEFORE the try_again reaches its paid send while the lookup is still pending: it waits, and is refused once the question was asked', async () => {
            const hold = deferred<unknown>();
            const admin = heldWorld(hold.promise);
            const gate = deferred<void>();
            const store = { expected: () => true, delete: async () => undefined, claim: async (_scope: string, entry: { key: string; at: number; payload?: unknown }) => (await gate.promise, { ...entry, mine: true }) };
            const over = { startKeys: new Map(), confirmations: new ConfirmationQueue(), startKeyStore: store as never };
            const fresh = runComputerTool({ job: 'Something new' }, ctx(admin as never, over));
            const asking = runComputerTool({ job: 'x', try_again: true }, ctx(admin as never, over));
            // the fresh call's own steps finish FIRST: it reaches the send while the ended jobs are still being read
            gate.resolve();
            await settleMicrotasks();
            expect(admin.startComputerJob).not.toHaveBeenCalled();
            hold.resolve([VISA, TAXI]);
            await asking;
            expect(await fresh).toMatchObject({ started: false });
            expect(admin.startComputerJob).not.toHaveBeenCalled();
        });

        // CodeRabbit on ea88b4c1, 3: a start already sent in this turn is never followed by "NOTHING was started"
        it('a fresh start that was ALREADY sent in this turn, then a try_again: nothing is asked, nothing says that nothing was started, and the ended jobs are not read', async () => {
            const sending = deferred<unknown>();
            const admin = { startComputerJob: vi.fn().mockReturnValue(sending.promise), computerEndedJobs: vi.fn().mockResolvedValue([VISA, TAXI]) };
            const queue = new ConfirmationQueue();
            const over = { startKeys: new Map(), confirmations: queue };
            const fresh = runComputerTool({ job: 'Something new' }, ctx(admin as never, over));
            expect(admin.startComputerJob).toHaveBeenCalledTimes(1);
            const retry = await runComputerTool({ job: 'x', try_again: true }, ctx(admin as never, over));
            expect(retry).toMatchObject({ started: false });
            expect(String(retry.note)).not.toMatch(/NOTHING was started/);
            expect(String(retry.note)).toMatch(/already sent/);
            expect(admin.computerEndedJobs).not.toHaveBeenCalled();
            expect(queue.tell()).toEqual([]);
            sending.resolve(started);
            expect(await fresh).toMatchObject({ started: true });
            expect(admin.startComputerJob).toHaveBeenCalledTimes(1);
            // the person's next message clears it: a try_again then asks as usual
            forgetSettledStarts(over.startKeys);
            expect(await runComputerTool({ job: 'x', try_again: true }, ctx(admin as never, over))).toMatchObject({ asked: 'which' });
        });

        // CodeRabbit on ea88b4c1, 4: the question of an earlier turn never stops a newer turn's start
        it('the person writes again while the try_again lookup is pending: when it answers, its question does not stop the newer message\'s start', async () => {
            const hold = deferred<unknown>();
            const admin = heldWorld(hold.promise);
            const memory = new Map();
            const first = runComputerTool({ job: 'x', try_again: true }, ctx(admin as never, { startKeys: memory, confirmations: new ConfirmationQueue() }));
            // their next message: the turn's marks go
            forgetSettledStarts(memory);
            hold.resolve([VISA, TAXI]);
            expect(await first).toMatchObject({ started: false });
            expect(memory.has(TRY_AGAIN_ASKED_SLOT)).toBe(false);
            expect(await runDelivered({ job: 'Something new' }, ctx(admin as never, { startKeys: memory }))).toMatchObject({ started: true });
            expect(admin.startComputerJob).toHaveBeenCalledTimes(1);
        });

        it('the same, when the old lookup names an ended job exactly: it carries nothing on for a turn that is over', async () => {
            const hold = deferred<unknown>();
            const admin = heldWorld(hold.promise);
            const memory = new Map();
            const first = runComputerTool({ job: 'Visa form', try_again: true }, ctx(admin as never, { startKeys: memory }));
            forgetSettledStarts(memory);
            hold.resolve([VISA, TAXI]);
            expect(await first).toMatchObject({ started: false });
            expect(admin.startComputerJob).not.toHaveBeenCalled();
        });

        // GPT's eighth note, E: a lone retry whose target cannot be found authorises no ordinary paid start of its title, in either order of the two calls
        describe('a retry whose ended-job lookup failed', () => {
            it('retry FIRST: a sibling ordinary start of the same title sends nothing', async () => {
                const hold = deferred<unknown>();
                const admin = heldWorld(hold.promise);
                const over = { startKeys: new Map(), confirmations: new ConfirmationQueue() };
                const asking = runComputerTool({ job: 'Visa form', try_again: true }, ctx(admin as never, over));
                const sibling = runComputerTool({ job: 'Visa form' }, ctx(admin as never, over));
                await settleMicrotasks();
                hold.reject(new Error('down'));
                expect(await asking).toMatchObject({ started: false });
                const answer = await sibling;
                expect(answer).toMatchObject({ started: false });
                expect(String(answer.note)).toMatch(/NOTHING was started/);
                expect(admin.startComputerJob).not.toHaveBeenCalled();
                // and one that comes after, in the same turn
                expect(await runComputerTool({ job: 'visa FORM' }, ctx(admin as never, over))).toMatchObject({ started: false });
                expect(admin.startComputerJob).not.toHaveBeenCalled();
            });

            it('start FIRST (waiting on its own steps): it is stopped right before its paid send once the retry found nothing', async () => {
                const admin = { startComputerJob: vi.fn().mockResolvedValue(started), computerEndedJobs: vi.fn().mockRejectedValue(new Error('down')) };
                const gate = deferred<void>();
                const over = { startKeys: new Map(), confirmations: new ConfirmationQueue(), startKeyStore: slowStore(gate) as never };
                const sibling = runComputerTool({ job: 'Visa form' }, ctx(admin as never, over));
                const asking = runComputerTool({ job: 'Visa form', try_again: true }, ctx(admin as never, over));
                await asking;
                gate.resolve();
                expect(await sibling).toMatchObject({ started: false });
                expect(admin.startComputerJob).not.toHaveBeenCalled();
                // nothing is left behind for the next ask to send
                expect([...over.startKeys.values()].some((entry) => entry.open)).toBe(false);
            });

            it('a start with ANOTHER title in the same turn (a genuinely separate ask) still goes', async () => {
                const hold = deferred<unknown>();
                const admin = heldWorld(hold.promise);
                const over = { startKeys: new Map() };
                const asking = runComputerTool({ job: 'Visa form', try_again: true }, ctx(admin as never, over));
                const other = runDelivered({ job: 'Book a taxi' }, ctx(admin as never, over));
                await settleMicrotasks();
                hold.reject(new Error('down'));
                await asking;
                expect(await other).toMatchObject({ started: true });
                expect(admin.startComputerJob).toHaveBeenCalledTimes(1);
            });

            it('a retry that named no title holds every ordinary start of the turn; the next message starts one', async () => {
                const hold = deferred<unknown>();
                const admin = heldWorld(hold.promise);
                const over = { startKeys: new Map<string, StartKeyEntry>() };
                const asking = runComputerTool({ try_again: true } as never, ctx(admin as never, over));
                const sibling = runComputerTool({ job: 'Anything at all' }, ctx(admin as never, over));
                await settleMicrotasks();
                hold.reject(new Error('down'));
                await asking;
                expect(await sibling).toMatchObject({ started: false });
                expect(admin.startComputerJob).not.toHaveBeenCalled();
                // their next message (a new turn): a deliberate fresh start is theirs to make
                forgetSettledStarts(over.startKeys);
                expect(await runDelivered({ job: 'Anything at all' }, ctx(admin as never, over))).toMatchObject({ started: true });
                expect(admin.startComputerJob).toHaveBeenCalledTimes(1);
            });

            it('a second retry that DOES find its job carries it on (it is what they asked for)', async () => {
                const admin = { startComputerJob: vi.fn().mockResolvedValue(started), computerEndedJobs: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue([VISA]) };
                const over = { startKeys: new Map() };
                await runComputerTool({ job: 'Visa form', try_again: true }, ctx(admin as never, over));
                expect(await runDelivered({ job: 'Visa form', try_again: true }, ctx(admin as never, over))).toMatchObject({ started: true });
                expect(admin.startComputerJob).toHaveBeenCalledWith(BRICK, 'uuid-alice', expect.objectContaining({ continuesJobId: OLD }));
            });
        });

        // CodeRabbit on 543f5b35, R2-1: a retry overtaken by the person's next message leaves no offer in the newer turn
        it('the person writes again while the ended jobs are read and none exist: no "start a new job" offer and no words reach the newer turn; a current retry still offers', async () => {
            const hold = deferred<unknown>();
            const admin = heldWorld(hold.promise);
            const offered: string[] = [];
            const queue = new ConfirmationQueue();
            const memory = new Map();
            const first = runComputerTool({ job: 'Upload the report', try_again: true }, ctx(admin as never, { startKeys: memory, confirmations: queue, offerNewJob: (title) => void offered.push(title) }));
            forgetSettledStarts(memory);
            hold.resolve([]);
            expect(await first).toMatchObject({ started: false });
            expect(offered).toEqual([]);
            expect(queue.tell()).toEqual([]);
            expect(memory.has(TRY_AGAIN_ASKED_SLOT)).toBe(false);
            // not overtaken: the same retry offers as before
            const quiet = deferred<unknown>();
            const current = runComputerTool({ job: 'Upload the report', try_again: true }, ctx(heldWorld(quiet.promise) as never, { startKeys: new Map(), confirmations: new ConfirmationQueue(), offerNewJob: (title) => void offered.push(title) }));
            quiet.resolve([]);
            expect(await current).toMatchObject({ started: false });
            expect(offered).toEqual(['Upload the report']);
        });

        it('the same with ended jobs to choose from: the question of the turn that is over is not said in the newer one', async () => {
            const hold = deferred<unknown>();
            const admin = heldWorld(hold.promise);
            const queue = new ConfirmationQueue();
            const memory = new Map();
            const first = runComputerTool({ job: 'x', try_again: true }, ctx(admin as never, { startKeys: memory, confirmations: queue }));
            forgetSettledStarts(memory);
            hold.resolve([VISA, TAXI]);
            expect(await first).toMatchObject({ started: false });
            expect(queue.tell()).toEqual([]);
        });

        it('a fresh call that WAITED for the pending lookup while the person wrote again: it belongs to the turn that is over and sends nothing', async () => {
            const hold = deferred<unknown>();
            const admin = heldWorld(hold.promise);
            const memory = new Map();
            const over = { startKeys: memory, confirmations: new ConfirmationQueue() };
            const asking = runComputerTool({ job: 'x', try_again: true }, ctx(admin as never, over));
            const fresh = runComputerTool({ job: 'Something new' }, ctx(admin as never, over));
            await settleMicrotasks();
            forgetSettledStarts(memory);
            hold.resolve([]);
            await asking;
            expect(await fresh).toMatchObject({ started: false });
            expect(admin.startComputerJob).not.toHaveBeenCalled();
            // it never even made a record: it is a call of the turn that is over
            expect([...memory.values()].some((entry) => entry.open)).toBe(false);
        });

        // CodeRabbit on 543f5b35, R2-2: a start waiting on the shared store when the person writes again is sent nowhere in the newer turn

        it('a carried-on continuation waiting on the store while the person writes again: nothing is sent, and the record that was never sent goes with it (the newer turn is not marked as dispatched)', async () => {
            const admin = heldWorld(Promise.resolve([VISA, TAXI]));
            const gate = deferred<void>();
            const memory = new Map();
            const over = { startKeys: memory, startKeyStore: slowStore(gate) as never, retry: { id: OLD, title: 'Visa form' } };
            const going = runComputerTool({ job: 'Visa form', try_again: true }, ctx(admin as never, over));
            await settleMicrotasks();
            forgetSettledStarts(memory);
            gate.resolve();
            const answer = await going;
            expect(answer).toMatchObject({ started: false });
            expect(admin.startComputerJob).not.toHaveBeenCalled();
            expect([...memory.values()].some((entry) => entry.open)).toBe(false);
            // the newer turn's own try_again is not told that a start was dispatched
            const retry = await runComputerTool({ job: 'x', try_again: true }, ctx(admin as never, { startKeys: memory, confirmations: new ConfirmationQueue() }));
            expect(String(retry.note)).not.toMatch(/already sent/);
        });

        // Opus on c11cf820, 1: an overtaken start that was never sent leaves nothing for the next ask to send
        it('an overtaken fresh start that was never sent leaves nothing behind: the newer turn\'s DIFFERENT ask sends its own words, never the old ones', async () => {
            const admin = heldWorld(Promise.resolve([]));
            const gate = deferred<void>();
            const memory = new Map();
            const going = runComputerTool({ job: 'Book a taxi' }, ctx(admin as never, { startKeys: memory, startKeyStore: slowStore(gate) as never }));
            await settleMicrotasks();
            forgetSettledStarts(memory);
            gate.resolve();
            expect(await going).toMatchObject({ started: false });
            const quickStore = { expected: () => true, delete: async () => undefined, claim: async (_s: string, entry: { key: string; at: number; payload?: unknown }) => ({ ...entry, mine: true }) };
            await runComputerTool({ job: 'Book a hotel' }, ctx(admin as never, { startKeys: memory, startKeyStore: quickStore as never }));
            const titles = admin.startComputerJob.mock.calls.map((call: unknown[]) => (call[2] as { title: string }).title);
            expect(titles).toEqual(['Book a hotel']);
        });

        it('a key that MAY have gone out before stays when its ask is overtaken (it is looked up, never dropped), and nothing is sent in the newer turn', async () => {
            const lookup = deferred<unknown>();
            const admin = { ...heldWorld(Promise.resolve([])), lookUpComputerStart: vi.fn().mockReturnValue(lookup.promise) };
            const memory = new Map<string, StartKeyEntry>([[OPEN_START_SLOT, { key: 'my-own-key-0001', at: Date.now() - 1000, open: true, sent: true, payload: { title: 'Book a taxi', writes: false } }]]);
            const going = runComputerTool({ job: 'Book a taxi' }, ctx(admin as never, { startKeys: memory }));
            await settleMicrotasks();
            forgetSettledStarts(memory);
            lookup.resolve('none');
            expect(await going).toMatchObject({ started: false });
            expect(admin.startComputerJob).not.toHaveBeenCalled();
            expect(memory.get(OPEN_START_SLOT)).toMatchObject({ key: 'my-own-key-0001', open: true });
        });

        // Opus on c11cf820, 2: a call that waited on an in-flight start keeps the turn it began under
        it('a call that waited on an in-flight start of the turn that is over sends nothing in the newer turn', async () => {
            const admin = heldWorld(Promise.resolve([]));
            const memory = new Map();
            const hold = deferred<unknown>();
            (admin as any).startComputerJob = vi.fn().mockReturnValue(hold.promise);
            const first = runComputerTool({ job: 'Book a taxi' }, ctx(admin as never, { startKeys: memory }));
            await settleMicrotasks();
            const second = runComputerTool({ job: 'Book a taxi' }, ctx(admin as never, { startKeys: memory }));
            await settleMicrotasks();
            forgetSettledStarts(memory);
            hold.reject(new Error('down'));
            await first;
            expect(await second).toMatchObject({ started: false });
            expect((admin as any).startComputerJob).toHaveBeenCalledTimes(1);
        });

        it('the same for a fresh start; with NO newer message the start goes out as before', async () => {
            const admin = heldWorld(Promise.resolve([]));
            const gate = deferred<void>();
            const memory = new Map();
            const over = { startKeys: memory, startKeyStore: slowStore(gate) as never };
            const going = runComputerTool({ job: 'Something new' }, ctx(admin as never, over));
            await settleMicrotasks();
            forgetSettledStarts(memory);
            gate.resolve();
            expect(await going).toMatchObject({ started: false });
            expect(admin.startComputerJob).not.toHaveBeenCalled();
            // control: nobody wrote again
            const admin2 = heldWorld(Promise.resolve([]));
            const gate2 = deferred<void>();
            const quiet = runComputerTool({ job: 'Something new' }, ctx(admin2 as never, { startKeys: new Map(), startKeyStore: slowStore(gate2) as never }));
            await settleMicrotasks();
            gate2.resolve();
            expect(await quiet).toMatchObject({ started: true });
            expect(admin2.startComputerJob).toHaveBeenCalledTimes(1);
        });

        it('two try_agains in one round, one of which asks: neither starts (the one naming an ended job exactly waits, then finds the question)', async () => {
            const hold = deferred<unknown>();
            const admin = heldWorld(hold.promise);
            const over = { startKeys: new Map(), confirmations: new ConfirmationQueue() };
            const asking = runComputerTool({ job: 'x', try_again: true }, ctx(admin as never, over));
            const exact = runComputerTool({ job: 'Visa form', try_again: true }, ctx(admin as never, over));
            hold.resolve([VISA, TAXI]);
            const [, exactAnswer] = await Promise.all([asking, exact]);
            expect(exactAnswer).toMatchObject({ started: false });
            expect(admin.startComputerJob).not.toHaveBeenCalled();
        });

        it('a lookup that cannot be answered asks nothing and blocks nothing: a fresh call that waited for it goes on as an ordinary ask', async () => {
            const hold = deferred<unknown>();
            const admin = heldWorld(hold.promise);
            const memory = new Map();
            const over = { startKeys: memory };
            const asking = runComputerTool({ job: 'Visa form', try_again: true }, ctx(admin as never, over));
            const fresh = runDelivered({ job: 'Something new' }, ctx(admin as never, over));
            await settleMicrotasks();
            expect(admin.startComputerJob).not.toHaveBeenCalled();
            hold.reject(new Error('down'));
            expect(await asking).toMatchObject({ started: false });
            expect(await fresh).toMatchObject({ started: true });
            expect(admin.startComputerJob).toHaveBeenCalledTimes(1);
            expect(memory.has(TRY_AGAIN_PENDING_SLOT)).toBe(false);
        });
    });

    // CodeRabbit on the round 8 head, 2: a title longer than a start carries is still compared whole
    // CodeRabbit on ea88b4c1, 2: the cut of the words must not take the last accent before they are compared
    it('a 200-letter title ending in an accented letter, selected with the accent written as a combining mark, is the same job: it carries on, no question', async () => {
        const stored = { id: OLD, title: `${'a'.repeat(199)}\u00e9` };
        expect(stored.title.length).toBe(200);
        const selected = `${'a'.repeat(199)}e\u0301`;
        expect(selected.length).toBe(201);
        const admin = world([stored]);
        const queue = new ConfirmationQueue();
        const answer = await runDelivered({ job: selected, try_again: true }, ctx(admin, { startKeys: new Map(), confirmations: queue }));
        expect(answer).toMatchObject({ started: true });
        expect((admin.startComputerJob.mock.calls[0][2] as { continuesJobId?: string }).continuesJobId).toBe(OLD);
    });

    it('a title of more than 120 letters that names an ended job EXACTLY carries it on (compared whole, cut only when it becomes a start)', async () => {
        const long = { id: OLD, title: `Fill in the visa form for ${'a'.repeat(100)} and send it to the embassy by the end of the week` };
        expect(long.title.length).toBeGreaterThan(120);
        const admin = world([long]);
        const answer = await runDelivered({ job: long.title, try_again: true }, ctx(admin, { startKeys: new Map() }));
        expect(answer).toMatchObject({ started: true });
        expect(admin.startComputerJob).toHaveBeenCalledTimes(1);
        const sent = admin.startComputerJob.mock.calls[0][2] as { title: string; continuesJobId?: string };
        expect(sent.continuesJobId).toBe(OLD);
        expect(sent.title.length).toBeLessThanOrEqual(120);
    });

    it('a try_again that could not ask Orbit puts no guard up (they may simply ask again)', async () => {
        const memory = new Map();
        const down = world(null);
        await runComputerTool({ job: 'Visa form', try_again: true }, ctx(down, { startKeys: memory }));
        // no open start, no asked mark: only the hold on an ORDINARY start of that title (GPT's eighth note, E), which the person's next message clears
        expect([...memory.keys()]).toEqual([TRY_AGAIN_HELD_SLOT]);
        expect(memory.has(TRY_AGAIN_ASKED_SLOT)).toBe(false);
        forgetSettledStarts(memory);
        expect(memory.size).toBe(0);
    });

    it('Orbit\'s list carries when each job ended (an ISO time, or a number), and none when it says none', async () => {
        const service = new AdminApiService('http://orbit.test');
        vi.spyOn(service, 'isConfigured').mockReturnValue(true);
        (service as unknown as { brickCall: unknown }).brickCall = vi.fn().mockResolvedValue({
            data: {
                available: true,
                on: true,
                ended: [
                    { id: OLD, title: 'Visa form', continuable: true, endedAt: '2026-11-24T14:05:00.000Z' },
                    { id: 'job-numeric-1', title: 'Visa form', continuable: true, endedAt: 1_795_000_000_000 },
                    { id: 'job-null-0001', title: 'Visa form', continuable: true, endedAt: null },
                    { id: 'job-junk-0001', title: 'Visa form', continuable: true, endedAt: 'soon' },
                ],
            },
        });
        expect(await service.computerEndedJobs(BRICK, 'uuid-alice')).toEqual([
            { id: OLD, title: 'Visa form', endedAt: Date.parse('2026-11-24T14:05:00.000Z') },
            { id: 'job-numeric-1', title: 'Visa form', endedAt: 1_795_000_000_000 },
            { id: 'job-null-0001', title: 'Visa form' },
            { id: 'job-junk-0001', title: 'Visa form' },
        ]);
    });

    it('Orbit\'s list: only `continuable` ended jobs are offered; an Orbit with no `ended` list gives the one `retry` job', async () => {
        const service = new AdminApiService('http://orbit.test');
        vi.spyOn(service, 'isConfigured').mockReturnValue(true);
        const answer = (data: Record<string, unknown>) => ((service as unknown as { brickCall: unknown }).brickCall = vi.fn().mockResolvedValue({ data }));
        const call = answer({ available: true, on: true, ended: [{ id: OLD, title: 'Visa form', continuable: true }, { id: TAXI.id, title: 'Taxi booking', continuable: false }, { id: 'bad id', title: 'x', continuable: true }, 'junk', { id: FLIGHT.id, title: 'Flight search' }], retry: { id: TAXI.id, title: 'Taxi booking', how: 'error' } });
        expect(await service.computerEndedJobs(BRICK, 'uuid-alice')).toEqual([{ id: OLD, title: 'Visa form' }]);
        expect(call.mock.calls[0][3]).toEqual({ userId: 'uuid-alice', retry: '1', ended: '5' });
        // nothing continuable: nothing to pick (the single retry job is only the fallback of an Orbit that sends no list)
        answer({ available: true, on: true, ended: [{ id: TAXI.id, title: 'Taxi booking', continuable: false }], retry: { id: OLD, title: 'Visa form', how: 'error' } });
        expect(await service.computerEndedJobs(BRICK, 'uuid-alice')).toEqual([]);
        answer({ available: true, on: true, retry: { id: OLD, title: 'Visa form', how: 'error' } });
        expect(await service.computerEndedJobs(BRICK, 'uuid-alice')).toEqual([{ id: OLD, title: 'Visa form' }]);
        answer({ available: true, on: true });
        expect(await service.computerEndedJobs(BRICK, 'uuid-alice')).toEqual([]);
        answer({ available: true, on: false });
        expect(await service.computerEndedJobs(BRICK, 'uuid-alice')).toBeNull();
        (service as unknown as { brickCall: unknown }).brickCall = vi.fn().mockRejectedValue(new Error('down'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await service.computerEndedJobs(BRICK, 'uuid-alice')).toBeNull();
        warn.mockRestore();
    });
});

// GPT seventh note, A2 (Fable's final lines, /mnt/project-files/brick-three-job-lines/strings.txt): Orbit's `retired` and `stale_consent` answers to a start
// GPT's eighth note, A2: a Matrix event with no time of its own is never the consent of a paid start (no clock stands in for it, so a redelivery cannot gain new spending permission)
describe('an event with no time of its own starts nothing', () => {
    const ok = { ok: true, job: { id: 'j', status: 'running', queuedFor: null }, restoredFrom: null };
    const ctx = (admin: { startComputerJob: ReturnType<typeof vi.fn> }, over: Partial<ComputerToolContext> = {}): ComputerToolContext => ({ admin: admin as never, botId: BRICK, userId: 'uuid-alice', ...over });

    it('a start of an event with no `ts` sends nothing and says so, however often it is delivered', async () => {
        const admin = { startComputerJob: vi.fn().mockResolvedValue(ok) };
        const memory = new Map();
        const over = { startKeys: memory, confirmations: new ConfirmationQueue(), inbound: { roomId: '!r:test', eventId: '$undated' } };
        const first = await runComputerTool({ job: 'Visa form' }, ctx(admin, over));
        expect(first).toMatchObject({ started: false });
        expect(String(first.note)).toMatch(/no time of its own/);
        // the same event again (a restart, another server): still nothing, and nothing is kept
        const again = await runComputerTool({ job: 'Visa form' }, ctx(admin, { ...over, startKeys: new Map(), confirmations: new ConfirmationQueue() }));
        expect(again).toMatchObject({ started: false });
        expect(admin.startComputerJob).not.toHaveBeenCalled();
        expect([...memory.values()].some((entry) => entry.open)).toBe(false);
    });

    it('the same event WITH its time starts, with a key whose time is that time (and the key is the same every delivery)', async () => {
        const admin = { startComputerJob: vi.fn().mockResolvedValue(ok) };
        const inbound = { roomId: '!r:test', eventId: '$dated', ts: 1_700_000_000_000 };
        await runComputerTool({ job: 'Visa form' }, ctx(admin, { startKeys: new Map(), confirmations: new ConfirmationQueue(), inbound }));
        await runComputerTool({ job: 'Visa form' }, ctx(admin, { startKeys: new Map(), confirmations: new ConfirmationQueue(), inbound }));
        const keys = admin.startComputerJob.mock.calls.map((call) => (call[2] as { startKey: string }).startKey);
        expect(keys).toHaveLength(2);
        expect(keys[0]).toBe(keys[1]);
        expect(keys[0].startsWith(`t${(1_700_000_000_000).toString(36)}-`)).toBe(true);
    });

    it('a chat with no inbound event at all (not Matrix) keeps its random key', async () => {
        const admin = { startComputerJob: vi.fn().mockResolvedValue(ok) };
        expect(await runComputerTool({ job: 'Visa form' }, ctx(admin, { startKeys: new Map(), confirmations: new ConfirmationQueue() }))).toMatchObject({ started: true });
    });
});

describe('a start Orbit answers with retired or stale_consent', () => {
    const run = (reason: string) => ({ startComputerJob: vi.fn().mockResolvedValue({ ok: false, reason }) });
    const ctx = (admin: ReturnType<typeof run>, over: Partial<ComputerToolContext> = {}): ComputerToolContext => ({ admin: admin as never, botId: BRICK, userId: 'uuid-alice', ...over });

    it('retired: the fixed line (no title, no card), nothing started, and every later ask of the turn gets the same answer without sending', async () => {
        const admin = run('retired');
        const queue = new ConfirmationQueue();
        const offered: string[] = [];
        const memory = new Map();
        const over = { confirmations: queue, startKeys: memory, offerNewJob: (title: string) => void offered.push(title), inbound: { roomId: '!r:test', eventId: '$e1', ts: 1_700_000_000_000 } };
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
        await runComputerTool({ job: 'Visa form' }, ctx(admin, { startKeys: memory, confirmations: new ConfirmationQueue(), inbound: { roomId: '!r:test', eventId: '$e1', ts: 1_700_000_000_000 } }));
        admin.startComputerJob.mockResolvedValue({ ok: true, job: { id: 'j', status: 'running', queuedFor: null }, restoredFrom: null });
        const next = new Map();
        const later = await runComputerTool({ job: 'Visa form' }, ctx(admin, { startKeys: next, confirmations: new ConfirmationQueue(), inbound: { roomId: '!r:test', eventId: '$e2', ts: 1_700_000_005_000 } }));
        expect(later).toMatchObject({ started: true });
        const keys = admin.startComputerJob.mock.calls.map((call) => (call[2] as { startKey: string }).startKey);
        expect(keys[0]).not.toBe(keys[1]);
    });
});
