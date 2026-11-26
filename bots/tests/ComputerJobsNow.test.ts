/**
 * A person's own Brick is told, with every message, what is really on its computer (the Brick chat audit, 26 Nov, findings 3 and 4). Stay Brick said a search was "running" when none was,
 * said "there was no job" about the Airbnb search that had run and finished (its jobs list showed only what was still going), spoke of a second job that never existed, and said it had no
 * computer while one was being given to it. These tests fail on the code before this change.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), request: vi.fn(), isAxiosError: () => false }, isAxiosError: () => false }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import axios from 'axios';
import { AdminApiService, controlAnswerOf, type ComputerControlAsk } from '../server/AdminApiService';
import { AIService } from '../ai/AIService';
import { COMPUTER_JOBS_TOOL, newControlState, runComputerControlTool } from '../ai/ComputerControlTools';
import { ConfirmationQueue } from '../ai/ComputerTools';
import { JOBS_NOW_RULES, NO_COMPUTER_NOTE, agoWords, computerJobsNote, computerJobsNowOf, endedJobWords, type ComputerJobsNow, type EndedJobNow } from '../ai/ComputerJobsNow';

const BRICK = '0b7c1d2e-1111-4222-8333-944455556666';
const request = axios.request as unknown as ReturnType<typeof vi.fn>;
const NOW = Date.parse('2026-11-26T09:43:00Z');
const min = (n: number) => NOW + n * 60_000;

/** The Airbnb search of the audit: it ran 12:32 to 12:43 Kuwait time and finished. Nothing else exists. */
const airbnb: EndedJobNow = { title: 'Airbnb Bangkok search', status: 'done', endedBy: null, endedAt: min(-9), files: [], why: null };
const onlyFinished: ComputerJobsNow = { live: [], ended: [airbnb] };

afterEach(() => {
    vi.clearAllMocks();
});

