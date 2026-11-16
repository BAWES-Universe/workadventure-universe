/**
 * A Brick's computer in its owner's chat (game #2000), on the bot server.
 *
 * `use_computer` starts a job on the Brick's own computer. It is the LAST way: an app that can do the job is used instead and wakes
 * nothing, and reading a page is `read_web_page`, never a computer. The tool is only offered when Orbit says the computer is on for
 * this person, so choosing it never wakes anything by itself: waking happens when Orbit starts the job, and only for the owner.
 * What the model is told for each way a start can go is one plain line to say, in the person's language, in the words of the mock
 * (Part 12): a second job waits its turn, a resting computer wakes, a broken one says so, a restored one says which day.
 * No count, no price, no provider or machine name ever reaches the model, so none reaches the chat.
 */
import type { AdminApiService } from '../server/AdminApiService';

export const COMPUTER_TOOL = 'use_computer';

export function isComputerTool(name: string): boolean {
    return name === COMPUTER_TOOL;
}

const TITLE_MAX = 120;
const DETAILS_MAX = 4000;

export function computerToolDefinitions(): { type: 'function'; function: { name: string; description: string; parameters: object } }[] {
    return [
        {
            type: 'function',
            function: {
                name: COMPUTER_TOOL,
                description:
                    'Start a job on your own computer, a real screen with a browser that stays yours between jobs. Use it ONLY for a job nothing else can do: filling in a form on a site that has no app, ' +
                    'booking on a page you must click through, working in a website or a file that lives on the computer. Never when an app you have can do it, never to just read or search a page (use the page and search tools), ' +
                    'and never to be safe. Do not ask them first: start it, then say in one short sentence what you started. The person can Watch, Stop or take over from the bar above this chat. ' +
                    'Paying, submitting and the person\'s own details are never yours alone: the computer asks them first.',
                parameters: {
                    type: 'object',
                    properties: {
                        job: { type: 'string', description: 'What the job is, in a few plain words, as the bar will show it: "Visa form", "Shop website", "Taxi booking".' },
                        details: { type: 'string', description: 'Everything the computer needs to do it, in the person\'s words: the site, what they asked for, the choices they made. Leave out passwords, card numbers and ID numbers: the computer asks the person for those when it needs them.' },
                        app_cannot: { type: 'string', description: 'Only when one of your apps could seem to fit this job: in a few words, why that app cannot do it (it has no such action, or the job lives on a website screen). Leave out otherwise.' },
                        reads_only: { type: 'boolean', description: 'True when the job only looks and writes nothing anywhere (it may run beside another job). Leave out otherwise.' },
                    },
                    required: ['job'],
                },
            },
        },
    ];
}

/** What a Brick with a computer is told with its instructions: the order of choosing, and what it never does. */
export function computerToolsNote(): string {
    return [
        'Your computer: you have your own computer. Choose in this order: answer yourself, then an app you have, and only then the computer (use_computer), for a job nothing else can do.',
        'It does one writing job at a time: a second job waits its turn, and you say so in one line. Never say how much of their month is left, and never name a price, a size or a machine.',
        'Paying and sending the person\'s own details are theirs: you stop and ask them, you never do them alone.',
    ].join('\n');
}

export interface ComputerToolContext {
    admin: Pick<AdminApiService, 'startComputerJob'>;
    /** The apps this person has connected to this Brick in this reply (their names), so a job an app can do is not started on the computer. */
    apps?: string[];
    botId: string;
    userId: string;
    /** Called once a job is running, so a development server can pretend to do it. */
    onStarted?: (jobId: string) => void;
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const day = (iso: string): string => {
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

const plain = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The fixed order is answer, then an app, then the computer. The first is Brick's own judgement; this is the second, checked where the
 * job is started: when the job names one of the person's connected apps, it goes there first, unless Brick says in its own words why
 * that app cannot do it. Never silent and never a price: the model is told in one plain line.
 */
export function appThatFits(job: string, details: string, apps: string[] | undefined): string | null {
    const haystack = ` ${plain(`${job} ${details}`)} `;
    for (const app of apps ?? []) {
        const name = plain(app);
        if (name.length >= 3 && haystack.includes(` ${name} `)) return app;
    }
    return null;
}

/** Runs use_computer. Never throws: the model is told in plain words what happened. */
export async function runComputerTool(args: Record<string, unknown>, context: ComputerToolContext): Promise<Record<string, unknown>> {
    const job = text(args.job, TITLE_MAX);
    if (!job) return { error: 'Say in a few words what the job is.' };
    const brief = typeof args.details === 'string' ? args.details.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, DETAILS_MAX) : '';
    const fits = appThatFits(job, brief, context.apps);
    if (fits && text(args.app_cannot, 300).length < 8) {
        return { started: false, success: false, note: `You have ${fits} connected, and this names it: do the job through ${fits} first. Only if it truly cannot (it has no such action, or the job lives on a website screen), call use_computer again and say why in app_cannot. Say nothing about this to the person unless the app cannot do it either.` };
    }
    let started;
    try {
        started = await context.admin.startComputerJob(context.botId, context.userId, { title: job, ...(brief ? { brief } : {}), writes: args.reads_only === true ? false : undefined });
    } catch (error) {
        console.warn('[ComputerTools] Could not start a job:', error instanceof Error ? error.message : error);
        return { started: false, success: false, note: "The computer could not be reached just now. Say so in one plain sentence; you can still chat and use their apps." };
    }
    if (!started.ok) {
        switch (started.reason) {
            case 'off':
                return { started: false, success: false, note: "Your computer is off. Say so in one sentence and that they can give you one from this Brick's page, under Computer. Do not start anything else in its place." };
            case 'broken_start':
                return { started: false, success: false, note: "Your computer isn't starting right now, so this job has to wait. Say so in plain words: you can still chat and use their apps, and you'll tell them the moment it is back. Do not offer a price or a reason." };
            case 'not_owner':
            case 'not_open':
            case 'not_set':
                return { started: false, success: false, note: "That can't be done on a computer here right now. Say so in one plain sentence." };
            default:
                return { started: false, success: false, note: 'The job did not start. Say so in one plain sentence.' };
        }
    }
    const { job: made, restoredFrom } = started;
    if (made.status === 'queued') {
        if (made.queuedFor === 'allowance') {
            return { started: false, queued: true, note: "It is waiting: their computer time for this month is used up. Say so in one sentence, that the work is kept and goes on by itself when more is available, and that they can tap Ask for more in Usage. Never give a number or a price." };
        }
        if (made.queuedFor === 'turn') {
            return { started: false, queued: true, note: 'It is next in line: your computer does one job at a time. Say so in one line, e.g. "Will do, right after the current job. My computer does one job at a time, so this is next in line."' };
        }
        return { started: false, queued: true, note: 'It waits in line: every computer is busy just now and nothing needs asking for. Say so in one line, and that it starts by itself.' };
    }
    context.onStarted?.(made.id);
    const when = restoredFrom ? day(restoredFrom) : '';
    return {
        started: true,
        note:
            when
                ? `The job is running. Your computer came back from its copy of ${when}. Say in one sentence that it is working on it and that it came back from that day's copy; anything made after that day is gone, so offer to make it again if it matters. They can Watch or Stop from the bar above.`
                : 'The job is running. Say in one short sentence what you started. They can Watch or Stop from the bar above this chat. Do not say how long it will take.',
    };
}
