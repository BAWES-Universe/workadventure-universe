/**
 * Goals and tasks, the Brick's own tools (game #2002, "set one by asking"): a person asks their Brick, in their own chat with it, to
 * remind them of something. No form and no card that repeats it back: the Brick sets it with a tool, and says in one message what it
 * will do, when, where and how to change or stop it. A briefing, a watch and a goal are set the same way, each with its own tool, on a time they
 * gave or one Brick offered and they said yes to.
 *
 * Only the owner, in their own Brick's direct messages: Orbit refuses anyone else (a visiting person, the Brick for guests, a room bot),
 * and a Brick that Orbit refuses for the person it is talking to simply has none of these tools. Nothing here runs a reminder (the
 * runner does that, from Orbit's due list), and nothing here is set unless the person asked.
 */
import type { AdminApiService, BrickItemView, ItemAnswer, ItemRefused } from '../server/AdminApiService';
import { isTimeZone, localToInstant, sayMoment, sayNow, timeOfDayOf } from './BrickTime';

export const SET_REMINDER_TOOL = 'set_reminder';
export const MY_TASKS_TOOL = 'my_tasks';
export const CHANGE_TASK_TOOL = 'change_task';
export const KEEP_WORKDAYS_TOOL = 'keep_workdays';
export const SET_BRIEFING_TOOL = 'set_briefing';
export const SET_WATCH_TOOL = 'set_watch';
export const SET_GOAL_TOOL = 'set_goal';
export const TASK_TOOL_NAMES: readonly string[] = [SET_REMINDER_TOOL, SET_BRIEFING_TOOL, SET_WATCH_TOOL, SET_GOAL_TOOL, MY_TASKS_TOOL, CHANGE_TASK_TOOL, KEEP_WORKDAYS_TOOL];

export const isTaskTool = (name: string): boolean => TASK_TOOL_NAMES.includes(name);

/** What a Brick knows about its owner before it sets anything (Orbit: GET api/bots/:id/brick-items/settings). */
export interface TaskSettings {
    /** Their own time zone, kept from their device; null until one is kept (the Brick then asks once). */
    timeZone: string | null;
    /** The days they work (0 is Sunday); null until they say (the Brick then asks once, in one line). */
    workdays: number[] | null;
    limits: { itemsPerPerson?: number; shortestRepeat?: number; snooze?: number };
}

type ToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: object } };

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WORDS_MAX = 300;
const TEXT_MAX = 2000;
const CONDITION_MAX = 1000;
const HOURS_MAX = 24 * 30;