describe('the note a Brick gets about its computer jobs', () => {
    it('a job that ran and finished is told as finished, and nothing is said to be running (the Brick said "there was no job")', () => {
        const note = computerJobsNote(onlyFinished, NOW);
        expect(note).toContain('Nothing is working, waiting or in line on your computer right now.');
        expect(note).toContain('- “Airbnb Bangkok search”: finished 9 minutes ago. It left no files.');
        expect(note).toContain('trust it over anything said earlier in this chat');
        expect(note).toContain(JOBS_NOW_RULES);
    });

    it('its rules: nothing runs unless listed, no invented second job, an ended job is never denied, and what an ended job did not give is got by a new job at once', () => {
        expect(JOBS_NOW_RULES).toContain('Never invent a job, a second job or a step.');
        expect(JOBS_NOW_RULES).toContain('Never say a job listed above as ended did not happen or never existed.');
        expect(JOBS_NOW_RULES).toContain('start a new job with use_computer in this same reply that gets exactly that');
        expect(JOBS_NOW_RULES).toContain('Do not ask them to say go first.');
        // Nothing money-related is loosened: no price, no amount, no word that a start needs no approval
        expect(JOBS_NOW_RULES).not.toMatch(/\$|price|cost|free of charge|approval/i);
    });

    it('live jobs say their state: working with its step, waiting for the person and who has the screen, in line, paused, waiting for the month', () => {
        const note = computerJobsNote(
            {
                live: [
                    { title: 'Visa form', status: 'running', queuedFor: null, waitingFor: null, control: 'brick', stepDone: 2, stepTotal: 6, stepLabel: 'Opening (the) form', startedAt: min(-3) },
                    { title: 'Bank sign-in', status: 'waiting', queuedFor: null, waitingFor: 'signin', control: 'person', stepDone: 1, stepTotal: null, stepLabel: null, startedAt: min(-61) },
                    { title: 'Taxi booking', status: 'queued', queuedFor: 'turn', waitingFor: null, control: 'brick', stepDone: 0, stepTotal: null, stepLabel: null, startedAt: null },
                    { title: 'Shop website', status: 'queued', queuedFor: 'paused', waitingFor: null, control: 'brick', stepDone: 3, stepTotal: null, stepLabel: null, startedAt: null },
                    { title: 'Price list', status: 'queued', queuedFor: 'allowance', waitingFor: null, control: 'brick', stepDone: 0, stepTotal: null, stepLabel: null, startedAt: null },
                    { title: 'Menu', status: 'queued', queuedFor: 'pool', waitingFor: null, control: 'brick', stepDone: 0, stepTotal: null, stepLabel: null, startedAt: null },
                ],
                ended: [],
            },
            NOW
        );
        expect(note).toContain('- “Visa form”: working now, step 2 of 6 (Opening the form). Started 3 minutes ago.');
        expect(note).toContain('- “Bank sign-in”: waiting for them to sign in. They have the screen now. Started 1 hour ago.');
        expect(note).toContain('- “Taxi booking”: in line, not started yet: it starts by itself when the job before it ends.');
        expect(note).toContain('- “Shop website”: paused: it carries on only when they say resume.');
        expect(note).toContain("- “Price list”: waiting, not started yet: this month's computer time is used up");
        expect(note).toContain('- “Menu”: waiting for a free computer, not started yet: it starts by itself.');
        expect(note).toContain('No job ended in the last week.');
    });

    it('ended jobs say how they ended, the reason of one that could not go on, and the files they left', () => {
        expect(endedJobWords({ title: 'Shop website', status: 'failed', endedBy: 'error', endedAt: min(-120), files: [], why: 'The site would not "load"' }, NOW)).toBe(
            '“Shop website”: could not finish because of a problem on our side 2 hours ago. It said: "The site would not \'load\'".'
        );
        expect(endedJobWords({ title: 'Visa form', status: 'stopped', endedBy: 'person', endedAt: min(-60 * 26), files: [], why: null }, NOW)).toBe('“Visa form”: stopped by them 1 day ago.');
        expect(endedJobWords({ title: 'Prices', status: 'done', endedBy: null, endedAt: min(0), files: ['prices.csv', 'notes.txt'], why: null }, NOW)).toBe('“Prices”: finished just now. Files it left: prices.csv, notes.txt.');
        expect(endedJobWords({ title: 'Form', status: 'failed', endedBy: null, endedAt: null, files: [], why: null }, NOW)).toBe('“Form”: stopped at a step it could not get past.');
    });

    it('nothing at all: it says so plainly', () => {
        const note = computerJobsNote({ live: [], ended: [] }, NOW);
        expect(note).toContain('Nothing is working, waiting or in line on your computer right now.');
        expect(note).toContain('No job ended in the last week.');
    });

    it('times read as people say them', () => {
        expect(agoWords(min(-0.5), NOW)).toBe('just now');
        expect(agoWords(min(-1), NOW)).toBe('1 minute ago');
        expect(agoWords(min(-59), NOW)).toBe('59 minutes ago');
        expect(agoWords(min(-60 * 5), NOW)).toBe('5 hours ago');
        expect(agoWords(min(-60 * 24 * 3), NOW)).toBe('3 days ago');
    });

    it('Orbit’s `jobs` is read only as far as it is well formed, and an Orbit that sends none says nothing', () => {
        expect(computerJobsNowOf(undefined)).toBeNull();
        expect(computerJobsNowOf({ live: [] })).toBeNull();
        const read = computerJobsNowOf({
            live: [{ title: ' Visa\nform ', status: 'running', stepDone: 2, stepTotal: 6, stepLabel: 'Page 2', control: 'brick', startedAt: '2026-11-26T09:40:00.000Z' }, { title: 'x', status: 'done' }, { status: 'running' }, null],
            ended: [{ title: 'Airbnb Bangkok search', status: 'done', endedBy: null, endedAt: '2026-11-26T09:34:00.000Z', files: ['a.csv', 7, ''], why: null }, { title: 'y', status: 'running' }],
        });
        expect(read).toEqual({
            live: [{ title: 'Visa form', status: 'running', queuedFor: null, waitingFor: null, control: 'brick', stepDone: 2, stepTotal: 6, stepLabel: 'Page 2', startedAt: Date.parse('2026-11-26T09:40:00.000Z') }],
            ended: [{ title: 'Airbnb Bangkok search', status: 'done', endedBy: null, endedAt: Date.parse('2026-11-26T09:34:00.000Z'), files: ['a.csv'], why: null }],
        });
    });

    it('the note for a Brick with no computer on: no job of its is running, and where they give it one', () => {
        expect(NO_COMPUTER_NOTE).toContain('no computer job of yours is running');
        expect(NO_COMPUTER_NOTE).toContain('Never say a computer job is running or coming.');
        expect(NO_COMPUTER_NOTE).toContain('under Computer on your Brick page');
    });
});

