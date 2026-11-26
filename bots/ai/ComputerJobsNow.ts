/**
 * What a person's own Brick is told about its computer jobs with every message in its owner's direct chat (the Brick chat audit, 26 Nov, findings 3 and 4).
 *
 * A Brick used to see only the chat itself. It said a search was "running" when none was, said "there was no job" about a job that had run and finished (the jobs
 * tool listed only what was still going), and spoke of the computer "clicking into these five" when no second job was ever started. It also said it had no computer
 * while one was being given to it. So every message now carries one note read fresh from Orbit's own record (GET computer-jobs?jobs=1): the jobs working, waiting for
 * the person or in line, and the few that ended lately with how they ended and what they left, or that it has no computer on right now. The note tells the model to
 * trust it over anything said earlier, never to claim a job that is not listed, and, when the person wants something an ended job did not give it, to start a job
 * that gets it in the same reply (`use_computer` already says "do not ask them first"; every start still goes through Orbit's allowance and spending rules, and paying,
 * submitting and the person's own details still ask them).
 *
 * Model-facing text only: nothing here is shown to the person. No id, no price, no machine, no provider.
 */
import { quotedTitle } from './JobStatusLine';

export interface LiveJobNow {
    title: string;
    status: 'running' | 'waiting' | 'queued';
    queuedFor: string | null;
    waitingFor: string | null;
    control: 'brick' | 'person';
    stepDone: number;
    stepTotal: number | null;
    stepLabel: string | null;
    /** When it was started (ms), or null while it has not. */
    startedAt: number | null;
}

export interface EndedJobNow {
    title: string;
    status: 'done' | 'failed' | 'stopped';
    endedBy: string | null;
    /** When it ended (ms), or null when Orbit does not say. */
    endedAt: number | null;
    files: string[];
    why: string | null;
}

/** The jobs of this person on this Brick, as Orbit reads them now. */
export interface ComputerJobsNow {
    live: LiveJobNow[];
    ended: EndedJobNow[];
}

const TITLE_MAX = 200;
const TEXT_MAX = 200;
const LIST_MAX = 10;
const FILES_MAX = 5;

const text = (value: unknown, max = TEXT_MAX): string | null => {
    if (typeof value !== 'string') return null;
    const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return clean ? Array.from(clean).slice(0, max).join('') : null;
};
const time = (value: unknown): number | null => {
    const at = typeof value === 'string' ? Date.parse(value) : typeof value === 'number' ? value : NaN;
    return Number.isFinite(at) && at > 0 ? at : null;
};
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

