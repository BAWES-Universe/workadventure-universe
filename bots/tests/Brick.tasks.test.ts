/**
 * Goals and tasks, set by asking (game #2002): a person asks their own Brick, in their own chat with it, for a reminder. The tools only
 * run for the owner (Orbit says who that is), turn the person's own clock into the moment Orbit keeps, say plainly what Orbit refused,
 * and set nothing twice. Reminders only: nothing here runs one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn(), request: vi.fn(), isAxiosError: (error: any) => !!error?.isAxiosError },
    isAxiosError: (error: any) => !!error?.isAxiosError,
}));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import { AdminApiService, type BrickItemView } from '../server/AdminApiService';
import { AIService } from '../ai/AIService';
import { describeStep, showsAsStep } from '../ai/ToolSteps';
import { localToInstant, sayMoment, sayNow, timeOfDayOf } from '../ai/BrickTime';
import {
    CHANGE_TASK_TOOL,
    KEEP_WORKDAYS_TOOL,
    MY_TASKS_TOOL,
    SET_REMINDER_TOOL,
    forgetTaskSettings,
    isTaskTool,
    runTaskTool,
    taskSettingsFor,
    taskToolDefinitions,
    taskToolsNote,
    tasksAreOn,
    type TaskToolContext,
} from '../ai/BrickTasks';

const BRICK = '0b7c1d2e-1111-4222-8333-944455556666';
const SARA = 'sara-uuid';
// Thursday 12 Nov 2026, 9:00 in Kuwait (UTC+3)
const NOW = Date.parse('2026-11-12T06:00:00Z');

const item = (over: Partial<BrickItemView> = {}): BrickItemView => ({
    id: 'item-1',
    kind: 'reminder',
    words: 'Pick up the car',
    cadence: { type: 'once', at: '2026-11-15T13:00:00.000Z' },
    timeZone: 'Asia/Kuwait',
    nextDueAt: '2026-11-15T13:00:00.000Z',
    state: 'on',
    setBy: 'you',
    lastRunAt: null,
    ...over,
});

function setUp(over: { settings?: Record<string, unknown>; refused?: { status: number; error: string; code?: string; limit?: number } | null; items?: BrickItemView[] } = {}) {
    const admin = {
        isConfigured: () => true,
        brickItemSettings: vi.fn(async () =>
            over.refused === undefined || over.refused === null
                ? { ok: true as const, timeZone: 'Asia/Kuwait', workdays: [0, 1, 2, 3, 4], limits: { itemsPerPerson: 20, snooze: 60 }, ...over.settings }
                : ({ ok: false as const, ...over.refused })
        ),
        keepBrickWorkdays: vi.fn(async (_b: string, _u: string, days: number[]) => ({ ok: true as const, workdays: days })),
        setBrickItem: vi.fn(async (_b: string, body: Record<string, unknown>) => ({ ok: true as const, item: item({ words: String(body.words), cadence: body.cadence as BrickItemView['cadence'] }) })),
        listBrickItems: vi.fn(async () => ({ ok: true as const, items: over.items ?? [item()] })),
        changeBrickItem: vi.fn(async () => ({ ok: true as const, item: item({ nextDueAt: '2026-11-15T14:00:00.000Z' }) })),
    };
    const context: TaskToolContext = { admin: admin as unknown as TaskToolContext['admin'], botId: BRICK, userId: SARA, now: () => NOW };
    return { admin, context };
}

beforeEach(() => {
    forgetTaskSettings();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('time, on the person’s own clock', () => {
    it('turns "2026-11-15 16:00" on their clock into the moment it means', () => {
        expect(localToInstant('2026-11-15 16:00', 'Asia/Kuwait')).toBe('2026-11-15T13:00:00.000Z');
        expect(localToInstant('2026-11-15T16:00', 'Asia/Kuwait')).toBe('2026-11-15T13:00:00.000Z');
        expect(localToInstant('2026-07-01 09:30', 'America/New_York')).toBe('2026-07-01T13:30:00.000Z');
        expect(localToInstant('2026-12-01 09:30', 'America/New_York')).toBe('2026-12-01T14:30:00.000Z');
    });

    it('reads a time the clock skips as the same moment on the new clock, and a time it repeats as the first one', () => {
        // New York, 8 Mar 2026: 2:00 AM jumps to 3:00 AM
        expect(localToInstant('2026-03-08 01:30', 'America/New_York')).toBe('2026-03-08T06:30:00.000Z');
        expect(localToInstant('2026-03-08 02:30', 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
        expect(localToInstant('2026-03-08 03:30', 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
        // New York, 1 Nov 2026: 2:00 AM goes back to 1:00 AM
        expect(localToInstant('2026-11-01 00:30', 'America/New_York')).toBe('2026-11-01T04:30:00.000Z');
        expect(localToInstant('2026-11-01 01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
        expect(localToInstant('2026-11-01 02:30', 'America/New_York')).toBe('2026-11-01T07:30:00.000Z');
        // London, 29 Mar 2026: 1:00 AM jumps to 2:00 AM
        expect(localToInstant('2026-03-29 01:30', 'Europe/London')).toBe('2026-03-29T01:30:00.000Z');
    });

    it('is nothing for what is not a real date and time, or a zone nobody knows', () => {
        for (const bad of ['tomorrow', '2026-02-31 10:00', '2026-11-15 25:00', '2026-11-15', 12, null]) expect(localToInstant(bad, 'Asia/Kuwait')).toBeNull();
        expect(localToInstant('2026-11-15 16:00', 'Nowhere/Land')).toBeNull();
        expect(timeOfDayOf('2026-11-15 09:05')).toBe('09:05');
        expect(timeOfDayOf('9am')).toBeNull();
    });

    it('says a moment in words on their clock, and today as today', () => {
        expect(sayNow(NOW, 'Asia/Kuwait')).toBe('Thu, Nov 12, 2026, 9:00 AM');
        expect(sayMoment('2026-11-15T13:00:00.000Z', 'Asia/Kuwait', NOW)).toBe('Sun, Nov 15, 4:00 PM');
        expect(sayMoment('2026-11-12T10:00:00.000Z', 'Asia/Kuwait', NOW)).toBe('today, 1:00 PM');
    });
});

describe('who has the reminder tools', () => {
    it('are four tools, with names nothing else answers to', () => {
        expect(taskToolDefinitions().map((tool) => tool.function.name)).toEqual([SET_REMINDER_TOOL, MY_TASKS_TOOL, CHANGE_TASK_TOOL, KEEP_WORKDAYS_TOOL]);
        expect([SET_REMINDER_TOOL, MY_TASKS_TOOL, CHANGE_TASK_TOOL, KEEP_WORKDAYS_TOOL].every(isTaskTool)).toBe(true);
        expect(isTaskTool('make_brick')).toBe(false);
    });

    it('are the owner’s only: Orbit’s "no" gives a Brick none, and its tools then do nothing', async () => {
        const { admin, context } = setUp({ refused: { status: 404, error: 'Brick not found' } });
        expect(await taskSettingsFor(admin as never, BRICK, SARA, NOW)).toBeNull();
        expect(tasksAreOn(BRICK, SARA)).toBe(false);
        const result = await runTaskTool(SET_REMINDER_TOOL, { text: 'x', when: '2026-11-15 16:00' }, context);
        expect(result).toHaveProperty('error');
        expect(admin.setBrickItem).not.toHaveBeenCalled();
    });

    it('are on for the owner, and Orbit is asked once for a few replies in a row, not for every one', async () => {
        const { admin } = setUp();
        expect(await taskSettingsFor(admin as never, BRICK, SARA, NOW)).toMatchObject({ timeZone: 'Asia/Kuwait', workdays: [0, 1, 2, 3, 4] });
        expect(tasksAreOn(BRICK, SARA)).toBe(true);
        await taskSettingsFor(admin as never, BRICK, SARA, NOW + 5_000);
        expect(admin.brickItemSettings).toHaveBeenCalledTimes(1);
        await taskSettingsFor(admin as never, BRICK, SARA, NOW + 60_000);
        expect(admin.brickItemSettings).toHaveBeenCalledTimes(2);
    });

    it('are off, and nothing is kept, when Orbit could not be asked', async () => {
        const { admin } = setUp();
        admin.brickItemSettings.mockRejectedValueOnce(new Error('down'));
        expect(await taskSettingsFor(admin as never, BRICK, SARA, NOW)).toBeNull();
        expect(tasksAreOn(BRICK, SARA)).toBe(false);
        // Asked again the next time, not remembered as "no"
        expect(await taskSettingsFor(admin as never, BRICK, SARA, NOW + 1)).not.toBeNull();
    });

    it('are off with no Orbit set up', async () => {
        expect(await taskSettingsFor({ isConfigured: () => false, brickItemSettings: vi.fn() } as never, BRICK, SARA, NOW)).toBeNull();
        expect(await taskSettingsFor(undefined, BRICK, SARA, NOW)).toBeNull();
    });
});

describe('what the Brick is told', () => {
    it('gives their clock, the rules for setting one, and says it can only set reminders for now', () => {
        const note = taskToolsNote({ timeZone: 'Asia/Kuwait', workdays: [0, 1, 2, 3, 4], limits: { itemsPerPerson: 20, snooze: 60 } }, NOW);
        expect(note).toContain('Thu, Nov 12, 2026, 9:00 AM (Asia/Kuwait)');
        expect(note).toContain('never guess a time they did not give');
        expect(note).toContain('a specific offer you made in your message just before');
        expect(note).toContain('ask you here to change, snooze or stop it');
        expect(note).toContain('only set reminders for now');
        expect(note).toContain('Snooze moves a reminder by 1 hour');
        expect(note).toContain('Their workdays: sun, mon, tue, wed, thu');
    });

    it('keeps a 404 (not the owner) as a no, but not a busy or lapsed Orbit', async () => {
        const busy = { isConfigured: () => true, brickItemSettings: vi.fn(async () => ({ ok: false as const, status: 429, error: 'Slow down' })) };
        expect(await taskSettingsFor(busy as never, 'bot-busy', SARA, NOW)).toBeNull();
        expect(await taskSettingsFor(busy as never, 'bot-busy', SARA, NOW + 1000)).toBeNull();
        expect(busy.brickItemSettings).toHaveBeenCalledTimes(2);
        const notOwner = { isConfigured: () => true, brickItemSettings: vi.fn(async () => ({ ok: false as const, status: 404, error: 'Brick not found' })) };
        expect(await taskSettingsFor(notOwner as never, 'bot-no', SARA, NOW)).toBeNull();
        expect(await taskSettingsFor(notOwner as never, 'bot-no', SARA, NOW + 1000)).toBeNull();
        expect(notOwner.brickItemSettings).toHaveBeenCalledTimes(1);
    });

    it('says to ask once for a time zone and for workdays when none are kept, and never to guess', () => {
        const note = taskToolsNote({ timeZone: null, workdays: null, limits: {} }, NOW);
        expect(note).toContain('No time zone is kept');
        expect(note).toContain('Their workdays are not kept');
        expect(note).toContain('Never guess from where they live');
    });

    it('never points at a page that is not there yet', () => {
        expect(taskToolsNote({ timeZone: 'UTC', workdays: null, limits: {} }, NOW)).not.toMatch(/Goals and tasks|page|screen/i);
    });
});

describe('setting a reminder', () => {
    it('sets a reminder for a time on their clock, for them, on this Brick, as a reminder', async () => {
        const { admin, context } = setUp();
        const result = await runTaskTool(SET_REMINDER_TOOL, { text: 'Pick up the car', when: '2026-11-15 16:00' }, context);
        expect(admin.setBrickItem).toHaveBeenCalledWith(BRICK, {
            userId: SARA,
            kind: 'reminder',
            words: 'Pick up the car',
            cadence: { type: 'once', at: '2026-11-15T13:00:00.000Z' },
            timeZone: 'Asia/Kuwait',
        });
        expect(result).toMatchObject({ set: true, says: 'Pick up the car', comes: 'Sun, Nov 15, 4:00 PM', time_zone: 'Asia/Kuwait' });
        expect(String(result.note)).toContain('naming the time zone');
    });

    it('takes "in 20 minutes" from the clock of this server, not from a time the model worked out', async () => {
        const { admin, context } = setUp();
        await runTaskTool(SET_REMINDER_TOOL, { text: 'Tea', in_minutes: 20 }, context);
        expect(admin.setBrickItem.mock.calls[0][1]).toMatchObject({ cadence: { type: 'once', at: new Date(NOW + 20 * 60_000).toISOString() } });
    });

    it('repeats every day, or on their workdays, at the time of day given', async () => {
        const { admin, context } = setUp();
        await runTaskTool(SET_REMINDER_TOOL, { text: 'Stand up', when: '2026-11-15 09:30', repeat: 'every_day' }, context);
        expect(admin.setBrickItem.mock.calls[0][1]).toMatchObject({ cadence: { type: 'daily', time: '09:30', days: [0, 1, 2, 3, 4, 5, 6] } });
        await runTaskTool(SET_REMINDER_TOOL, { text: 'Stand up', when: '2026-11-15 09:30', repeat: 'workdays' }, context);
        expect(admin.setBrickItem.mock.calls[1][1]).toMatchObject({ cadence: { type: 'daily', time: '09:30', days: [0, 1, 2, 3, 4] } });
    });

    it('sets nothing for "workdays" until they said which days they work, then keeps them when told', async () => {
        const { admin, context } = setUp({ settings: { workdays: null } });
        const result = await runTaskTool(SET_REMINDER_TOOL, { text: 'Stand up', when: '2026-11-15 09:30', repeat: 'workdays' }, context);
        expect(result).toMatchObject({ needs: 'workdays' });
        expect(admin.setBrickItem).not.toHaveBeenCalled();
        const kept = await runTaskTool(KEEP_WORKDAYS_TOOL, { days: ['sun', 'mon', 'tue', 'wed', 'thu'] }, context);
        expect(admin.keepBrickWorkdays).toHaveBeenCalledWith(BRICK, SARA, [0, 1, 2, 3, 4]);
        expect(kept).toMatchObject({ kept: true, workdays: ['sun', 'mon', 'tue', 'wed', 'thu'] });
        expect(await runTaskTool(KEEP_WORKDAYS_TOOL, { days: ['someday'] }, context)).toHaveProperty('error');
    });

    it('never guesses a time: nothing is set with no time, or one that is not written as asked', async () => {
        const { admin, context } = setUp();
        expect(await runTaskTool(SET_REMINDER_TOOL, { text: 'Pick up the car' }, context)).toHaveProperty('error');
        expect(await runTaskTool(SET_REMINDER_TOOL, { text: 'Pick up the car', when: 'tomorrow at 4' }, context)).toHaveProperty('error');
        expect(await runTaskTool(SET_REMINDER_TOOL, { when: '2026-11-15 16:00' }, context)).toHaveProperty('error');
        expect(admin.setBrickItem).not.toHaveBeenCalled();
    });

    it('asks once for a time zone when none is kept, and uses the one they told it', async () => {
        const { admin, context } = setUp({ settings: { timeZone: null } });
        expect(await runTaskTool(SET_REMINDER_TOOL, { text: 'x', when: '2026-11-15 16:00' }, context)).toMatchObject({ needs: 'time_zone' });
        expect(admin.setBrickItem).not.toHaveBeenCalled();
        await runTaskTool(SET_REMINDER_TOOL, { text: 'x', when: '2026-11-15 16:00', time_zone: 'Europe/London' }, context);
        expect(admin.setBrickItem.mock.calls[0][1]).toMatchObject({ timeZone: 'Europe/London', cadence: { type: 'once', at: '2026-11-15T16:00:00.000Z' } });
        // A made-up zone is not used
        const again = await runTaskTool(SET_REMINDER_TOOL, { text: 'x', when: '2026-11-15 16:00', time_zone: 'Nowhere/Land' }, context);
        expect(again).toMatchObject({ needs: 'time_zone' });
    });

    it('says plainly what Orbit refused: too many, in the past, and the rest', async () => {
        const { admin, context } = setUp();
        admin.setBrickItem.mockResolvedValueOnce({ ok: false, status: 422, code: 'too_many', limit: 20, error: 'x' } as never);
        expect(String((await runTaskTool(SET_REMINDER_TOOL, { text: 'x', when: '2026-11-15 16:00' }, context)).error)).toContain('20');
        admin.setBrickItem.mockResolvedValueOnce({ ok: false, status: 422, code: 'past', error: 'x' } as never);
        expect(String((await runTaskTool(SET_REMINDER_TOOL, { text: 'x', when: '2026-11-11 16:00' }, context)).error)).toContain('already passed');
        admin.setBrickItem.mockResolvedValueOnce({ ok: false, status: 409, code: 'off', error: 'x' } as never);
        expect(String((await runTaskTool(SET_REMINDER_TOOL, { text: 'x', when: '2026-11-15 16:00' }, context)).error)).toContain('switched off');
    });

    it('is told plainly, and throws nothing, when Orbit cannot be asked', async () => {
        const { admin, context } = setUp();
        admin.setBrickItem.mockRejectedValueOnce(new Error('down'));
        const result = await runTaskTool(SET_REMINDER_TOOL, { text: 'x', when: '2026-11-15 16:00' }, context);
        expect(String(result.error)).toContain('could not be done just now');
    });

    it('sets one reminder when the model asks for the same one twice', async () => {
        const { admin, context } = setUp();
        const first = await runTaskTool(SET_REMINDER_TOOL, { text: 'Same one', when: '2026-11-15 16:00' }, context);
        const second = await runTaskTool(SET_REMINDER_TOOL, { text: 'Same one', when: '2026-11-15 16:00' }, context);
        expect(admin.setBrickItem).toHaveBeenCalledTimes(1);
        expect(first).toMatchObject({ set: true });
        expect(second).toMatchObject({ set: true, id: 'item-1' });
        expect(String(second.note)).toContain('Do not set it again');
    });

    it('changes only the words when the model also says repeat none', async () => {
        const { admin, context } = setUp();
        const result = await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'change', text: 'New words', repeat: 'none' }, context);
        expect(result).toMatchObject({ changed: true });
        expect(admin.changeBrickItem.mock.calls[0][2]).toEqual({ userId: expect.any(String), action: 'change', change: { words: 'New words' } });
    });

    it('changes only the words when the unused time fields come as null, empty or 0', async () => {
        const { admin, context } = setUp();
        const result = await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'change', text: 'Words only', when: null, in_minutes: 0 }, context);
        expect(result).toMatchObject({ changed: true });
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'change', text: 'Words again', when: '', in_minutes: null }, context);
        expect(admin.changeBrickItem.mock.calls.map((call) => call[2])).toEqual([
            { userId: expect.any(String), action: 'change', change: { words: 'Words only' } },
            { userId: expect.any(String), action: 'change', change: { words: 'Words again' } },
        ]);
    });

    it('changes the time with no time zone kept: in minutes and every day need none, a date and time asks once and takes one', async () => {
        const { admin, context } = setUp({ settings: { timeZone: null } });
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'change', in_minutes: 30 }, context);
        expect(admin.changeBrickItem).toHaveBeenCalledTimes(1);
        const ask = await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'change', when: '2026-11-16 09:00' }, context);
        expect(ask).toMatchObject({ needs: 'time_zone' });
        expect(admin.changeBrickItem).toHaveBeenCalledTimes(1);
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'change', when: '2026-11-16 09:00', time_zone: 'Asia/Kuwait' }, context);
        expect(admin.changeBrickItem.mock.calls[1][2]).toMatchObject({ change: { cadence: { type: 'once', at: '2026-11-16T06:00:00.000Z' } } });
    });

    it('tells a changed date and time on the clock it was read on, even when the item was made on another', async () => {
        const { admin, context } = setUp();
        admin.changeBrickItem.mockResolvedValueOnce({ ok: true as const, item: item({ timeZone: 'America/New_York', nextDueAt: '2026-11-16T06:00:00.000Z' }) });
        const result = await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'change', when: '2026-11-16 09:00' }, context);
        expect(result).toMatchObject({ changed: true, time_zone: 'Asia/Kuwait', next: 'Mon, Nov 16, 9:00 AM' });
    });

    it('makes a repeating reminder one-off when repeat none comes with a new time', async () => {
        const { admin, context } = setUp();
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'change', repeat: 'none', when: '2026-11-16 09:00' }, context);
        expect(admin.changeBrickItem.mock.calls[0][2]).toMatchObject({ change: { cadence: { type: 'once', at: '2026-11-16T06:00:00.000Z' } } });
    });

    it('still asks for the time of day when a change only says it repeats every day', async () => {
        const { admin, context } = setUp();
        const result = await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'change', repeat: 'every_day' }, context);
        expect(admin.changeBrickItem).not.toHaveBeenCalled();
        expect(String(result.error)).toContain('time of day');
    });

    it('sets it again when it was cancelled a moment ago and is asked for again', async () => {
        const { admin, context } = setUp();
        const first = await runTaskTool(SET_REMINDER_TOOL, { text: 'Cancel then again', when: '2026-11-15 17:00' }, context);
        await runTaskTool(CHANGE_TASK_TOOL, { id: first.id, action: 'cancel' }, context);
        const again = await runTaskTool(SET_REMINDER_TOOL, { text: 'Cancel then again', when: '2026-11-15 17:00' }, context);
        expect(admin.setBrickItem).toHaveBeenCalledTimes(2);
        expect(String(again.note)).not.toContain('Do not set it again');
    });

    it('does not take two different times for one reminder because both came with an unusable "in 0 minutes"', async () => {
        const { admin, context } = setUp();
        await runTaskTool(SET_REMINDER_TOOL, { text: 'Zero wait', in_minutes: 0, when: '2026-11-15 10:00' }, context);
        await runTaskTool(SET_REMINDER_TOOL, { text: 'Zero wait', in_minutes: 0, when: '2026-11-15 11:00' }, context);
        expect(admin.setBrickItem).toHaveBeenCalledTimes(2);
    });

    it('sets one reminder when "in 20 minutes" is asked twice a few seconds apart', async () => {
        const { admin, context } = setUp();
        let clock = NOW;
        context.now = () => clock;
        await runTaskTool(SET_REMINDER_TOOL, { text: 'Stretch', in_minutes: 20 }, context);
        clock += 1_700;
        const second = await runTaskTool(SET_REMINDER_TOOL, { text: 'Stretch', in_minutes: 20 }, context);
        expect(admin.setBrickItem).toHaveBeenCalledTimes(1);
        expect(String(second.note)).toContain('Do not set it again');
    });
});

describe('seeing and changing what is kept', () => {
    it('lists what they asked it to keep, in words on their clock, with when it last went off', async () => {
        const { context } = setUp({ items: [item({ state: 'done', lastRunAt: '2026-11-12T05:00:00.000Z', nextDueAt: null }), item({ id: 'item-2', state: 'deleted' })] });
        const result = await runTaskTool(MY_TASKS_TOOL, {}, context);
        expect(result.items).toEqual([expect.objectContaining({ id: 'item-1', says: 'Pick up the car', state: 'done', went_off: 'today, 8:00 AM' })]);
    });

    it('says there is nothing when there is nothing', async () => {
        const { context } = setUp({ items: [] });
        expect(await runTaskTool(MY_TASKS_TOOL, {}, context)).toMatchObject({ items: [] });
    });

    it('snoozes, pauses, resumes and cancels one, and says when it comes next', async () => {
        const { admin, context } = setUp();
        expect(await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'snooze' }, context)).toMatchObject({ snoozed: true, next: 'Sun, Nov 15, 5:00 PM' });
        expect(admin.changeBrickItem).toHaveBeenLastCalledWith(BRICK, 'item-1', { userId: SARA, action: 'snooze' });
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'pause' }, context);
        expect(admin.changeBrickItem).toHaveBeenLastCalledWith(BRICK, 'item-1', { userId: SARA, action: 'pause' });
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'resume' }, context);
        expect(admin.changeBrickItem).toHaveBeenLastCalledWith(BRICK, 'item-1', { userId: SARA, action: 'resume' });
        expect(await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'cancel' }, context)).toMatchObject({ cancelled: true });
        expect(admin.changeBrickItem).toHaveBeenLastCalledWith(BRICK, 'item-1', { userId: SARA, action: 'delete' });
    });

    it('changes its words or its time, on their clock', async () => {
        const { admin, context } = setUp();
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'change', text: 'Pick up the car and the keys', when: '2026-11-15 17:00' }, context);
        expect(admin.changeBrickItem).toHaveBeenLastCalledWith(BRICK, 'item-1', {
            userId: SARA,
            action: 'change',
            change: { words: 'Pick up the car and the keys', cadence: { type: 'once', at: '2026-11-15T14:00:00.000Z' } },
        });
        expect(await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'change' }, context)).toHaveProperty('error');
        expect(await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'explode' }, context)).toHaveProperty('error');
        expect(await runTaskTool(CHANGE_TASK_TOOL, { action: 'snooze' }, context)).toHaveProperty('error');
    });

    it('is told plainly when it is not theirs, or cannot be done to it now', async () => {
        const { admin, context } = setUp();
        admin.changeBrickItem.mockResolvedValueOnce({ ok: false, status: 404, error: 'Not found' } as never);
        expect(String((await runTaskTool(CHANGE_TASK_TOOL, { id: 'nope', action: 'pause' }, context)).error)).toContain('not one of theirs');
        admin.changeBrickItem.mockResolvedValueOnce({ ok: false, status: 409, code: 'wrong_state', error: 'Only a reminder can be snoozed' } as never);
        expect(String((await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'snooze' }, context)).error)).toContain('cannot be done');
    });
});

describe('what the bot server asks Orbit', () => {
    const request = axios.request as unknown as ReturnType<typeof vi.fn>;
    let service: AdminApiService;
    beforeEach(() => {
        request.mockReset();
        vi.stubEnv('BOT_SERVICE_TOKEN', 'service-token');
        service = new AdminApiService('http://orbit.test', 'admin-token');
    });
    afterEach(() => vi.unstubAllEnvs());

    it('sets, lists and changes through the Brick that asks, for the person who asked, with the service token', async () => {
        request.mockResolvedValueOnce({ data: { item: item() } });
        expect(await service.setBrickItem(BRICK, { userId: SARA, kind: 'reminder', words: 'x', cadence: { type: 'once', at: 'z' } })).toMatchObject({ ok: true, item: { id: 'item-1' } });
        expect(request.mock.calls[0][0]).toMatchObject({ method: 'post', url: `http://orbit.test/api/bots/${BRICK}/brick-items`, headers: { Authorization: 'Bearer service-token' } });
        request.mockResolvedValueOnce({ data: { items: [item()] } });
        await service.listBrickItems(BRICK, SARA);
        expect(request.mock.calls[1][0]).toMatchObject({ method: 'get', params: { userId: SARA } });
        request.mockResolvedValueOnce({ data: { item: item() } });
        await service.changeBrickItem(BRICK, 'item-1', { userId: SARA, action: 'snooze' });
        expect(request.mock.calls[2][0]).toMatchObject({ method: 'patch', url: `http://orbit.test/api/bots/${BRICK}/brick-items/item-1` });
    });

    it('hands back Orbit’s own refusal, with its code and limit, and throws only when Orbit cannot answer', async () => {
        request.mockRejectedValueOnce({ isAxiosError: true, response: { status: 422, data: { error: 'No', code: 'too_many', limit: 20 } } });
        expect(await service.setBrickItem(BRICK, {})).toEqual({ ok: false, status: 422, error: 'No', code: 'too_many', limit: 20 });
        request.mockRejectedValueOnce({ isAxiosError: true, response: { status: 404, data: { error: 'Brick not found' } } });
        expect(await service.brickItemSettings(BRICK, SARA)).toMatchObject({ ok: false, status: 404 });
        request.mockRejectedValueOnce({ isAxiosError: true, response: { status: 500, data: {} } });
        await expect(service.listBrickItems(BRICK, SARA)).rejects.toBeTruthy();
        request.mockRejectedValueOnce(new Error('ECONNRESET'));
        await expect(service.listBrickItems(BRICK, SARA)).rejects.toThrow('ECONNRESET');
    });
});

describe('who gets them in a reply', () => {
    function ai(memory: { userUuid?: string } | undefined, admin: unknown) {
        const service = Object.create(AIService.prototype) as AIService;
        Object.assign(service, { ownBricks: new Set<string>(), helperBricks: new Set<string>(), adminApiService: admin, conversationMemory: { getMemory: () => memory } });
        return service as unknown as {
            noteBrick: AIService['noteBrick'];
            taskSettingsOf(botId: string, playerId: number, botClient?: unknown, admin?: unknown): Promise<unknown>;
            taskToolsOn(botId?: string, playerId?: number, botClient?: unknown): boolean;
        };
    }

    it('only in a direct message with a Brick: not a room bot, not on the map', async () => {
        const { admin } = setUp();
        const service = ai({ userUuid: SARA }, admin);
        expect(await service.taskSettingsOf(BRICK, 1)).toBeNull();
        service.noteBrick(BRICK, { isDefault: false });
        expect(await service.taskSettingsOf(BRICK, 1, {})).toBeNull();
        expect(await service.taskSettingsOf(BRICK, 1)).toMatchObject({ timeZone: 'Asia/Kuwait' });
        expect(service.taskToolsOn(BRICK, 1)).toBe(true);
        expect(service.taskToolsOn(BRICK, 1, {})).toBe(false);
    });

    it('not for a Brick that was deleted, nor when the person is not known yet', async () => {
        const { admin } = setUp();
        const deleted = ai({ userUuid: SARA }, admin);
        deleted.noteBrick(BRICK, { isDefault: true, deleted: true });
        expect(await deleted.taskSettingsOf(BRICK, 1)).toBeNull();
        const unknown = ai(undefined, admin);
        unknown.noteBrick(BRICK, { isDefault: true });
        expect(await unknown.taskSettingsOf(BRICK, 1)).toBeNull();
        expect(unknown.taskToolsOn(BRICK, 1)).toBe(false);
    });

    it('not for anyone Orbit says is not the owner: a visitor to the Brick gets none', async () => {
        const { admin } = setUp({ refused: { status: 404, error: 'Brick not found' } });
        const visit = ai({ userUuid: 'omar-uuid' }, admin);
        visit.noteBrick(BRICK, { isDefault: true });
        expect(await visit.taskSettingsOf(BRICK, 1)).toBeNull();
        expect(visit.taskToolsOn(BRICK, 1)).toBe(false);
    });
});

describe('what the chat shows for them', () => {
    it('shows a reminder being set, and one being snoozed or stopped, as a step; reading is never one', () => {
        expect(showsAsStep(SET_REMINDER_TOOL, false)).toBe(true);
        expect(showsAsStep(CHANGE_TASK_TOOL, false)).toBe(true);
        expect(showsAsStep(MY_TASKS_TOOL, false)).toBe(false);
        expect(describeStep({ id: '1', name: SET_REMINDER_TOOL, arguments: { text: 'Pick up the car' } })).toMatchObject({ done: 'Set a reminder', detail: 'Pick up the car' });
        expect(describeStep({ id: '2', name: CHANGE_TASK_TOOL, arguments: { action: 'snooze' } })).toMatchObject({ done: 'Snoozed a reminder' });
        expect(describeStep({ id: '3', name: CHANGE_TASK_TOOL, arguments: { action: 'cancel' } })).toMatchObject({ done: 'Stopped a reminder' });
    });
});