describe('asking Orbit for the jobs', () => {
    const token = process.env.BOT_SERVICE_TOKEN;
    afterEach(() => {
        if (token === undefined) delete process.env.BOT_SERVICE_TOKEN;
        else process.env.BOT_SERVICE_TOKEN = token;
    });
    const service = () => {
        const admin = new AdminApiService('http://orbit.test');
        vi.spyOn(admin, 'isConfigured').mockReturnValue(true);
        return admin;
    };

    it('the one computer read also asks for the jobs (jobs=1), and says whether a computer could be given', async () => {
        process.env.BOT_SERVICE_TOKEN = 'secret';
        request.mockResolvedValueOnce({ data: { available: true, on: true, busy: false, jobs: { live: [], ended: [{ title: 'Airbnb Bangkok search', status: 'done', endedBy: null, endedAt: '2026-11-26T09:34:00.000Z', files: [], why: null }] } } });
        const state = await service().computerState(BRICK, 'uuid-alice');
        expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'get', params: { userId: 'uuid-alice', retry: '1', jobs: '1' } }));
        expect(state).toMatchObject({ on: true, available: true, read: true, jobs: { live: [], ended: [{ title: 'Airbnb Bangkok search', status: 'done' }] } });
        // Off, with a computer that could be given: no jobs, and Orbit was read
        request.mockResolvedValueOnce({ data: { available: true, on: false, busy: false, jobs: { live: [], ended: [] } } });
        expect(await service().computerState(BRICK, 'uuid-alice')).toMatchObject({ on: false, available: true, read: true, jobs: null });
        // Orbit could not be asked: nothing is known
        request.mockRejectedValueOnce(new Error('down'));
        expect(await service().computerState(BRICK, 'uuid-alice')).toMatchObject({ on: false, available: false, read: false, jobs: null });
    });
});