/** Orbit's `jobs` (GET computer-jobs?jobs=1), kept only as far as it is well formed. Null when Orbit sent none (an Orbit without it): nothing is then said about jobs. */
export function computerJobsNowOf(raw: unknown): ComputerJobsNow | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const value = raw as { live?: unknown; ended?: unknown };
    if (!Array.isArray(value.live) || !Array.isArray(value.ended)) return null;
    const live: LiveJobNow[] = [];
    for (const one of value.live.slice(0, LIST_MAX)) {
        if (typeof one !== 'object' || one === null) continue;
        const job = one as Record<string, unknown>;
        const title = text(job.title, TITLE_MAX);
        if (!title || (job.status !== 'running' && job.status !== 'waiting' && job.status !== 'queued')) continue;
        live.push({
            title,
            status: job.status,
            queuedFor: text(job.queuedFor, 20),
            waitingFor: text(job.waitingFor, 20),
            control: job.control === 'person' ? 'person' : 'brick',
            stepDone: count(job.stepDone) ?? 0,
            stepTotal: count(job.stepTotal),
            stepLabel: text(job.stepLabel),
            startedAt: time(job.startedAt),
        });
    }
    const ended: EndedJobNow[] = [];
    for (const one of value.ended.slice(0, LIST_MAX)) {
        if (typeof one !== 'object' || one === null) continue;
        const job = one as Record<string, unknown>;
        const title = text(job.title, TITLE_MAX);
        if (!title || (job.status !== 'done' && job.status !== 'failed' && job.status !== 'stopped')) continue;
        ended.push({
            title,
            status: job.status,
            endedBy: text(job.endedBy, 20),
            endedAt: time(job.endedAt),
            files: Array.isArray(job.files) ? job.files.map((name) => text(name, 80)).filter((name): name is string => !!name).slice(0, FILES_MAX) : [],
            why: text(job.why),
        });
    }
    return { live, ended };
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function agoWords(at: number, now: number): string {
    const minutes = Math.floor(Math.max(0, now - at) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
}

const WAITING_WORDS: Record<string, string> = {
    details: 'their details to fill in',
    signin: 'them to sign in',
    upload: 'a file from them',
    pay: 'them to pay',
    submit: 'them to send it off',
    answer: 'an answer from them',
};

const QUEUED_WORDS: Record<string, string> = {
    turn: 'in line, not started yet: it starts by itself when the job before it ends',
    allowance: "waiting, not started yet: this month's computer time is used up, and it starts by itself once they get more in Usage",
    paused: 'paused: it carries on only when they say resume',
};

const ENDED_WORDS: Record<string, string> = {
    person: 'stopped by them',
    off: 'stopped when the computer was turned off',
    deleted: 'stopped',
    error: 'could not finish because of a problem on our side',
    pool: 'stopped because our computers were too busy',
    unanswered: 'stopped after waiting too long for them',
    allowance: "stopped when this month's computer time ran out",
    rule: 'stopped by a spending limit they set',
};

function liveLine(job: LiveJobNow, now: number): string {
    const name = quotedTitle(job.title);
    if (job.status === 'queued') return `- ${name}: ${QUEUED_WORDS[job.queuedFor ?? ''] ?? 'waiting for a free computer, not started yet: it starts by itself'}.`;
    const since = job.startedAt !== null ? ` Started ${agoWords(job.startedAt, now)}.` : '';
    const screen = job.control === 'person' ? ' They have the screen now.' : '';
    if (job.status === 'waiting') return `- ${name}: waiting for ${WAITING_WORDS[job.waitingFor ?? ''] ?? 'them'}.${screen}${since}`;
    const step = job.stepTotal ? `, step ${Math.min(job.stepDone, job.stepTotal)} of ${job.stepTotal}` : job.stepDone > 0 ? `, ${job.stepDone} steps done` : '';
    const label = job.stepLabel ? ` (${job.stepLabel.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()})` : '';
    return `- ${name}: working now${step}${label}.${screen}${since}`;
}

/** One ended job in plain words: its title, how and when it ended, its reason when it could not go on, and the files it left. */
export function endedJobWords(job: EndedJobNow, now: number): string {
    const name = quotedTitle(job.title);
    const how = job.status === 'done' ? 'finished' : job.status === 'failed' && !job.endedBy ? 'stopped at a step it could not get past' : (ENDED_WORDS[job.endedBy ?? ''] ?? 'ended before it was finished');
    const when = job.endedAt !== null ? ` ${agoWords(job.endedAt, now)}` : '';
    const why = job.why ? ` It said: "${job.why.replace(/["“”]/g, "'")}".` : '';
    const files = job.files.length ? ` Files it left: ${job.files.join(', ')}.` : job.status === 'done' ? ' It left no files.' : '';
    return `${name}: ${how}${when}.${why}${files}`;
}

/** The rules that come with the list: the list is the whole truth, nothing else runs, and what an ended job did not give is got by a new job at once. */
export const JOBS_NOW_RULES = [
    'How to use this:',
    '- This is every job there is. Say a job is working, searching, clicking or on its way ONLY when it is listed above as working or waiting, or when use_computer told you in this reply that it started or queued it. Never invent a job, a second job or a step.',
    '- Never say a job listed above as ended did not happen or never existed. When something you said earlier in this chat does not match this list, this list is right: say so in one short line and go on.',
    '- What a job found is only what is listed here and what you were told when it ended. When they want something it did not give you (for example the link of each listing), never guess and never say it is coming: start a new job with use_computer in this same reply that gets exactly that, and say in one line that you started it. Do not ask them to say go first.',
    '- Do not read this list out. Use it when they ask about a job, or when what you are about to say depends on it.',
].join('\n');

/** The note for a Brick whose computer is on, from Orbit's fresh read of its jobs. */
export function computerJobsNote(jobs: ComputerJobsNow, now: number = Date.now()): string {
    const head = '**YOUR COMPUTER JOBS RIGHT NOW** (read fresh for this message from the record of your computer; trust it over anything said earlier in this chat):';
    const lines = [head];
    if (jobs.live.length) lines.push('Working, waiting or in line:', ...jobs.live.map((job) => liveLine(job, now)));
    else lines.push('Nothing is working, waiting or in line on your computer right now.');
    if (jobs.ended.length) lines.push('Ended lately, newest first:', ...jobs.ended.map((job) => `- ${endedJobWords(job, now)}`));
    else lines.push('No job ended in the last week.');
    lines.push(JOBS_NOW_RULES);
    return lines.join('\n');
}

/** The note for a person's own Brick whose computer could be given but is not on: it has none right now, so no computer job of its is running, and where they give it one. */
export const NO_COMPUTER_NOTE =
    "**YOUR COMPUTER:** You do not have a computer turned on right now, so no computer job of yours is running and you can't click through websites or work in files on one. Never say a computer job is running or coming. " +
    'When a job truly needs a computer, say so in one short line: they can give you one under Computer on your Brick page. As soon as it is on, this note says so with their next message.';