export function taskToolDefinitions(): ToolDefinition[] {
    return [
        {
            type: 'function',
            function: {
                name: SET_REMINDER_TOOL,
                description:
                    'Set a reminder for this person, only when they asked to be reminded of something and gave a time (or said when, like "in 20 minutes" or "every workday at 9"). ' +
                    'The reminder will say their words in this chat at that time; it is fixed text and does no work. Never guess a time they did not give: ask once first. ' +
                    'After it is set, tell them in ONE message what you will say, when (name their time zone), that it comes here in this chat, and that they can ask you here to change, snooze or stop it.',
                parameters: {
                    type: 'object',
                    properties: {
                        text: { type: 'string', description: 'What the reminder says, short and in their words: "Pick up the car". Not "remind me to ...".' },
                        when: {
                            type: 'string',
                            description: 'The date and time on THEIR clock, 24 hour, like "2026-11-15 16:00". For a reminder that repeats only the time of day counts. Give this or in_minutes.',
                        },
                        in_minutes: { type: 'integer', description: 'Instead of when: how many minutes from now ("in 20 minutes" is 20).' },
                        repeat: { type: 'string', enum: ['none', 'every_day', 'workdays'], description: 'none (once, the usual), every_day, or workdays (the days they work).' },
                        time_zone: { type: 'string', description: 'Only when no time zone is kept for them yet and they told you where they are: a name like "Asia/Kuwait".' },
                    },
                    required: ['text'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: SET_BRIEFING_TOOL,
                description:
                    'Set a briefing for this person, only when they asked you to bring them something on a schedule ("every workday at 7:30, tell me what is on"). Each time it is due you look it up and tell them, also when there is nothing ("Nothing scheduled today"). ' +
                    'It repeats every day or on their workdays at a time of day THEY gave: never guess a time, ask once. For something they want once, answer now (or set a reminder). It can only use what you can use in this chat: the web and their Apps. If it needs an App they have not connected, offer to connect it first. ' +
                    'After it is set, tell them in ONE message: what you will bring, when (name their time zone), that it comes here in this chat, and that they can ask you here to change, pause or stop it.',
                parameters: {
                    type: 'object',
                    properties: {
                        text: { type: 'string', description: 'What it brings, in their words: "my day and the weather".' },
                        repeat: { type: 'string', enum: ['every_day', 'workdays'], description: 'How often.' },
                        when: { type: 'string', description: 'The time of day on THEIR clock, written like "2026-11-15 07:30" (only the time of day counts).' },
                        time_zone: { type: 'string', description: 'Only when no time zone is kept for them yet and they told you where they are: a name like "Asia/Kuwait".' },
                    },
                    required: ['text', 'repeat', 'when'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: SET_WATCH_TOOL,
                description:
                    'Keep watch on something for this person, only when they asked ("tell me when the flight drops under KWD 90"). You check it on a schedule and speak ONLY when the condition they named is met (speak_when). ' +
                    'How often: every day or on their workdays at a time of day (repeat and when), or every few hours (repeat every_hours and hours). If they did not say how often, offer one in your message ("I\'ll check it every 6 hours") and set it only when they say yes: a plain yes counts only as the answer to that specific offer. ' +
                    'After it is set, tell them in ONE message: what you watch, how often, that you speak only when the condition is met, that it comes here in this chat, and that they can ask you here to change, pause or stop it.',
                parameters: {
                    type: 'object',
                    properties: {
                        text: { type: 'string', description: 'What to keep watch on, in their words: "the flight to London".' },
                        speak_when: { type: 'string', description: 'When to speak up, in their words: "the price drops under KWD 90".' },
                        repeat: { type: 'string', enum: ['every_day', 'workdays', 'every_hours'], description: 'How often it checks.' },
                        when: { type: 'string', description: 'every_day or workdays: the time of day on THEIR clock, like "2026-11-15 09:00" (only the time of day counts).' },
                        hours: { type: 'integer', description: 'every_hours: how many hours between checks.' },
                        time_zone: { type: 'string', description: 'Only when no time zone is kept for them yet and they told you where they are: a name like "Asia/Kuwait".' },
                    },
                    required: ['text', 'speak_when', 'repeat'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: SET_GOAL_TOOL,
                description:
                    'Take on a goal for this person: something that needs several steps and some time, only when they asked you to work toward it ("get my visa sorted before my trip"). You plan it, check on it on a schedule and speak only when something material changed or you need them. ' +
                    'outcome is what counts as reached, as the thing itself (an issued visa, not a submitted form); if it is unclear, ask once. Something to do at one moment is a reminder, not a goal. ' +
                    'How often you check: as for a watch (every day or workdays at a time of day, or every few hours). If they did not say, offer one in your message ("I\'ll look at it once a day at 9:00 and only message you when something changes") and set it only when they say yes. ' +
                    'After it is set, tell them in ONE message: the goal and what counts as done, how often you check, that you speak only when something changes or you need them, that it comes here in this chat, and that they can ask you here to change, pause or stop it.',
                parameters: {
                    type: 'object',
                    properties: {
                        text: { type: 'string', description: 'The goal, in their words: "get my visa sorted before my trip".' },
                        outcome: { type: 'string', description: 'What counts as reached, in a line: "the visa is issued".' },
                        repeat: { type: 'string', enum: ['every_day', 'workdays', 'every_hours'], description: 'How often you check.' },
                        when: { type: 'string', description: 'every_day or workdays: the time of day on THEIR clock, like "2026-11-15 09:00" (only the time of day counts).' },
                        hours: { type: 'integer', description: 'every_hours: how many hours between checks.' },
                        time_zone: { type: 'string', description: 'Only when no time zone is kept for them yet and they told you where they are: a name like "Asia/Kuwait".' },
                    },
                    required: ['text', 'outcome', 'repeat'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: MY_TASKS_TOOL,
                description:
                    'What this person has asked you to keep: each with its id, what it says, when it comes next, and when it last went off. Use it before you change, snooze or stop one, and when they ask what you are keeping for them. A goal that has asked them a question shows asking: when they answer it, use close or keep_going.',
                parameters: { type: 'object', properties: {} },
            },
        },
        {
            type: 'function',
            function: {
                name: CHANGE_TASK_TOOL,
                description:
                    'Change one the person asked you to keep, when they ask: snooze (a reminder comes back after a while, also right after it went off), pause, resume, cancel (stop it for good), or change (its words, its time or how often it checks, a watch\'s condition, a goal\'s outcome). ' +
                    'For a goal that asked them a question (my_tasks shows asking): close (they say it is done, so it stops and is marked done) or keep_going (they say carry on: it goes on as it was and does not ask that again). ' +
                    'Get its id from my_tasks. Tell them plainly what you did, and when it comes next.',
                parameters: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', description: 'Its id from my_tasks.' },
                        action: { type: 'string', enum: ['snooze', 'pause', 'resume', 'cancel', 'change', 'close', 'keep_going'] },
                        text: { type: 'string', description: 'change: the new words.' },
                        when: { type: 'string', description: 'change: the new date and time on THEIR clock, like "2026-11-15 16:00".' },
                        in_minutes: { type: 'integer', description: 'change: the new time as minutes from now.' },
                        repeat: { type: 'string', enum: ['none', 'every_day', 'workdays', 'every_hours'], description: 'change: how often (none is a reminder at one moment; every_hours is a watch, briefing or goal checking every few hours, with hours).' },
                        hours: { type: 'integer', description: 'change, every_hours: how many hours between checks.' },
                        speak_when: { type: 'string', description: 'change, a watch: the new condition it speaks for.' },
                        outcome: { type: 'string', description: 'change, a goal: the new outcome that counts as reached.' },
                        time_zone: { type: 'string', description: 'Only when no time zone is kept for them yet, they told you where they are and the new time is a date and time: a name like "Asia/Kuwait".' },
                    },
                    required: ['id', 'action'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: KEEP_WORKDAYS_TOOL,
                description: 'Keep the days this person works, only after they told you (the one-line question: Sun to Thu, Mon to Fri, or other days). Never guess them from where they live.',
                parameters: {
                    type: 'object',
                    properties: { days: { type: 'array', items: { type: 'string', enum: DAY_NAMES }, description: 'The days they work, like ["sun","mon","tue","wed","thu"].' } },
                    required: ['days'],
                },
            },
        },
    ];
}

/** What a Brick that has these tools is told with its instructions. Pure. */
export function taskToolsNote(settings: TaskSettings, now: number): string {
    const lines = [
        'What you keep for this person: when they ask, you set a reminder (set_reminder: your fixed words at a time), a briefing (set_briefing: you bring them something on a schedule), a watch (set_watch: you check something and speak only when their condition is met) or a goal (set_goal: you work toward an outcome and speak only when something changed or you need them). ' +
            'You see what you keep for them with my_tasks, and snooze, pause, resume, change or cancel one with change_task. You set nothing they did not ask for, and never set one on your own idea.',
    ];
    lines.push(
        settings.timeZone
            ? `Their clock reads ${sayNow(now, settings.timeZone)} (${settings.timeZone}). Give times on that clock.`
            : 'No time zone is kept for them yet. When they ask for a reminder, ask once which city or time zone they are in, then pass it as time_zone.'
    );
    lines.push(
        'Rules: never guess a time they did not give, ask once (a question card when it fits). A plain "yes" sets something only when it answers a specific offer you made in your message just before. ' +
            'When you set one, say it in one message: what you will say, when (naming their time zone), that it comes here in this chat, and that they can ask you here to change, snooze or stop it, or do it any time in [Goals and tasks](#goals) (write that link exactly as it is). ' +
            'When they ask to snooze, or to be reminded again, after one came, find the one that went off last with my_tasks and snooze it. ' +
            'Never say you set, changed or cancelled one unless the tool said it worked. ' +
            'Pick the kind by what they want: a reminder says their own words at a time; a briefing brings them something every time it is due; a watch speaks only when its condition is met; a goal needs steps and time and speaks only when something changed. Never use one kind to stand in for another. ' +
            'A watch or a goal needs a check schedule: when they did not say how often, offer one specific schedule in your message and set it only when they say yes. Only a computer cannot be used for a step yet: if what they want needs one, say plainly that you cannot do that step yet.'
    );
    lines.push(
        settings.workdays
            ? `Their workdays: ${settings.workdays.map((day) => DAY_NAMES[day]).join(', ')}.`
            : 'Their workdays are not kept. A reminder for "workdays" needs them: ask once, in one line (Sun to Thu, Mon to Fri, or other), then keep them with keep_workdays. Never guess from where they live.'
    );
    const limits = settings.limits;
    if (limits.itemsPerPerson) lines.push(`They can have ${limits.itemsPerPerson} goals and tasks at once.`);
    if (limits.snooze) lines.push(`Snooze moves a reminder by ${snoozeWords(limits.snooze)}.`);
    return lines.join('\n');
}

function snoozeWords(minutes: number): string {
    if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
    return `${minutes} minutes`;
}

// --- who has these tools ---------------------------------------------------------------------------------------------------------------

const SETTINGS_KEPT_MS = 30_000;
const SETTINGS_MAX = 500;
const kept = new Map<string, { at: number; settings: TaskSettings | null }>();
/** Pairs (Brick and person) that Orbit last said are the owner's: only for them do these tools run, whatever an outside tool server calls its own. */
const owners = new Set<string>();
const keyOf = (botId: string, userId: string) => `${botId}|${userId}`;

/** Whether the tools are on for this Brick and person right now: Orbit said they are the owner, not long ago. */
export const tasksAreOn = (botId: string, userId: string): boolean => owners.has(keyOf(botId, userId));

/** Forgets what is kept (after the person's workdays changed, or in a test). */
export function forgetTaskSettings(botId?: string, userId?: string): void {
    if (botId && userId) {
        kept.delete(keyOf(botId, userId));
        return;
    }
    kept.clear();
    owners.clear();
}

/**
 * What Orbit says about this owner, or null when these tools are not theirs to use (not the owner of the Brick, the Brick for guests, a
 * room bot, Orbit not set up) or Orbit could not be asked just now. A brief answer is kept, so a reply does not ask Orbit twice.
 */
export async function taskSettingsFor(admin: Pick<AdminApiService, 'brickItemSettings' | 'isConfigured'> | undefined, botId: string, userId: string, now = Date.now()): Promise<TaskSettings | null> {
    const answer = await askSettings(admin, botId, userId, now);
    return answer === 'busy' ? null : answer;
}

/** As taskSettingsFor, but says 'busy' when Orbit could not be asked, which is not the same as "not the owner". */
async function askSettings(admin: Pick<AdminApiService, 'brickItemSettings' | 'isConfigured'> | undefined, botId: string, userId: string, now: number): Promise<TaskSettings | null | 'busy'> {
    if (!admin?.isConfigured?.()) return null;
    const key = keyOf(botId, userId);
    const known = kept.get(key);
    if (known && now - known.at < SETTINGS_KEPT_MS) return known.settings;
    try {
        const answer = await admin.brickItemSettings(botId, userId);
        // Only Orbit's 404 says "not the owner"; any other refusal (a busy Orbit, a session that lapsed) is not kept as a no
        if (refused(answer) && answer.status !== 404) throw new Error(`Orbit answered ${answer.status}: ${answer.error}`);
        const settings: TaskSettings | null = !refused(answer)
            ? {
                  timeZone: isTimeZone(answer.timeZone) ? answer.timeZone : null,
                  workdays: Array.isArray(answer.workdays) ? answer.workdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6) : null,
                  limits: answer.limits ?? {},
              }
            : null;
        // A "no" from Orbit (not the owner) is kept as briefly as a yes; Orbit unreachable is not kept at all
        kept.delete(key);
        kept.set(key, { at: now, settings });
        if (kept.size > SETTINGS_MAX) kept.delete(kept.keys().next().value!);
        owners.delete(key);
        if (settings) {
            // Added last, so the pairs that went quiet longest ago are the ones let go when there are too many
            owners.add(key);
            if (owners.size > SETTINGS_MAX) owners.delete(owners.values().next().value!);
        }
        return settings;
    } catch (error) {
        console.warn('[BrickTasks] Could not ask Orbit what is kept for the owner:', error instanceof Error ? error.message : error);
        // Only Orbit's own answer changes who the owner is: a busy Orbit in the middle of a reply must not take the tools away from them
        return 'busy';
    }
}

// --- the tools --------------------------------------------------------------------------------------------------------------------------

export interface TaskToolContext {
    admin: Pick<AdminApiService, 'brickItemSettings' | 'keepBrickWorkdays' | 'setBrickItem' | 'listBrickItems' | 'changeBrickItem' | 'isConfigured'>;
    /** The Brick that asks, and the person it belongs to (their game uuid). */
    botId: string;
    userId: string;
    now?: () => number;
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

type Repeat = 'none' | 'every_day' | 'workdays' | 'every_hours';
const repeatOf = (value: unknown): Repeat => (value === 'every_day' || value === 'workdays' || value === 'every_hours' ? value : 'none');

/** The hours between two checks, whole hours, or null when none were given or they are not a wait a check can have. */
function hoursOf(args: Record<string, unknown>): number | null {
    const value = args.hours;
    return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= HOURS_MAX ? Math.round(value) : null;
}

/** Whether the model really gave a time: models fill a field they do not use with null, "" or 0, and that is not a change of time. */
const timeGiven = (value: unknown): boolean => value !== undefined && value !== null && value !== '' && value !== 0;

/** The wait "in N minutes" means, whole minutes, or null when none was given or it is not one a reminder can wait. */
function inMinutesOf(args: Record<string, unknown>): number | null {
    const value = args.in_minutes;
    return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 525_600 ? Math.round(value) : null;
}

/** A cadence the person's words mean, or the plain thing to tell the model when it cannot be made. */
function cadenceFrom(args: Record<string, unknown>, settings: TaskSettings, timeZone: string, now: number): { cadence: Record<string, unknown> } | { problem: Record<string, unknown> } {
    const repeat = repeatOf(args.repeat);
    if (repeat === 'every_hours') {
        const hours = hoursOf(args);
        if (hours === null) return { problem: { error: 'Every how many hours? Ask them once, then pass hours (a whole number).' } };
        return { cadence: { type: 'every', minutes: hours * 60 } };
    }
    if (repeat !== 'none') {
        const time = timeOfDayOf(args.when);
        if (!time) return { problem: { error: 'Something that repeats every day needs the time of day, in "when" like "2026-11-15 09:00". Ask them what time if they did not say.' } };
        if (repeat === 'every_day') return { cadence: { type: 'daily', time, days: [0, 1, 2, 3, 4, 5, 6] } };
        if (!settings.workdays || settings.workdays.length === 0) {
            return { problem: { needs: 'workdays', note: 'Their workdays are not kept. Ask once, in one line: "Sun to Thu, Mon to Fri, or other?" Then call keep_workdays, then set this again. Never guess them.' } };
        }
        return { cadence: { type: 'daily', time, days: [...settings.workdays].sort((a, b) => a - b) } };
    }
    const minutes = inMinutesOf(args);
    if (minutes !== null) return { cadence: { type: 'once', at: new Date(now + minutes * 60_000).toISOString() } };
    if (args.when === undefined || args.when === null || args.when === '') {
        return { problem: { error: 'There is no time yet. Ask them when, once. Never guess.' } };
    }
    const at = localToInstant(args.when, timeZone);
    if (!at) return { problem: { error: 'That time is not written as "2026-11-15 16:00" (their clock, 24 hour). Write it that way and call again.' } };
    return { cadence: { type: 'once', at } };
}

const refused = (answer: ItemAnswer<object>): answer is ItemRefused => answer.ok === false;

/** What a refusal from Orbit means for the Brick's words. */
function refusal(answer: ItemRefused): Record<string, unknown> {
    switch (answer.code) {
        case 'needs_time_zone':
            return { needs: 'time_zone', note: 'No time zone is kept for them. Ask once which city or time zone they are in, then call again with time_zone (a name like "Asia/Kuwait").' };
        case 'too_many':
            return { error: `They already have ${answer.limit ?? 'the most'} goals and tasks at once, which is the most. Say so, and offer to stop or finish one first.` };
        case 'too_often':
            return { error: `Reminders cannot repeat more often than every ${answer.limit ?? 'so many'} minutes. Say so.` };
        case 'past':
            return { error: 'That time has already passed. Ask what time they mean.' };
        case 'off':
            return { error: 'This Brick is switched off, so nothing can be set.' };
        case 'wrong_state':
            return { error: `That cannot be done to it now (${answer.error}). Say so plainly.` };
        default:
            if (answer.status === 404) return { error: 'That is not one of theirs, or only its owner can do this in their own chat. Say so plainly.' };
            if (answer.status === 400) return { error: `That was not accepted (${answer.error}). Check it and try once more, or ask them.` };
            return { error: 'That could not be done just now. Say so in one plain sentence and offer to try again.' };
    }
}

const cadenceWords = (cadence: BrickItemView['cadence'], workdays: number[] | null): string | null => {
    if (cadence.type === 'every') return cadence.minutes % 60 === 0 ? (cadence.minutes === 60 ? 'every hour' : `every ${cadence.minutes / 60} hours`) : `every ${cadence.minutes} minutes`;
    if (cadence.type !== 'daily') return null;
    if (cadence.days.length === 7) return 'every day';
    if (workdays && cadence.days.length === workdays.length && cadence.days.every((day, index) => day === [...workdays].sort((a, b) => a - b)[index])) return 'on their workdays';
    return `on ${cadence.days.map((day) => DAY_NAMES[day]).join(', ')}`;
};

function view(item: BrickItemView, now: number, workdays: number[] | null, zone: string = item.timeZone): Record<string, unknown> {
    const repeats = cadenceWords(item.cadence, workdays);
    return {
        id: item.id,
        kind: item.kind,
        says: item.words,
        ...(item.condition ? { speaks_when: item.condition } : {}),
        ...(item.outcome ? { done_when: item.outcome } : {}),
        state: item.state,
        ...(item.nextDueAt ? { next: sayMoment(item.nextDueAt, zone, now) } : {}),
        ...(repeats ? { repeats } : {}),
        ...(item.lastRunAt ? { went_off: sayMoment(item.lastRunAt, zone, now) } : {}),
        ...(item.asking ? { asking: item.asking === 'date_passed' ? 'it asked them what to do now that its date passed' : 'it asked them whether it is done, because it could not tell' } : {}),
        time_zone: zone,
    };
}

/** The reminders just set, for a second identical call (a model that calls twice in one reply gets the first back, set once). */
const justSet = new Map<string, { at: number; result: Record<string, unknown> }>();
const JUST_SET_MS = 60_000;

/** Runs one of the four tools. Never throws: the model is told in plain words what happened. */
export async function runTaskTool(name: string, args: Record<string, unknown>, context: TaskToolContext): Promise<Record<string, unknown>> {
    const now = (context.now ?? Date.now)();
    // Only for the owner, in their own chat: asked of Orbit, which keeps whose it is
    const settings = await askSettings(context.admin, context.botId, context.userId, now);
    if (settings === 'busy') return { error: 'That could not be done just now. Say so in one plain sentence and offer to try again.' };
    if (!settings) return { error: 'That cannot be done in this chat. Only the owner of this Brick can ask it to keep a reminder, in their own chat with it.' };
    try {
        switch (name) {
            case SET_REMINDER_TOOL:
                return await setReminder(args, settings, context, now);
            case SET_BRIEFING_TOOL:
                return await setTimed('schedule', args, settings, context, now);
            case SET_WATCH_TOOL:
                return await setTimed('watch', args, settings, context, now);
            case SET_GOAL_TOOL:
                return await setTimed('goal', args, settings, context, now);
            case MY_TASKS_TOOL: {
                const answer = await context.admin.listBrickItems(context.botId, context.userId);
                if (refused(answer)) return refusal(answer);
                const items = answer.items.filter((item) => item.state !== 'deleted').slice(0, 30);
                return items.length === 0 ? { items: [], note: 'They have asked you to keep nothing right now.' } : { items: items.map((item) => view(item, now, settings.workdays)) };
            }
            case CHANGE_TASK_TOOL:
                return await changeTask(args, settings, context, now);
            case KEEP_WORKDAYS_TOOL: {
                const days = Array.isArray(args.days) ? [...new Set(args.days.map((day) => DAY_NAMES.indexOf(String(day).toLowerCase().slice(0, 3))))] : [];
                if (days.length === 0 || days.includes(-1)) return { error: 'Name the days they work, like ["sun","mon","tue","wed","thu"].' };
                const answer = await context.admin.keepBrickWorkdays(context.botId, context.userId, days.sort((a, b) => a - b));
                if (refused(answer)) return refusal(answer);
                forgetTaskSettings(context.botId, context.userId);
                return { kept: true, workdays: answer.workdays.map((day) => DAY_NAMES[day]), note: 'Kept. Now set the reminder they asked for.' };
            }
        }
    } catch (error) {
        console.warn('[BrickTasks] A goals and tasks call failed:', error instanceof Error ? error.message : error);
        return { error: 'That could not be done just now. Say so in one plain sentence and offer to try again.' };
    }
    return { error: 'Unknown tool.' };
}

async function setReminder(args: Record<string, unknown>, settings: TaskSettings, context: TaskToolContext, now: number): Promise<Record<string, unknown>> {
    const words = text(args.text, WORDS_MAX);
    if (!words) return { error: 'Say what the reminder says.' };
    if (repeatOf(args.repeat) === 'every_hours') return { error: 'A reminder comes at a time, or every day or on their workdays at a time. Checking every few hours is a watch or a goal.' };
    let timeZone = settings.timeZone;
    const given = text(args.time_zone, 64);
    if (!timeZone) {
        if (!isTimeZone(given)) return { needs: 'time_zone', note: 'No time zone is kept for them. Ask once which city or time zone they are in, then call again with time_zone (a name like "Asia/Kuwait").' };
        timeZone = given;
    }
    const built = cadenceFrom(args, settings, timeZone, now);
    if ('problem' in built) return built.problem;
    // "In 20 minutes" is a moment that moves with the clock, so it is keyed on what was asked, not on the moment it came to
    const minutes = repeatOf(args.repeat) === 'none' ? inMinutesOf(args) : null;
    const relative = minutes !== null ? `in ${minutes} min` : null;
    // The zone is part of what was asked when it is the one a daily time is read on
    const key = JSON.stringify(['reminder', context.botId, context.userId, words, relative ?? [built.cadence, timeZone]]);
    const before = justSet.get(key);
    const again = { note: 'Already set a moment ago, once. Do not set it again.' };
    if (before && now - before.at < JUST_SET_MS) return { ...before.result, ...again };
    // Two identical calls in one reply run together: the second waits for the first one's answer instead of making another
    const inFlight = creating.get(key);
    if (inFlight) {
        const first = await inFlight;
        return 'set' in first ? { ...first, ...again } : first;
    }
    const creation = createItem(key, { kind: 'reminder', words }, built.cadence, timeZone, settings, context, now);
    creating.set(key, creation);
    try {
        return await creation;
    } finally {
        creating.delete(key);
    }
}

type Timed = 'schedule' | 'watch' | 'goal';

const KIND_NOTES: Record<'reminder' | Timed, string> = {
    reminder: 'Now tell them in one message: what you will say, when (naming the time zone), that it comes here in this chat, and that they can ask you here to change, snooze or stop it.',
    schedule: 'Now tell them in one message: what you will bring, when (naming the time zone), that it comes here in this chat every time, also when there is nothing, and that they can ask you here to change, pause or stop it.',
    watch: 'Now tell them in one message: what you watch, how often (naming the time zone for a time of day), that you speak only when the condition is met, that it comes here in this chat, and that they can ask you here to change, pause or stop it.',
    goal: 'Now tell them in one message: the goal and what counts as done, how often you check (naming the time zone for a time of day), that you speak only when something changed or you need them, that it comes here in this chat, and that they can ask you here to change, pause or stop it.',
};

/**
 * A briefing, a watch or a goal, set by asking. They repeat, so the cadence is always a time of day (every day or on their workdays) or
 * every few hours, never a single moment: a time with no repeat is a reminder. The time is theirs or one Brick offered and they said yes
 * to, which is the model's to tell apart; nothing here guesses one.
 */
async function setTimed(kind: Timed, args: Record<string, unknown>, settings: TaskSettings, context: TaskToolContext, now: number): Promise<Record<string, unknown>> {
    const words = text(args.text, WORDS_MAX);
    if (!words) return { error: kind === 'schedule' ? 'Say what the briefing brings.' : kind === 'watch' ? 'Say what to keep watch on.' : 'Say the goal, in their words.' };
    const condition = kind === 'watch' ? text(args.speak_when, CONDITION_MAX) : '';
    if (kind === 'watch' && !condition) return { error: 'Say when it should speak up (speak_when), like "the price drops under KWD 90". Ask them once if they did not say.' };
    const outcome = kind === 'goal' ? text(args.outcome, CONDITION_MAX) : '';
    if (kind === 'goal' && !outcome) return { error: 'Say what counts as reached (outcome), as the thing itself and not that something was sent. Ask them once if it is unclear.' };
    const repeat = repeatOf(args.repeat);
    if (repeat === 'none') {
        return {
            error:
                kind === 'schedule'
                    ? 'A briefing repeats: every day or on their workdays, at a time of day. For something once, answer now or set a reminder. Ask them which, once.'
                    : 'It needs a schedule for its checks: every day or on their workdays at a time of day, or every few hours. Offer one in your message and set it when they say yes.',
        };
    }
    if (kind === 'schedule' && repeat === 'every_hours') return { error: 'A briefing comes every day or on their workdays, at a time of day.' };
    let timeZone = settings.timeZone;
    const given = text(args.time_zone, 64);
    if (!timeZone) {
        if (!isTimeZone(given)) return { needs: 'time_zone', note: 'No time zone is kept for them. Ask once which city or time zone they are in, then call again with time_zone (a name like "Asia/Kuwait").' };
        timeZone = given;
    }
    const built = cadenceFrom(args, settings, timeZone, now);
    if ('problem' in built) return built.problem;
    // Every few hours does not depend on their clock; a time of day does, so the zone is part of what was asked only then. The key is a JSON
    // array so words that hold the separator can never make two different asks one.
    const key = JSON.stringify([kind, context.botId, context.userId, words, condition, outcome, built.cadence, repeat === 'every_hours' ? '' : timeZone]);
    const before = justSet.get(key);
    const again = { note: 'Already set a moment ago, once. Do not set it again.' };
    if (before && now - before.at < JUST_SET_MS) return { ...before.result, ...again };
    const inFlight = creating.get(key);
    if (inFlight) {
        const first = await inFlight;
        return 'set' in first ? { ...first, ...again } : first;
    }
    const creation = createItem(key, { kind, words, ...(condition ? { condition } : {}), ...(outcome ? { outcome } : {}) }, built.cadence, timeZone, settings, context, now);
    creating.set(key, creation);
    try {
        return await creation;
    } finally {
        creating.delete(key);
    }
}

/** Reminders, briefings, watches and goals being made right now, by the same key as justSet. */
const creating = new Map<string, Promise<Record<string, unknown>>>();

async function createItem(
    key: string,
    made: { kind: 'reminder' | Timed; words: string; condition?: string; outcome?: string },
    cadence: Record<string, unknown>,
    timeZone: string,
    settings: TaskSettings,
    context: TaskToolContext,
    now: number
): Promise<Record<string, unknown>> {
    const answer = await context.admin.setBrickItem(context.botId, {
        userId: context.userId,
        kind: made.kind,
        words: made.words,
        ...(made.condition ? { condition: made.condition } : {}),
        ...(made.outcome ? { outcome: made.outcome } : {}),
        cadence,
        // Kept with the item, so a person who moves is not moved with it; and when none was kept the one they just told us
        timeZone,
    });
    if (refused(answer)) return refusal(answer);
    const item = answer.item;
    const repeats = cadenceWords(item.cadence, settings.workdays);
    const result = {
        set: true,
        kind: item.kind,
        id: item.id,
        says: item.words,
        ...(made.condition ? { speaks_when: made.condition } : {}),
        ...(made.outcome ? { done_when: made.outcome } : {}),
        comes: item.nextDueAt ? sayMoment(item.nextDueAt, item.timeZone, now) : null,
        ...(repeats ? { repeats } : {}),
        time_zone: item.timeZone,
        note: KIND_NOTES[made.kind],
    };
    justSet.set(key, { at: now, result });
    if (justSet.size > 200) justSet.delete(justSet.keys().next().value!);
    return result;
}

async function changeTask(args: Record<string, unknown>, settings: TaskSettings, context: TaskToolContext, now: number): Promise<Record<string, unknown>> {
    const id = text(args.id, 64);
    if (!id) return { error: 'Which one? Look it up with my_tasks.' };
    const action = args.action;
    const base = { userId: context.userId };
    let body: Record<string, unknown>;
    // The clock a new date and time was read on, which is the clock the answer is told on
    let readOn: string | undefined;
    switch (action) {
        case 'snooze':
        case 'pause':
        case 'resume':
            body = { ...base, action };
            break;
        case 'cancel':
            body = { ...base, action: 'delete' };
            break;
        case 'close':
            body = { ...base, action: 'done' };
            break;
        case 'keep_going':
            body = { ...base, action: 'keep' };
            break;
        case 'change': {
            const change: Record<string, unknown> = {};
            const words = text(args.text, TEXT_MAX);
            if (words) change.words = words;
            const condition = text(args.speak_when, CONDITION_MAX);
            if (condition) change.condition = condition;
            const outcome = text(args.outcome, CONDITION_MAX);
            if (outcome) change.outcome = outcome;
            if (timeGiven(args.when) || timeGiven(args.in_minutes) || repeatOf(args.repeat) !== 'none') {
                const given = text(args.time_zone, 64);
                const timeZone = settings.timeZone ?? (isTimeZone(given) ? given : null);
                // Only a date and time on their clock needs the zone: "in 20 minutes" and "every day at 9" do not
                const onTheirClock = repeatOf(args.repeat) === 'none' && inMinutesOf(args) === null && timeGiven(args.when);
                if (!timeZone && onTheirClock) {
                    return { needs: 'time_zone', note: 'No time zone is kept for them. Ask once which city or time zone they are in, then call again with time_zone (a name like "Asia/Kuwait").' };
                }
                const built = cadenceFrom(args, settings, timeZone ?? 'UTC', now);
                if ('problem' in built) return built.problem;
                change.cadence = built.cadence;
                if (onTheirClock && timeZone) readOn = timeZone;
            }
            if (Object.keys(change).length === 0) return { error: 'Say what to change: its words, its time, a watch\'s condition or a goal\'s outcome.' };
            body = { ...base, action: 'change', change };
            break;
        }
        default:
            return { error: 'The action is snooze, pause, resume, cancel, change, close or keep_going.' };
    }
    const answer = await context.admin.changeBrickItem(context.botId, id, body);
    if (refused(answer)) return refusal(answer);
    const item = answer.item;
    // Whatever was just set under this id is no longer what a repeat of the same ask would find
    for (const [key, kept] of justSet) if (kept.result.id === item.id) justSet.delete(key);
    const done =
        action === 'cancel' ? 'cancelled' : action === 'snooze' ? 'snoozed' : action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : action === 'close' ? 'closed' : action === 'keep_going' ? 'kept_going' : 'changed';
    return { [done]: true, ...view(item, now, settings.workdays, readOn), note: item.nextDueAt ? 'Tell them plainly what you did, and when it comes next.' : 'Tell them plainly what you did.' };
}