describe('Brick reads its computer fresh with every message', () => {
    type Ai = {
        noteBrick: AIService['noteBrick'];
        computerOnFor(botId: string, playerId: number, admin?: unknown, fresh?: boolean): Promise<boolean>;
        computerJobsNoteFor(botId: string, playerId: number): string;
    };
    function service(computerState: ReturnType<typeof vi.fn>) {
        const memory: Record<string, unknown> = { userUuid: 'uuid-alice', conversationHistory: [] };
        const ai = Object.create(AIService.prototype) as AIService;
        Object.assign(ai, {
            helperBricks: new Set<string>(),
            ownBricks: new Set<string>(),
            knownBricks: new Set<string>(),
            brickOwners: new Map<string, string>(),
            computerOnCache: new Map(),
            adminApiService: { isConfigured: () => true, computerState },
            conversationMemory: { getMemory: () => memory },
        });
        (ai as unknown as Ai).noteBrick(BRICK, { isDefault: false });
        return ai as unknown as Ai;
    }

    it('a computer given a moment ago is on for the next message (the short-lived "off" is not kept over a new message)', async () => {
        const computerState = vi.fn().mockResolvedValueOnce({ on: false, retry: null, available: true, jobs: null, read: true }).mockResolvedValueOnce({ on: true, retry: null, available: true, jobs: { live: [], ended: [] }, read: true });
        const ai = service(computerState);
        expect(await ai.computerOnFor(BRICK, 1, undefined, true)).toBe(false);
        expect(ai.computerJobsNoteFor(BRICK, 1)).toBe(NO_COMPUTER_NOTE);
        // The owner taps "Give it a computer" and writes again a few seconds later
        expect(await ai.computerOnFor(BRICK, 1, undefined, true)).toBe(true);
        expect(computerState).toHaveBeenCalledTimes(2);
        expect(ai.computerJobsNoteFor(BRICK, 1)).toContain('**YOUR COMPUTER JOBS RIGHT NOW**');
    });

    it('a job that finished since the last message is told as finished with the next one, never as running', async () => {
        const running: ComputerJobsNow = { live: [{ title: 'Airbnb Bangkok search', status: 'running', queuedFor: null, waitingFor: null, control: 'brick', stepDone: 3, stepTotal: null, stepLabel: null, startedAt: Date.now() - 60_000 }], ended: [] };
        const finished: ComputerJobsNow = { live: [], ended: [{ ...airbnb, endedAt: Date.now() - 1_000 }] };
        const computerState = vi.fn().mockResolvedValueOnce({ on: true, retry: null, available: true, jobs: running, read: true }).mockResolvedValueOnce({ on: true, retry: null, available: true, jobs: finished, read: true });
        const ai = service(computerState);
        await ai.computerOnFor(BRICK, 1, undefined, true);
        expect(ai.computerJobsNoteFor(BRICK, 1)).toContain('“Airbnb Bangkok search”: working now');
        await ai.computerOnFor(BRICK, 1, undefined, true);
        const note = ai.computerJobsNoteFor(BRICK, 1);
        expect(note).toContain('Nothing is working, waiting or in line on your computer right now.');
        expect(note).toContain('“Airbnb Bangkok search”: finished just now.');
    });

    it('a read inside the short while, not for a new message, still uses what was read (nothing else changes)', async () => {
        const computerState = vi.fn().mockResolvedValue({ on: true, retry: null, available: true, jobs: onlyFinished, read: true });
        const ai = service(computerState);
        await ai.computerOnFor(BRICK, 1, undefined, true);
        await ai.computerOnFor(BRICK, 1);
        expect(computerState).toHaveBeenCalledTimes(1);
    });

    it('nothing is said when Orbit could not be read, sent no jobs (an older Orbit), or has no computer to give', async () => {
        for (const answer of [
            { on: false, retry: null, available: false, jobs: null, read: false },
            { on: true, retry: null, available: true, jobs: null, read: true },
            { on: false, retry: null, available: false, jobs: null, read: true },
        ]) {
            const ai = service(vi.fn().mockResolvedValue(answer));
            await ai.computerOnFor(BRICK, 1, undefined, true);
            expect(ai.computerJobsNoteFor(BRICK, 1)).toBe('');
        }
    });

    it('a Brick that is not a person’s own is told nothing about a computer', async () => {
        const computerState = vi.fn().mockResolvedValue({ on: true, retry: null, available: true, jobs: onlyFinished, read: true });
        const ai = service(computerState);
        (ai as unknown as { ownBricks: Set<string> }).ownBricks.clear();
        expect(await ai.computerOnFor(BRICK, 1, undefined, true)).toBe(false);
        expect(ai.computerJobsNoteFor(BRICK, 1)).toBe('');
        expect(computerState).not.toHaveBeenCalled();
    });
});

describe('the jobs tool lists what ended lately too', () => {
    const emptyLine = { ok: true, view: { job: null, queued: [], on: true } };
    const run = (endedLately?: () => Promise<EndedJobNow[] | null>) => {
        const controlComputerJobs = vi.fn(async (_bot: string, _user: string, _ask: ComputerControlAsk) => controlAnswerOf(emptyLine));
        return runComputerControlTool(COMPUTER_JOBS_TOOL, {}, { admin: { controlComputerJobs }, botId: BRICK, userId: 'uuid-alice', state: newControlState(), confirmations: new ConfirmationQueue(), inbound: { eventId: '$msg:one' }, ...(endedLately ? { endedLately } : {}) });
    };

    it('nothing live but a finished job: it is listed, and the Brick is told never to say there was no job', async () => {
        const result = await run(async () => [{ ...airbnb, endedAt: Date.now() - 9 * 60_000 }]);
        expect(result.jobs).toEqual([]);
        expect(result.endedLately).toEqual(['“Airbnb Bangkok search”: finished 9 minutes ago. It left no files.']);
        expect(result.note).toContain('never say there was no job');
        expect(result.note).not.toContain('There are no jobs on your computer');
    });

    it('nothing live and nothing ended lately: it says so plainly', async () => {
        const result = await run(async () => []);
        expect(result).not.toHaveProperty('endedLately');
        expect(result.note).toContain('no job ended lately');
    });

    it('a read of the ended jobs that fails never gets in the way of the live list', async () => {
        const result = await run(async () => {
            throw new Error('down');
        });
        expect(result.jobs).toEqual([]);
        expect(result).not.toHaveProperty('endedLately');
        // What ended is not known: it is never said that no job ran
        expect(result.note).toContain('never say that no job ran');
    });
});
