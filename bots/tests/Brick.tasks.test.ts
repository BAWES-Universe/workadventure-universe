/**
 * Goals and tasks, set by asking (game #2002): a person asks their own Brick, in their own chat with it, for a reminder, a briefing, a
 * watch or a goal. The tools only run for the owner (Orbit says who that is), turn the person's own clock into the moment Orbit keeps,
 * say plainly what Orbit refused, and set nothing twice. Nothing here runs one.
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
import { MCPConnector } from '../mcp/MCPConnector';
import { openToolGate } from './helpers/openToolGate';
import { describeStep, showsAsStep } from '../ai/ToolSteps';
import { localToInstant, sayMoment, sayNow, timeOfDayOf } from '../ai/BrickTime';
import {
    CHANGE_TASK_TOOL,
    KEEP_WORKDAYS_TOOL,
    MY_TASKS_TOOL,
    SET_BRIEFING_TOOL,
    SET_GOAL_TOOL,
    SET_REMINDER_TOOL,
    SET_WATCH_TOOL,
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
        setBrickItem: vi.fn(async (_b: string, body: Record<string, unknown>) => ({
            ok: true as const,
            item: item({
                kind: (body.kind as BrickItemView['kind']) ?? 'reminder',
                words: String(body.words),
                condition: (body.condition as string | undefined) ?? null,
                outcome: (body.outcome as string | undefined) ?? null,
                cadence: body.cadence as BrickItemView['cadence'],
            }),
        })),
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
    it('are seven tools, with names nothing else answers to', () => {
        const names = [SET_REMINDER_TOOL, SET_BRIEFING_TOOL, SET_WATCH_TOOL, SET_GOAL_TOOL, MY_TASKS_TOOL, CHANGE_TASK_TOOL, KEEP_WORKDAYS_TOOL];
        expect(taskToolDefinitions().map((tool) => tool.function.name)).toEqual(names);
        expect(names.every(isTaskTool)).toBe(true);
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
    it('gives their clock, the rules for setting one, and the four kinds it can keep', () => {
        const note = taskToolsNote({ timeZone: 'Asia/Kuwait', workdays: [0, 1, 2, 3, 4], limits: { itemsPerPerson: 20, snooze: 60 } }, NOW);
        expect(note).toContain('Thu, Nov 12, 2026, 9:00 AM (Asia/Kuwait)');
        expect(note).toContain('never guess a time they did not give');
        expect(note).toContain('a specific offer you made in your message just before');
        expect(note).toContain('ask you here to change, snooze or stop it');
        expect(note).toContain('set_briefing');
        expect(note).toContain('set_watch');
        expect(note).toContain('set_goal');
        expect(note).toContain('offer one specific schedule in your message and set it only when they say yes');
        expect(note).not.toContain('only set reminders');
        expect(note).not.toContain('cannot do that yet');
        expect(note).toContain('Snooze moves a reminder by 1 hour');
        expect(note).toContain('Their workdays: sun, mon, tue, wed, thu');
    });

    it('keeps the owner’s tools through a reply when Orbit is busy after the answer is no longer kept, and says so plainly', async () => {
        const { admin, context } = setUp();
        expect(await taskSettingsFor(admin as never, BRICK, SARA, NOW)).not.toBeNull();
        admin.brickItemSettings.mockRejectedValueOnce(new Error('timeout'));
        // The reply took longer than the answer is kept; Orbit stumbles on the next tool call of the same reply
        const result = await runTaskTool(MY_TASKS_TOOL, {}, { ...context, now: () => NOW + 60_000 });
        expect(result).toHaveProperty('error');
        expect(String(result.error)).not.toContain('Only the owner');
        expect(tasksAreOn(BRICK, SARA)).toBe(true);
        expect(await taskSettingsFor(admin as never, BRICK, SARA, NOW + 61_000)).not.toBeNull();
    });

    it('lets go of the owners that went quiet longest ago, so the list cannot grow without end', async () => {
        const { admin } = setUp();
        for (let i = 0; i < 502; i++) await taskSettingsFor(admin as never, `bot-${i}`, SARA, NOW);
        expect(tasksAreOn('bot-0', SARA)).toBe(false);
        expect(tasksAreOn('bot-501', SARA)).toBe(true);
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

    it('points at the Goals and tasks page by its link, the one the game opens in place', () => {
        const note = taskToolsNote({ timeZone: 'UTC', workdays: null, limits: {} }, NOW);
        expect(note).toContain('[Goals and tasks](#goals)');
        expect(note).not.toMatch(/screen/i);
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

    it('makes one reminder when two identical calls of one reply run together', async () => {
        const { admin, context } = setUp();
        const args = { text: 'Together', when: '2026-11-15 16:00' };
        const [first, second] = await Promise.all([runTaskTool(SET_REMINDER_TOOL, args, context), runTaskTool(SET_REMINDER_TOOL, args, context)]);
        expect(admin.setBrickItem).toHaveBeenCalledTimes(1);
        expect(first).toMatchObject({ set: true });
        expect(second).toMatchObject({ set: true, id: first.id });
        expect(String(second.note)).toContain('Do not set it again');
    });

    it('does not say a reminder was made when the call that made it was refused', async () => {
        const { admin, context } = setUp();
        admin.setBrickItem.mockImplementationOnce(async () => ({ ok: false as const, status: 400, error: 'No' }) as never);
        const args = { text: 'Refused', when: '2026-11-15 16:00' };
        const [first, second] = await Promise.all([runTaskTool(SET_REMINDER_TOOL, args, context), runTaskTool(SET_REMINDER_TOOL, args, context)]);
        expect(first).toHaveProperty('error');
        expect(second).toHaveProperty('error');
        expect(admin.setBrickItem).toHaveBeenCalledTimes(1);
    });

    it('treats a daily reminder read on two different clocks as two reminders when none is kept', async () => {
        const { admin, context } = setUp({ settings: { timeZone: null } });
        const args = { text: 'Daily', repeat: 'every_day', when: '2026-11-15 09:00' };
        await runTaskTool(SET_REMINDER_TOOL, { ...args, time_zone: 'Asia/Kuwait' }, context);
        await runTaskTool(SET_REMINDER_TOOL, { ...args, time_zone: 'Europe/London' }, context);
        expect(admin.setBrickItem).toHaveBeenCalledTimes(2);
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

describe('setting a briefing, a watch or a goal', () => {
    it('sets a briefing for a time of day on their clock, every day or on their workdays, as a schedule', async () => {
        const { admin, context } = setUp();
        const result = await runTaskTool(SET_BRIEFING_TOOL, { text: 'my day and the weather', repeat: 'workdays', when: '2026-11-15 07:30' }, context);
        expect(admin.setBrickItem).toHaveBeenCalledWith(BRICK, {
            userId: SARA,
            kind: 'schedule',
            words: 'my day and the weather',
            cadence: { type: 'daily', time: '07:30', days: [0, 1, 2, 3, 4] },
            timeZone: 'Asia/Kuwait',
        });
        expect(result).toMatchObject({ set: true, kind: 'schedule', says: 'my day and the weather', time_zone: 'Asia/Kuwait' });
        expect(String(result.note)).toContain('also when there is nothing');
        await runTaskTool(SET_BRIEFING_TOOL, { text: 'my day', repeat: 'every_day', when: '2026-11-15 06:00' }, context);
        expect(admin.setBrickItem.mock.calls[1][1]).toMatchObject({ cadence: { type: 'daily', time: '06:00', days: [0, 1, 2, 3, 4, 5, 6] } });
    });

    it('never guesses a briefing: no time, no repeat or a check every few hours sets nothing, and it is not made a reminder', async () => {
        const { admin, context } = setUp();
        expect(await runTaskTool(SET_BRIEFING_TOOL, { text: 'my day', repeat: 'every_day' }, context)).toHaveProperty('error');
        expect(await runTaskTool(SET_BRIEFING_TOOL, { text: 'my day', when: '2026-11-15 07:30' }, context)).toHaveProperty('error');
        expect(await runTaskTool(SET_BRIEFING_TOOL, { text: 'my day', repeat: 'every_hours', hours: 4 }, context)).toHaveProperty('error');
        expect(await runTaskTool(SET_BRIEFING_TOOL, { repeat: 'every_day', when: '2026-11-15 07:30' }, context)).toHaveProperty('error');
        expect(admin.setBrickItem).not.toHaveBeenCalled();
    });

    it('sets a watch with the condition it speaks for, checking at a time of day or every few hours', async () => {
        const { admin, context } = setUp();
        const result = await runTaskTool(SET_WATCH_TOOL, { text: 'the flight to London', speak_when: 'the price drops under KWD 90', repeat: 'every_hours', hours: 6 }, context);
        expect(admin.setBrickItem).toHaveBeenCalledWith(BRICK, {
            userId: SARA,
            kind: 'watch',
            words: 'the flight to London',
            condition: 'the price drops under KWD 90',
            cadence: { type: 'every', minutes: 360 },
            timeZone: 'Asia/Kuwait',
        });
        expect(result).toMatchObject({ set: true, kind: 'watch', speaks_when: 'the price drops under KWD 90', repeats: 'every 6 hours' });
        expect(String(result.note)).toContain('speak only when the condition is met');
        await runTaskTool(SET_WATCH_TOOL, { text: 'the flight', speak_when: 'it drops', repeat: 'every_day', when: '2026-11-15 09:00' }, context);
        expect(admin.setBrickItem.mock.calls[1][1]).toMatchObject({ cadence: { type: 'daily', time: '09:00', days: [0, 1, 2, 3, 4, 5, 6] } });
    });

    it('sets no watch without its condition or a schedule, and none for hours that are not a wait', async () => {
        const { admin, context } = setUp();
        expect(await runTaskTool(SET_WATCH_TOOL, { text: 'the flight', repeat: 'every_day', when: '2026-11-15 09:00' }, context)).toHaveProperty('error');
        expect(await runTaskTool(SET_WATCH_TOOL, { text: 'the flight', speak_when: 'it drops' }, context)).toHaveProperty('error');
        expect(await runTaskTool(SET_WATCH_TOOL, { text: 'the flight', speak_when: 'it drops', repeat: 'every_hours' }, context)).toHaveProperty('error');
        expect(await runTaskTool(SET_WATCH_TOOL, { text: 'the flight', speak_when: 'it drops', repeat: 'every_hours', hours: 0 }, context)).toHaveProperty('error');
        expect(await runTaskTool(SET_WATCH_TOOL, { text: 'the flight', speak_when: 'it drops', repeat: 'every_hours', hours: 100000 }, context)).toHaveProperty('error');
        expect(admin.setBrickItem).not.toHaveBeenCalled();
    });

    it('sets a goal with the outcome that counts as reached, and its check schedule', async () => {
        const { admin, context } = setUp();
        const result = await runTaskTool(SET_GOAL_TOOL, { text: 'get my visa sorted before my trip', outcome: 'the visa is issued', repeat: 'every_day', when: '2026-11-15 09:00' }, context);
        expect(admin.setBrickItem).toHaveBeenCalledWith(BRICK, {
            userId: SARA,
            kind: 'goal',
            words: 'get my visa sorted before my trip',
            outcome: 'the visa is issued',
            cadence: { type: 'daily', time: '09:00', days: [0, 1, 2, 3, 4, 5, 6] },
            timeZone: 'Asia/Kuwait',
        });
        expect(result).toMatchObject({ set: true, kind: 'goal', done_when: 'the visa is issued' });
        expect(String(result.note)).toContain('what counts as done');
    });

    it('sets no goal without the outcome, or with no check schedule: the schedule is offered and said yes to first', async () => {
        const { admin, context } = setUp();
        expect(await runTaskTool(SET_GOAL_TOOL, { text: 'my visa', repeat: 'every_day', when: '2026-11-15 09:00' }, context)).toHaveProperty('error');
        expect(await runTaskTool(SET_GOAL_TOOL, { text: 'my visa', outcome: 'issued' }, context)).toHaveProperty('error');
        expect(await runTaskTool(SET_GOAL_TOOL, { text: 'my visa', outcome: 'issued', repeat: 'every_day' }, context)).toHaveProperty('error');
        expect(admin.setBrickItem).not.toHaveBeenCalled();
    });

    it('keeps the reminder tool to a reminder: checking every few hours is a watch or a goal', async () => {
        const { admin, context } = setUp();
        expect(await runTaskTool(SET_REMINDER_TOOL, { text: 'x', repeat: 'every_hours', hours: 2 }, context)).toHaveProperty('error');
        expect(admin.setBrickItem).not.toHaveBeenCalled();
    });

    it('asks once for a time zone when none is kept, for each of them, and for workdays when none are kept', async () => {
        const { admin, context } = setUp({ settings: { timeZone: null, workdays: null } });
        expect(await runTaskTool(SET_BRIEFING_TOOL, { text: 'my day', repeat: 'every_day', when: '2026-11-15 07:30' }, context)).toMatchObject({ needs: 'time_zone' });
        expect(await runTaskTool(SET_WATCH_TOOL, { text: 'x', speak_when: 'y', repeat: 'every_hours', hours: 3 }, context)).toMatchObject({ needs: 'time_zone' });
        expect(await runTaskTool(SET_GOAL_TOOL, { text: 'x', outcome: 'y', repeat: 'every_day', when: '2026-11-15 09:00' }, context)).toMatchObject({ needs: 'time_zone' });
        expect(admin.setBrickItem).not.toHaveBeenCalled();
        expect(await runTaskTool(SET_BRIEFING_TOOL, { text: 'my day', repeat: 'workdays', when: '2026-11-15 07:30', time_zone: 'Asia/Kuwait' }, context)).toMatchObject({ needs: 'workdays' });
        expect(admin.setBrickItem).not.toHaveBeenCalled();
    });

    it('says plainly what Orbit refused: too many, too often, switched off', async () => {
        const { admin, context } = setUp();
        const refuse = (code: string, limit?: number) => admin.setBrickItem.mockResolvedValueOnce({ ok: false as const, status: 422, error: 'no', code, limit } as never);
        refuse('too_many', 20);
        expect(await runTaskTool(SET_GOAL_TOOL, { text: 'x', outcome: 'y', repeat: 'every_day', when: '2026-11-15 09:00' }, context)).toMatchObject({ error: expect.stringContaining('20 goals and tasks') });
        refuse('too_often', 60);
        expect(await runTaskTool(SET_WATCH_TOOL, { text: 'x', speak_when: 'y', repeat: 'every_hours', hours: 1 }, context)).toMatchObject({ error: expect.stringContaining('every 60 minutes') });
        refuse('off');
        expect(await runTaskTool(SET_BRIEFING_TOOL, { text: 'x', repeat: 'every_day', when: '2026-11-15 09:00' }, context)).toMatchObject({ error: expect.stringContaining('switched off') });
    });

    it('sets one when the model asks for the same one twice, or twice at once, and two different kinds with the same words are two', async () => {
        const { admin, context } = setUp();
        const ask = { text: 'the flight', speak_when: 'it drops', repeat: 'every_hours', hours: 6 };
        const [first, second] = await Promise.all([runTaskTool(SET_WATCH_TOOL, ask, context), runTaskTool(SET_WATCH_TOOL, ask, context)]);
        expect(admin.setBrickItem).toHaveBeenCalledTimes(1);
        expect(first).toMatchObject({ set: true });
        expect(second).toMatchObject({ set: true, note: expect.stringContaining('Already set') });
        await runTaskTool(SET_WATCH_TOOL, ask, context);
        expect(admin.setBrickItem).toHaveBeenCalledTimes(1);
        await runTaskTool(SET_GOAL_TOOL, { text: 'the flight', outcome: 'it drops', repeat: 'every_hours', hours: 6 }, context);
        expect(admin.setBrickItem).toHaveBeenCalledTimes(2);
        // Another condition is another watch
        await runTaskTool(SET_WATCH_TOOL, { ...ask, speak_when: 'it is gone' }, context);
        expect(admin.setBrickItem).toHaveBeenCalledTimes(3);
    });

    it('never takes two different asks for one because their words hold the same separator', async () => {
        const { admin, context } = setUp();
        const base = { repeat: 'every_hours', hours: 6 };
        await runTaskTool(SET_WATCH_TOOL, { ...base, text: 'flight|price', speak_when: 'below 90' }, context);
        await runTaskTool(SET_WATCH_TOOL, { ...base, text: 'flight', speak_when: 'price|below 90' }, context);
        expect(admin.setBrickItem).toHaveBeenCalledTimes(2);
        expect(admin.setBrickItem.mock.calls[1][1]).toMatchObject({ words: 'flight', condition: 'price|below 90' });
    });

    it('shows what a watch speaks for and what a goal is done when, and says "every 6 hours", in what it keeps', async () => {
        const { context } = setUp({
            items: [
                item({ id: 'w', kind: 'watch', words: 'the flight', condition: 'it drops under KWD 90', cadence: { type: 'every', minutes: 360 }, nextDueAt: '2026-11-12T12:00:00.000Z' }),
                item({ id: 'g', kind: 'goal', words: 'my visa', outcome: 'the visa is issued', cadence: { type: 'daily', time: '09:00', days: [0, 1, 2, 3, 4, 5, 6] }, nextDueAt: '2026-11-13T06:00:00.000Z' }),
            ],
        });
        const { items } = (await runTaskTool(MY_TASKS_TOOL, {}, context)) as { items: Record<string, unknown>[] };
        expect(items[0]).toMatchObject({ kind: 'watch', speaks_when: 'it drops under KWD 90', repeats: 'every 6 hours' });
        expect(items[1]).toMatchObject({ kind: 'goal', done_when: 'the visa is issued', repeats: 'every day' });
    });

    it('changes a watch’s condition, a goal’s outcome and how often it checks', async () => {
        const { admin, context } = setUp();
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'w', action: 'change', speak_when: 'it drops under KWD 80' }, context);
        expect(admin.changeBrickItem).toHaveBeenLastCalledWith(BRICK, 'w', { userId: SARA, action: 'change', change: { condition: 'it drops under KWD 80' } });
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'g', action: 'change', outcome: 'the visa is in my passport' }, context);
        expect(admin.changeBrickItem).toHaveBeenLastCalledWith(BRICK, 'g', { userId: SARA, action: 'change', change: { outcome: 'the visa is in my passport' } });
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'w', action: 'change', repeat: 'every_hours', hours: 12 }, context);
        expect(admin.changeBrickItem).toHaveBeenLastCalledWith(BRICK, 'w', { userId: SARA, action: 'change', change: { cadence: { type: 'every', minutes: 720 } } });
    });

    it('is the owner’s only: Orbit’s "no" sets none of them', async () => {
        const { admin, context } = setUp({ refused: { status: 404, error: 'Brick not found' } });
        for (const [name, args] of [
            [SET_BRIEFING_TOOL, { text: 'x', repeat: 'every_day', when: '2026-11-15 07:30' }],
            [SET_WATCH_TOOL, { text: 'x', speak_when: 'y', repeat: 'every_hours', hours: 3 }],
            [SET_GOAL_TOOL, { text: 'x', outcome: 'y', repeat: 'every_hours', hours: 3 }],
        ] as const) {
            expect(await runTaskTool(name, args, context)).toHaveProperty('error');
        }
        expect(admin.setBrickItem).not.toHaveBeenCalled();
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

    it('an extra run leaves what was just set as it was: a repeated "set it" is still the one item, while a change makes it a new ask', async () => {
        const { admin, context } = setUp();
        const asked = { text: 'Pick up the car', when: '2026-11-15 16:00' };
        const first = await runTaskTool(SET_REMINDER_TOOL, asked, context);
        const id = String(first.id);
        await runTaskTool(CHANGE_TASK_TOOL, { id, action: 'run_now' }, context);
        const again = await runTaskTool(SET_REMINDER_TOOL, asked, context);
        expect(again).toMatchObject({ set: true });
        expect(String(again.note)).toContain('Already set a moment ago');
        expect(admin.setBrickItem).toHaveBeenCalledTimes(1);
        // A change to it is a different thing: a repeat of the first ask is made again
        await runTaskTool(CHANGE_TASK_TOOL, { id, action: 'cancel' }, context);
        await runTaskTool(SET_REMINDER_TOOL, asked, context);
        expect(admin.setBrickItem).toHaveBeenCalledTimes(2);
    });

    it('a retried run_now after an answer that never came carries the same key, so Orbit starts one run; a later, deliberate one is a new ask', async () => {
        const { admin, context } = setUp();
        const keys = () => admin.changeBrickItem.mock.calls.map((call) => (call as unknown as [string, string, { key?: string }])[2].key);
        // The first ask times out: nothing came back, though Orbit may have started the run
        admin.changeBrickItem.mockRejectedValueOnce(new Error('timeout of 10000ms exceeded'));
        const failed = await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'run_now' }, context);
        expect(String(failed.error)).toContain('could not be done');
        // The retry is the same ask: the same key
        expect(await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'run_now' }, context)).toMatchObject({ started: true });
        const [first, retry] = keys();
        expect(first).toEqual(expect.any(String));
        expect(retry).toBe(first);
        // Orbit has answered it: asking again on purpose is a new ask with a new key
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'run_now' }, context);
        expect(keys()[2]).toEqual(expect.any(String));
        expect(keys()[2]).not.toBe(first);
        // A refusal is an answer too: the ask after it is new
        admin.changeBrickItem.mockResolvedValueOnce({ ok: false, status: 409, code: 'busy', error: 'no' } as never);
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'run_now' }, context);
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'run_now' }, context);
        expect(keys()[4]).not.toBe(keys()[3]);
        // Only a run carries a key
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'snooze' }, context);
        expect(keys()[5]).toBeUndefined();
    });

    it('a retry that finds the run its lost first try already made says what became of it, and is not told as started now', async () => {
        const { admin, context } = setUp();
        const found = (state: string) =>
            ({ ok: true, item: item({ nextDueAt: '2026-11-15T14:00:00.000Z' }), run: { runId: 'r1', state, replay: true } }) as never;
        admin.changeBrickItem.mockRejectedValueOnce(new Error('timeout of 10000ms exceeded'));
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'run_now' }, context);
        // The first try had run and finished: the retry is told so, not "started"
        admin.changeBrickItem.mockResolvedValueOnce(found('done'));
        const again = await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'run_now' }, context);
        expect(again).toMatchObject({ started: false, already: 'done' });
        expect(String(again.note)).toContain('nothing new was started');
        // One that is still running or waiting is "running now", as it is said for any run
        admin.changeBrickItem.mockRejectedValueOnce(new Error('timeout'));
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'run_now' }, context);
        admin.changeBrickItem.mockResolvedValueOnce(found('claimed'));
        expect(await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'run_now' }, context)).toMatchObject({ started: true });
        // And the ask after an answer is new: it carries a new key
        const keys = admin.changeBrickItem.mock.calls.map((call) => (call as unknown as [string, string, { key?: string }])[2].key);
        expect(keys[2]).not.toBe(keys[0]);
        // A dropped one never ran
        admin.changeBrickItem.mockRejectedValueOnce(new Error('timeout'));
        await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'run_now' }, context);
        admin.changeBrickItem.mockResolvedValueOnce(found('dropped'));
        const dropped = await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'run_now' }, context);
        expect(dropped).toMatchObject({ started: false, already: 'dropped' });
        expect(String(dropped.note)).toContain('did not run');
    });

    it('runs one now when they ask: an extra run, nothing else about it is said to move, and the reasons it would not run are said plainly', async () => {
        const { admin, context } = setUp();
        const answer = await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'run_now' }, context);
        expect(admin.changeBrickItem).toHaveBeenLastCalledWith(BRICK, 'item-1', { userId: SARA, action: 'run', key: expect.any(String) });
        expect(answer).toMatchObject({ started: true, id: 'item-1' });
        expect(String(answer.note)).toContain('Its own schedule is as it was');
        for (const [code, words] of [
            ['busy', 'running right now'],
            ['no_room', 'usage for goals and tasks is used up'],
            ['runs_a_day', 'most runs for today'],
            ['needs_setup', 'not turned on yet'],
            ['needs_goal', 'goal that is paused'],
        ] as const) {
            admin.changeBrickItem.mockResolvedValueOnce({ ok: false, status: 409, code, error: 'no' } as never);
            expect(String((await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'run_now' }, context)).error)).toContain(words);
        }
        // A snoozed run is said as that run only: the schedule carries on at its own time after it
        admin.changeBrickItem.mockResolvedValueOnce({
            ok: true,
            item: { ...item(), cadence: { type: 'every', minutes: 60 }, nextDueAt: '2026-11-15T13:10:00.000Z', snoozedUntil: '2026-11-15T13:10:00.000Z', nextRegularAt: '2026-11-15T14:00:00.000Z' },
        } as never);
        expect(await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'snooze' }, context)).toMatchObject({ snoozed: true, then_regular: expect.any(String) });
    });

    it('says "then the regular one" only for a repeating item whose regular time is after the snoozed run, as the line on the screen does', async () => {
        const snoozed = { nextDueAt: '2026-11-15T13:10:00.000Z', snoozedUntil: '2026-11-15T13:10:00.000Z' };
        const repeating = { cadence: { type: 'every', minutes: 60 } } as const;
        const { context } = setUp({
            items: [
                item({ id: 'ok', ...repeating, ...snoozed, nextRegularAt: '2026-11-15T14:00:00.000Z' }),
                item({ id: 'once', cadence: { type: 'once', at: '2026-11-15T13:10:00.000Z' }, ...snoozed, nextRegularAt: '2026-11-15T14:00:00.000Z' }),
                item({ id: 'not-after', ...repeating, ...snoozed, nextRegularAt: '2026-11-15T13:10:00.000Z' }),
                item({ id: 'before', ...repeating, ...snoozed, nextRegularAt: '2026-11-15T13:05:00.000Z' }),
            ],
        });
        const listed = (await runTaskTool(MY_TASKS_TOOL, {}, context)) as { items: Array<Record<string, unknown>> };
        const byId = (id: string) => listed.items.find((one) => one.id === id)!;
        expect(byId('ok')).toMatchObject({ snoozed: true, then_regular: expect.any(String) });
        for (const id of ['once', 'not-after', 'before']) expect(byId(id).then_regular).toBeUndefined();
    });

    it('answers the question a goal asked: close it is done, keep going is keep, and my_tasks shows which goal asked', async () => {
        const goal = item({ kind: 'goal', words: 'Get my visa', state: 'on', nextDueAt: '2026-11-15T13:00:00.000Z', asking: 'unsure' });
        const { admin, context } = setUp({ items: [goal, item({ id: 'item-2', kind: 'goal', asking: 'date_passed' }), item({ id: 'item-3', kind: 'goal' })] });
        const listed = (await runTaskTool(MY_TASKS_TOOL, {}, context)) as { items: Array<Record<string, unknown>> };
        expect(listed.items[0].asking).toMatch(/could not tell/);
        expect(listed.items[1].asking).toMatch(/date passed/);
        expect(listed.items[2]).not.toHaveProperty('asking');
        expect(await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'close' }, context)).toMatchObject({ closed: true });
        expect(admin.changeBrickItem).toHaveBeenLastCalledWith(BRICK, 'item-1', { userId: SARA, action: 'done' });
        expect(await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-1', action: 'keep_going' }, context)).toMatchObject({ kept_going: true });
        expect(admin.changeBrickItem).toHaveBeenLastCalledWith(BRICK, 'item-1', { userId: SARA, action: 'keep' });
        // Only a goal asks: Orbit says no to anything else, and the Brick says so plainly
        admin.changeBrickItem.mockResolvedValueOnce({ ok: false, status: 409, code: 'wrong_state', error: 'Only a goal asks a question' } as never);
        expect(String((await runTaskTool(CHANGE_TASK_TOOL, { id: 'item-9', action: 'keep_going' }, context)).error)).toContain('cannot be done');
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
        Object.assign(service, { ownBricks: new Set<string>(), knownBricks: new Set<string>(), brickOwners: new Map<string, string>(), helperBricks: new Set<string>(), adminApiService: admin, conversationMemory: { getMemory: () => memory } });
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

describe('an App with a tool named like a reminder tool', () => {
    const appTool = (name: string) => ({ type: 'function', function: { name, description: 'An App’s own', parameters: { type: 'object', properties: {} } } });

    function owner() {
        const service = openToolGate(new AIService(null!, null!, '')) as unknown as {
            ownBricks: Set<string>;
            conversationMemory: unknown;
            offerTaskTools(tools: any[], map: Map<string, unknown>): void;
            executeToolCalls: (...args: unknown[]) => Promise<Array<{ result: unknown }>>;
            runTaskToolCall: (...args: unknown[]) => Promise<unknown>;
        };
        service.ownBricks = new Set([BRICK]);
        service.conversationMemory = { getMemory: () => ({ userUuid: SARA }) };
        return service;
    }
    const server = { serverId: 's1', serverUrl: 'https://mcp.example', authType: 'none' };

    it('is not offered beside ours when ours are offered, and is not run for them either', () => {
        const service = owner();
        const tools = [appTool(SET_REMINDER_TOOL), appTool('lookup')];
        const map = new Map<string, unknown>([[SET_REMINDER_TOOL, server], ['lookup', server]]);
        service.offerTaskTools(tools, map);
        expect(tools.filter((tool) => tool.function.name === SET_REMINDER_TOOL)).toHaveLength(1);
        expect(tools.find((tool) => tool.function.name === SET_REMINDER_TOOL).function.description).not.toBe('An App’s own');
        expect(map.has(SET_REMINDER_TOOL)).toBe(false);
        expect(map.has('lookup')).toBe(true);
    });

    it('runs as the App’s when this reply did not offer ours, even though Orbit lately said they are the owner', async () => {
        const { admin } = setUp();
        await taskSettingsFor(admin as never, BRICK, SARA, NOW);
        expect(tasksAreOn(BRICK, SARA)).toBe(true);
        const service = owner();
        const own = vi.spyOn(service, 'runTaskToolCall' as never).mockResolvedValue({} as never);
        const theirs = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('ok' as never);
        // Orbit could not be asked at the start of this reply, so ours were not offered and the App's tool was
        const offeredToTheModel = new Map<string, unknown>([[SET_REMINDER_TOOL, server]]);
        await service.executeToolCalls([{ id: '1', name: SET_REMINDER_TOOL, arguments: '{}' }], undefined, undefined, offeredToTheModel, undefined, undefined, BRICK, 1);
        expect(theirs).toHaveBeenCalledTimes(1);
        expect(own).not.toHaveBeenCalled();
    });

    it('runs ours when ours were offered', async () => {
        const { admin } = setUp();
        await taskSettingsFor(admin as never, BRICK, SARA, NOW);
        const service = owner();
        const own = vi.spyOn(service, 'runTaskToolCall' as never).mockResolvedValue({ set: true } as never);
        const theirs = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('ok' as never);
        const map = new Map<string, unknown>([[SET_REMINDER_TOOL, server]]);
        service.offerTaskTools([], map);
        await service.executeToolCalls([{ id: '1', name: SET_REMINDER_TOOL, arguments: '{}' }], undefined, undefined, map, undefined, undefined, BRICK, 1, undefined, undefined, false, undefined, undefined, undefined, true);
        expect(own).toHaveBeenCalledTimes(1);
        expect(theirs).not.toHaveBeenCalled();
    });

    it('does not run when this reply was not offered them, with no App owning the name, though Orbit lately said they are the owner', async () => {
        const { admin } = setUp();
        await taskSettingsFor(admin as never, BRICK, SARA, NOW);
        expect(tasksAreOn(BRICK, SARA)).toBe(true);
        const service = owner();
        const own = vi.spyOn(service, 'runTaskToolCall' as never).mockResolvedValue({ set: true } as never);
        // Orbit could not be asked at the start of this reply, so ours were not offered; the model names one anyway
        await service.executeToolCalls([{ id: '1', name: SET_REMINDER_TOOL, arguments: '{}' }], undefined, undefined, new Map(), undefined, undefined, BRICK, 1);
        expect(own).not.toHaveBeenCalled();
    });
});

describe('what the chat shows for them', () => {
    it('shows a reminder being set, and one being snoozed or stopped, as a step; reading is never one', () => {
        expect(showsAsStep(SET_REMINDER_TOOL, false)).toBe(true);
        expect(showsAsStep(CHANGE_TASK_TOOL, false)).toBe(true);
        expect(showsAsStep(MY_TASKS_TOOL, false)).toBe(false);
        expect(describeStep({ id: '1', name: SET_REMINDER_TOOL, arguments: { text: 'Pick up the car' } })).toMatchObject({ done: 'Set a reminder', detail: 'Pick up the car' });
        expect(describeStep({ id: '2', name: CHANGE_TASK_TOOL, arguments: { action: 'snooze' } })).toMatchObject({ done: 'Snoozed a reminder' });
        expect(describeStep({ id: '3', name: CHANGE_TASK_TOOL, arguments: { action: 'cancel' } })).toMatchObject({ done: 'Stopped it' });
        expect(describeStep({ id: '3b', name: CHANGE_TASK_TOOL, arguments: { action: 'run_now' } })).toMatchObject({ done: 'Ran it now' });
        expect(describeStep({ id: '4', name: SET_BRIEFING_TOOL, arguments: { text: 'my day' } })).toMatchObject({ done: 'Set a briefing', detail: 'my day' });
        expect(describeStep({ id: '5', name: SET_WATCH_TOOL, arguments: { text: 'the flight' } })).toMatchObject({ done: 'Set a watch', detail: 'the flight' });
        expect(describeStep({ id: '6', name: SET_GOAL_TOOL, arguments: { text: 'my visa' } })).toMatchObject({ done: 'Set a goal', detail: 'my visa' });
        for (const name of [SET_BRIEFING_TOOL, SET_WATCH_TOOL, SET_GOAL_TOOL]) expect(showsAsStep(name, false)).toBe(true);
    });
});
